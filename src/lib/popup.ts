import type { Prisma } from '@/generated/prisma/client'
import { db } from './db'
import { applyMovement, reverseMovement } from './stock'
import { LOCATION_TYPES, MOVEMENT_TYPES, POPUP_STATUS, REASON_CODES } from './constants'
import { dateOnly } from './date'

/**
 * 팝업 = 여러 번 재고가 들어갔다가 마지막에 한 번 정산되는 임시 거점.
 *
 * 팝업 현장에서는 판매를 건별로 찍지 않는다 (S9).
 * 행사가 끝나고 남은 실물을 세어 `누적 반출 − 반입 = 차감`으로 판매량을 역산한다.
 * 정산 기준은 언제나 **누적 반출**이다. 1차 반출만 놓고 계산하면 판매량이 틀린다 (P7).
 */

type MovementLike = {
  id: number
  reversalOfId: number | null
  type: string
  reason: string | null
  productId: number
  quantity: number
  fromLocationId: number | null
  toLocationId: number | null
}

/** 취소된 기록과 그 상쇄 기록은 계산에서 빼야 숫자가 맞는다 (F10) */
export function liveMovements<T extends MovementLike>(movements: T[]): T[] {
  const reversed = new Set(movements.filter((m) => m.reversalOfId).map((m) => m.reversalOfId!))
  return movements.filter((m) => !m.reversalOfId && !reversed.has(m.id))
}

export type PopupTotals = { shipped: number; sold: number; sample: number; returned: number }

export function tallyPopup(movements: MovementLike[], popupLocationId: number): PopupTotals {
  const live = liveMovements(movements)
  const sum = (f: (m: MovementLike) => boolean) =>
    live.filter(f).reduce((s, m) => s + m.quantity, 0)

  return {
    // 누적 반출 — 자사창고에서 팝업으로 들어간 전부 (1차 + 추가 반출)
    shipped: sum((m) => m.toLocationId === popupLocationId),
    sold: sum((m) => m.fromLocationId === popupLocationId && m.reason === REASON_CODES.SALE),
    sample: sum((m) => m.fromLocationId === popupLocationId && m.reason === REASON_CODES.SAMPLE),
    returned: sum((m) => m.type === MOVEMENT_TYPES.POPUP_IN),
  }
}

// ───────────────────────── 반출서 만들기 (S6)

export type CreatePopupInput = {
  name: string
  startDate: Date
  endDate: Date
  sourceLocationId: number
  planLines: { productId: number; plannedQty: number }[]
}

/**
 * 반출서 만들기 — 액션과 테스트가 같은 함수를 쓴다.
 *
 * 반출서는 계획이다. 여기서 재고는 1개도 움직이지 않으므로 예정 수량이
 * 지금 창고의 가용 재고보다 커도 그대로 저장한다. 실제 수량은 반출할 때 다시 확인한다.
 * 화면에 가용 재고를 보여주는 것은 판단을 돕기 위한 안내일 뿐, 입력을 막는 규칙이 아니다.
 */
export async function createPopupTx(tx: Prisma.TransactionClient, input: CreatePopupInput) {
  const location = await tx.location.create({
    data: { name: input.name, type: LOCATION_TYPES.POPUP },
  })
  const popup = await tx.popup.create({
    data: {
      name: input.name,
      status: POPUP_STATUS.PREP,
      startDate: input.startDate,
      endDate: input.endDate,
      locationId: location.id,
      sourceLocationId: input.sourceLocationId,
    },
  })
  for (const line of input.planLines.filter((l) => l.plannedQty > 0)) {
    await tx.popupPlan.create({
      data: { popupId: popup.id, productId: line.productId, plannedQty: line.plannedQty },
    })
  }
  return popup.id
}

// ───────────────────────── 조회

export async function getPopupList() {
  const popups = await db.popup.findMany({
    include: { location: { include: { lots: { where: { quantity: { gt: 0 } } } } }, movements: true },
    orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
  })

  return popups.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    onHand: p.location.lots.reduce((s, l) => s + l.quantity, 0),
    ...tallyPopup(p.movements, p.locationId),
  }))
}

export async function getPopupDetail(popupId: number) {
  const popup = await db.popup.findUnique({
    where: { id: popupId },
    include: {
      location: true,
      sourceLocation: true,
      planLines: { include: { product: true } },
      movements: { include: { product: true } },
    },
  })
  if (!popup) return null

  const [popupLots, sourceLots, products] = await Promise.all([
    db.lot.findMany({
      where: { locationId: popup.locationId, quantity: { gt: 0 } },
      include: { product: true },
      orderBy: [{ productId: 'asc' }, { expiryDate: 'asc' }],
    }),
    db.lot.findMany({
      where: { locationId: popup.sourceLocationId, quantity: { gt: 0 } },
      include: { product: { select: { expiryAlertDays: true } } },
    }),
    db.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, unit: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const live = liveMovements(popup.movements)
  const totals = tallyPopup(popup.movements, popup.locationId)

  // 상품별 집계 — 반출서에 없던 상품도 추가 반출로 들어올 수 있다
  const byProduct = new Map<
    number,
    { productId: number; name: string; unit: string; planned: number; shipped: number; sold: number; sample: number; returned: number; onHand: number }
  >()
  const touch = (productId: number, name: string, unit: string) => {
    const cur = byProduct.get(productId) ?? {
      productId,
      name,
      unit,
      planned: 0,
      shipped: 0,
      sold: 0,
      sample: 0,
      returned: 0,
      onHand: 0,
    }
    byProduct.set(productId, cur)
    return cur
  }

  for (const line of popup.planLines) {
    touch(line.productId, line.product.name, line.product.unit).planned += line.plannedQty
  }
  for (const m of live) {
    const row = touch(m.productId, m.product.name, m.product.unit)
    if (m.toLocationId === popup.locationId) row.shipped += m.quantity
    if (m.fromLocationId === popup.locationId && m.reason === REASON_CODES.SALE) row.sold += m.quantity
    if (m.fromLocationId === popup.locationId && m.reason === REASON_CODES.SAMPLE)
      row.sample += m.quantity
    if (m.type === MOVEMENT_TYPES.POPUP_IN) row.returned += m.quantity
  }
  for (const lot of popupLots) {
    touch(lot.productId, lot.product.name, lot.product.unit).onHand += lot.quantity
  }

  return {
    popup,
    totals,
    byProduct: [...byProduct.values()].sort((a, b) => b.shipped - a.shipped || a.name.localeCompare(b.name, 'ko')),
    /** 정산 입력 대상 — 팝업에 남아 있는 로트 (유통기한을 보존해야 복귀 로트가 맞는다) */
    popupLots: popupLots.map((l) => ({
      lotId: l.id,
      productId: l.productId,
      name: l.product.name,
      unit: l.product.unit,
      expiry: l.expiryDate.toISOString(),
      quantity: l.quantity,
    })),
    /** 반출 화면용 — 자사창고 재고 */
    sourceLots: sourceLots.map((l) => ({
      id: l.id,
      productId: l.productId,
      locationId: l.locationId,
      expiry: l.expiryDate.toISOString(),
      quantity: l.quantity,
      alertDays: l.product.expiryAlertDays,
    })),
    products,
  }
}

/** 정산 리포트 (E3) — 소진율 = (판매 + 시식·증정) ÷ 누적 반출 */
export function popupReport(
  totals: PopupTotals,
  byProduct: { name: string; unit: string; shipped: number; sold: number; sample: number }[]
) {
  const rate = (shipped: number, consumed: number) => (shipped > 0 ? consumed / shipped : 0)
  const rows = byProduct
    .filter((p) => p.shipped > 0)
    .map((p) => ({ ...p, consumed: p.sold + p.sample, rate: rate(p.shipped, p.sold + p.sample) }))
    .sort((a, b) => b.consumed - a.consumed)

  return {
    ...totals,
    rate: rate(totals.shipped, totals.sold + totals.sample),
    top: rows.slice(0, 3),
    // 다음 팝업에 그만 가져가기 위한 정보다
    idle: rows.filter((r) => r.rate <= 0.2),
  }
}

// ───────────────────────── 정산 (도메인 핵심)

export type SettleInput = {
  popupId: number
  userId: number
  /** 로트별 잔여 실물 수량. 입력하지 않은 로트는 0개 남은 것으로 본다 */
  returns: { lotId: number; qty: number }[]
  /** 상품별 시식·증정 수량 (기본 0) */
  samples: { productId: number; qty: number }[]
}

/**
 * 정산 확정 — 액션과 테스트가 같은 함수를 쓴다.
 *
 *   차감 = 누적 반출 − 반입      (반출한 물건 중 돌아오지 않은 것)
 *   판매 = 차감 − 시식·증정      (대가 없이 나간 것을 빼야 판매가 맞다)
 *
 * 잔여 복귀는 반품이 아니라 **위치 이동**이므로 사유를 붙이지 않는다 (F5-1).
 */
export async function settlePopupTx(tx: Prisma.TransactionClient, input: SettleInput) {
  const popup = await tx.popup.findUnique({ where: { id: input.popupId } })
  if (!popup) throw new Error('팝업을 찾을 수 없습니다')
  if (popup.status === POPUP_STATUS.CLOSED) throw new Error('이미 정산된 팝업입니다')

  const lots = await tx.lot.findMany({
    where: { locationId: popup.locationId, quantity: { gt: 0 } },
    orderBy: [{ productId: 'asc' }, { expiryDate: 'asc' }], // 시식·증정은 임박분부터 나갔다고 본다
  })
  if (lots.length === 0) throw new Error('팝업에 남은 재고가 없습니다. 반출 기록을 확인하세요')

  const returnOf = new Map(input.returns.map((r) => [r.lotId, r.qty]))
  const sampleOf = new Map(input.samples.map((s) => [s.productId, s.qty]))

  // 상품 단위로 먼저 검증한다 — 시식이 차감분보다 크면 저장 자체를 막는다
  const consumedByProduct = new Map<number, number>()
  for (const lot of lots) {
    const returned = returnOf.get(lot.id) ?? 0
    if (!Number.isInteger(returned) || returned < 0) throw new Error('잔여 수량이 올바르지 않습니다')
    if (returned > lot.quantity)
      throw new Error(`반출한 수량보다 많이 돌아올 수 없습니다 (반출 ${lot.quantity}, 입력 ${returned})`)
    consumedByProduct.set(
      lot.productId,
      (consumedByProduct.get(lot.productId) ?? 0) + (lot.quantity - returned)
    )
  }
  for (const [productId, sample] of sampleOf) {
    if (sample < 0 || !Number.isInteger(sample)) throw new Error('시식·증정 수량이 올바르지 않습니다')
    if (sample > (consumedByProduct.get(productId) ?? 0))
      throw new Error('시식·증정 수량이 차감분보다 클 수 없습니다')
  }

  const totals: PopupTotals = { shipped: 0, sold: 0, sample: 0, returned: 0 }
  const restSample = new Map(sampleOf)

  for (const lot of lots) {
    const returned = returnOf.get(lot.id) ?? 0
    const consumed = lot.quantity - returned
    totals.shipped += lot.quantity

    // ① 시식·증정 — 임박한 로트부터 채운다
    const wantSample = Math.min(consumed, restSample.get(lot.productId) ?? 0)
    if (wantSample > 0) {
      restSample.set(lot.productId, (restSample.get(lot.productId) ?? 0) - wantSample)
      await applyMovement(tx, {
        type: MOVEMENT_TYPES.POPUP_OUT,
        reason: REASON_CODES.SAMPLE,
        note: '팝업 정산 — 시식·증정',
        productId: lot.productId,
        expiryDate: lot.expiryDate,
        quantity: wantSample,
        fromLocationId: popup.locationId, // 외부로 나간다 (to = null)
        popupId: popup.id,
        userId: input.userId,
      })
      totals.sample += wantSample
    }

    // ② 판매 — 차감분에서 시식을 뺀 나머지
    const sold = consumed - wantSample
    if (sold > 0) {
      await applyMovement(tx, {
        type: MOVEMENT_TYPES.POPUP_OUT,
        reason: REASON_CODES.SALE,
        note: '팝업 정산 — 판매 역산',
        productId: lot.productId,
        expiryDate: lot.expiryDate,
        quantity: sold,
        fromLocationId: popup.locationId,
        popupId: popup.id,
        userId: input.userId,
      })
      totals.sold += sold
    }

    // ③ 잔여 복귀 — 팝업 → 자사창고. 유통기한이 그대로 보존된다
    if (returned > 0) {
      await applyMovement(tx, {
        type: MOVEMENT_TYPES.POPUP_IN,
        note: '팝업 잔여 복귀',
        productId: lot.productId,
        expiryDate: lot.expiryDate,
        quantity: returned,
        fromLocationId: popup.locationId,
        toLocationId: popup.sourceLocationId,
        popupId: popup.id,
        userId: input.userId,
      })
      totals.returned += returned
    }
  }

  await tx.popup.update({
    where: { id: popup.id },
    data: { status: POPUP_STATUS.CLOSED, settledAt: new Date() },
  })
  // 팝업 거점은 행사 단위로만 존재한다 (F2)
  await tx.location.update({ where: { id: popup.locationId }, data: { isActive: false } })

  return totals
}

/**
 * 정산 되돌리기 (P12) — 실물 카운트를 잘못 셌다는 걸 나중에 알 수 있다.
 * 기록을 지우지 않고 방향을 뒤집은 상쇄 기록을 만든다.
 */
export async function unsettlePopupTx(
  tx: Prisma.TransactionClient,
  popupId: number,
  userId: number
) {
  const popup = await tx.popup.findUnique({ where: { id: popupId } })
  if (!popup) throw new Error('팝업을 찾을 수 없습니다')
  if (popup.status !== POPUP_STATUS.CLOSED) throw new Error('정산된 팝업이 아닙니다')

  const movements = await tx.movement.findMany({ where: { popupId } })
  const settlement = liveMovements(movements).filter(
    (m) => m.fromLocationId === popup.locationId // 정산에서 생긴 것 = 팝업에서 나간 것
  )

  for (const m of settlement) {
    await reverseMovement(tx, m.id, userId, '팝업 정산 취소')
  }

  await tx.popup.update({
    where: { id: popupId },
    data: { status: POPUP_STATUS.ACTIVE, settledAt: null },
  })
  await tx.location.update({ where: { id: popup.locationId }, data: { isActive: true } })

  return settlement.length
}

/** 팝업 기간 문구 */
export function popupPeriod(start: Date, end: Date) {
  const f = (d: Date) => dateOnly(d).toISOString().slice(0, 10).replace(/-/g, '.')
  return `${f(start)} ~ ${f(end).slice(5)}`
}
