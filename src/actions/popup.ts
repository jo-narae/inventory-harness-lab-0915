'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser, SessionExpiredError } from '@/lib/auth'
import { applyMovement, InsufficientStockError } from '@/lib/stock'
import { ALLOCATION, allocateLots } from '@/lib/fefo'
import { createPopupTx, settlePopupTx, unsettlePopupTx } from '@/lib/popup'
import { MOVEMENT_TYPES, POPUP_STATUS } from '@/lib/constants'
import { dateOnly } from '@/lib/date'
import type { SaveResult } from './inbound'

async function user() {
  try {
    return await requireUser()
  } catch (e) {
    if (e instanceof SessionExpiredError) return null
    throw e
  }
}

const SESSION_ERROR = { ok: false, error: '로그인 정보가 만료되었습니다. 다시 로그인해주세요' } as const

/**
 * 팝업 만들기 (S6) — 반출서는 계획일 뿐, 이 단계에서 재고는 움직이지 않는다.
 * 행사 기간에만 존재하는 전용 거점이 함께 생긴다.
 */
export async function createPopup(input: {
  name: string
  startDate: string // YYYY-MM-DD
  endDate: string
  sourceLocationId: number
  planLines: { productId: number; plannedQty: number }[]
}): Promise<SaveResult & { popupId?: number }> {
  const me = await user()
  if (!me) return SESSION_ERROR

  if (!input.name.trim()) return { ok: false, error: '팝업 이름을 입력하세요' }
  const start = dateOnly(new Date(input.startDate))
  const end = dateOnly(new Date(input.endDate))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return { ok: false, error: '기간을 확인하세요' }
  if (end < start) return { ok: false, error: '종료일이 시작일보다 빠릅니다' }

  const popupId = await db.$transaction((tx) =>
    createPopupTx(tx, {
      name: input.name.trim(),
      startDate: start,
      endDate: end,
      sourceLocationId: input.sourceLocationId,
      planLines: input.planLines,
    })
  )

  revalidatePath('/popups')
  return { ok: true, message: `${input.name} 반출서를 만들었습니다`, popupId }
}

/**
 * 반출 확정 (S7) · 추가 반출 (S8)
 * 계획과 실제 수량은 다를 수 있다. 실제로 꺼낸 수량만 기록한다.
 * 로트는 FEFO — 현장에서 며칠 안에 팔리므로 임박분부터 내보내는 것이 맞다.
 */
export async function shipOutPopup(input: {
  popupId: number
  lines: { productId: number; quantity: number }[]
}): Promise<SaveResult> {
  const me = await user()
  if (!me) return SESSION_ERROR

  const popup = await db.popup.findUnique({ where: { id: input.popupId } })
  if (!popup) return { ok: false, error: '팝업을 찾을 수 없습니다' }
  if (popup.status === POPUP_STATUS.CLOSED) return { ok: false, error: '정산이 끝난 팝업입니다' }

  const lines = input.lines.filter((l) => l.quantity > 0)
  if (!lines.length) return { ok: false, error: '반출할 수량을 입력하세요' }

  try {
    await db.$transaction(async (tx) => {
      for (const line of lines) {
        const plan = await allocateLots(tx, {
          productId: line.productId,
          locationId: popup.sourceLocationId,
          quantity: line.quantity,
          strategy: ALLOCATION.FEFO,
        })
        for (const a of plan) {
          await applyMovement(tx, {
            type: MOVEMENT_TYPES.POPUP_OUT,
            // 반출은 판매가 아니라 위치 이동이다 — 사유를 붙이지 않는다 (F5-1)
            productId: line.productId,
            expiryDate: a.expiryDate,
            quantity: a.qty,
            fromLocationId: popup.sourceLocationId,
            toLocationId: popup.locationId,
            popupId: popup.id,
            userId: me.id,
          })
        }
      }
      if (popup.status === POPUP_STATUS.PREP) {
        await tx.popup.update({ where: { id: popup.id }, data: { status: POPUP_STATUS.ACTIVE } })
      }
    })
  } catch (e) {
    if (e instanceof InsufficientStockError) {
      const product = await db.product.findUnique({ where: { id: e.detail.productId } })
      return {
        ok: false,
        error: `${product?.name ?? '상품'} 재고가 부족합니다 (보유 ${e.detail.have}개, 입력 ${e.detail.want}개)`,
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : '반출에 실패했습니다' }
  }

  revalidatePath('/')
  revalidatePath('/popups')
  revalidatePath(`/popups/${input.popupId}`)
  const total = lines.reduce((s, l) => s + l.quantity, 0)
  return { ok: true, message: `${lines.length}종 ${total}개 반출` }
}

/**
 * 정산 확정 (S9) — 남은 실물 수량으로 판매량을 역산한다.
 * 계산은 lib/popup.ts의 settlePopupTx가 한다 (테스트와 같은 함수).
 */
export async function settlePopup(input: {
  popupId: number
  returns: { lotId: number; qty: number }[]
  samples: { productId: number; qty: number }[]
}): Promise<SaveResult> {
  const me = await user()
  if (!me) return SESSION_ERROR

  let totals
  try {
    totals = await db.$transaction((tx) =>
      settlePopupTx(tx, {
        popupId: input.popupId,
        userId: me.id,
        returns: input.returns,
        samples: input.samples,
      })
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '정산에 실패했습니다' }
  }

  revalidatePath('/')
  revalidatePath('/popups')
  revalidatePath(`/popups/${input.popupId}`)
  return {
    ok: true,
    message: `판매 ${totals.sold}개 · 시식·증정 ${totals.sample}개 · 복귀 ${totals.returned}개로 정산했습니다`,
  }
}

/** 정산 되돌리기 — 실물을 잘못 셌다는 걸 나중에 알 수 있다 (P12) */
export async function unsettlePopup(popupId: number): Promise<SaveResult> {
  const me = await user()
  if (!me) return SESSION_ERROR

  try {
    await db.$transaction((tx) => unsettlePopupTx(tx, popupId, me.id))
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '정산 취소에 실패했습니다' }
  }

  revalidatePath('/')
  revalidatePath('/popups')
  revalidatePath(`/popups/${popupId}`)
  return { ok: true, message: '정산을 되돌렸습니다. 재고가 팝업으로 돌아왔습니다' }
}
