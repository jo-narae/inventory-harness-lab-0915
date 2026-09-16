import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, totalStock } from '../helpers'
import { applyMovement, InsufficientStockError } from '@/lib/stock'
import { ALLOCATION, allocateLots, planAllocation } from '@/lib/fefo'
import { createPopupTx } from '@/lib/popup'
import { getPopupSourceStock } from '@/lib/inventory'
import { addDays, dateOnly, today } from '@/lib/date'

/**
 * Issue #3 — 팝업 반출서 작성 시 현재 가용 재고 안내
 *
 * 반출서는 계획이다. 가용 재고는 판단을 돕기 위해 보여줄 뿐,
 * 예정 수량을 막는 규칙이 아니다. 실제 출고 때의 재고 검증은 그대로다.
 *
 * 시연용 시드는 건드리지 않고 테스트 전용 팝업·로트만 만들고 지운다.
 */
const NAME = '__테스트 반출서 가용재고'
const SKU = '__TEST-ISSUE3'
const EXPIRY_SOON = dateOnly(addDays(today(), 40)) // 임박분 — 반출은 여기서 먼저 빠진다
const EXPIRY_LATE = dateOnly(addDays(today(), 520))
const STOCK_SOON = 30
const STOCK_LATE = 70
const AVAILABLE = STOCK_SOON + STOCK_LATE // 이 테스트가 자사창고에 채우는 가용 재고

/**
 * 시드 재고를 건드리면 다른 테스트의 불변식이 깨진다.
 * 이 테스트는 전용 상품 하나만 쓰고, 끝나면 그 상품에 딸린 것만 지운다.
 */
async function cleanup() {
  const product = await db.product.findUnique({ where: { sku: SKU } })
  if (product) {
    await db.movement.deleteMany({ where: { productId: product.id } })
    await db.popupPlan.deleteMany({ where: { productId: product.id } })
    await db.lot.deleteMany({ where: { productId: product.id } })
  }
  const popups = await db.popup.findMany({ where: { name: { startsWith: NAME } } })
  for (const popup of popups) {
    await db.movement.deleteMany({ where: { popupId: popup.id } })
    await db.popupPlan.deleteMany({ where: { popupId: popup.id } })
    await db.popup.delete({ where: { id: popup.id } })
    await db.lot.deleteMany({ where: { locationId: popup.locationId } })
    await db.location.delete({ where: { id: popup.locationId } })
  }
  // 팝업 거점만 따로 만든 경우까지 정리한다
  for (const location of await db.location.findMany({ where: { name: { startsWith: NAME } } })) {
    await db.lot.deleteMany({ where: { locationId: location.id } })
    await db.location.delete({ where: { id: location.id } })
  }
  if (product) await db.product.delete({ where: { id: product.id } })
}

async function fixture() {
  const [own, user, product] = await Promise.all([
    db.location.findFirstOrThrow({ where: { type: 'OWN' } }),
    db.user.findFirstOrThrow(),
    db.product.upsert({
      where: { sku: SKU },
      update: {},
      create: { sku: SKU, name: '__테스트 상품(Issue 3)', unit: '개' },
    }),
  ])
  return { own, user, product }
}

/** 자사창고에 테스트용 재고를 채운다 (임박 30 + 넉넉 70) */
async function stockUp() {
  const { own, user, product } = await fixture()
  await db.$transaction(async (tx) => {
    for (const [expiry, qty] of [
      [EXPIRY_SOON, STOCK_SOON],
      [EXPIRY_LATE, STOCK_LATE],
    ] as const) {
      await applyMovement(tx, {
        type: 'INBOUND',
        reason: 'PURCHASE',
        productId: product.id,
        expiryDate: expiry,
        quantity: qty,
        toLocationId: own.id,
        userId: user.id,
      })
    }
  })
  return { own, user, product }
}

describe('팝업 반출서 — 현재 가용 재고 안내', () => {
  beforeAll(cleanup)
  afterAll(async () => {
    await cleanup()
    await db.$disconnect()
  })

  it('C2. 반출서에 제공되는 가용 재고가 현재 출고 가능한 재고와 일치한다', async () => {
    const { own, product } = await stockUp()

    const stock = await getPopupSourceStock([own.id])

    // 같은 기준을 DB에서 직접 계산한 값 — 지금 그 창고에서 출고 가능한 수량
    const lots = await db.lot.findMany({
      where: { locationId: own.id, productId: product.id, quantity: { gt: 0 } },
    })
    const expected = lots.reduce((s, l) => s + l.quantity, 0)

    expect(expected).toBe(AVAILABLE) // 이 상품의 재고는 전부 자사창고에 있다
    expect(stock[own.id]?.[product.id]).toBe(expected)

    // 팝업 거점의 재고는 출고 가능이 아니므로 가용에 들어가지 않는다
    // (읽기 함수의 기준만 확인하는 자리라 로트를 직접 두고 바로 지운다)
    const popupLocation = await db.location.create({
      data: { name: `${NAME} 거점`, type: 'POPUP' },
    })
    await db.lot.create({
      data: {
        productId: product.id,
        locationId: popupLocation.id,
        expiryDate: EXPIRY_LATE,
        quantity: 5,
      },
    })
    const withPopup = await getPopupSourceStock([own.id, popupLocation.id])
    expect(withPopup[popupLocation.id]?.[product.id] ?? 0).toBe(0)

    await db.lot.deleteMany({ where: { locationId: popupLocation.id } })
    await db.location.delete({ where: { id: popupLocation.id } })
  })

  it('C3. 반출 예정 수량이 가용 재고보다 커도 반출 계획을 작성할 수 있다', async () => {
    const { own, product } = await fixture()
    const stock = await getPopupSourceStock([own.id])
    const available = stock[own.id]?.[product.id] ?? 0
    const planned = available + 500 // 가용 재고를 크게 넘는 계획
    const before = await totalStock()

    const popupId = await db.$transaction((tx) =>
      createPopupTx(tx, {
        name: `${NAME} 초과`,
        startDate: today(),
        endDate: addDays(today(), 3),
        sourceLocationId: own.id,
        planLines: [{ productId: product.id, plannedQty: planned }],
      })
    )

    const line = await db.popupPlan.findFirstOrThrow({ where: { popupId, productId: product.id } })
    expect(line.plannedQty).toBe(planned) // 입력한 그대로 저장된다 — 잘리지도, 막히지도 않는다

    // 반출서는 계획이므로 재고는 1개도 움직이지 않는다
    expect(await totalStock()).toBe(before)
    expect((await getPopupSourceStock([own.id]))[own.id]?.[product.id] ?? 0).toBe(available)
  })

  it('C4. 반출 예정 수량이 가용 재고 이하이면 기존과 동일하게 반출 계획을 작성할 수 있다', async () => {
    const { own, product } = await fixture()
    const available = (await getPopupSourceStock([own.id]))[own.id]?.[product.id] ?? 0
    const planned = Math.max(1, available - 10)
    const before = await totalStock()

    const popupId = await db.$transaction((tx) =>
      createPopupTx(tx, {
        name: `${NAME} 이하`,
        startDate: today(),
        endDate: addDays(today(), 3),
        sourceLocationId: own.id,
        planLines: [{ productId: product.id, plannedQty: planned }],
      })
    )

    const popup = await db.popup.findUniqueOrThrow({ where: { id: popupId } })
    expect(popup.status).toBe('PREP')
    expect(popup.sourceLocationId).toBe(own.id)

    const line = await db.popupPlan.findFirstOrThrow({ where: { popupId, productId: product.id } })
    expect(line.plannedQty).toBe(planned)
    expect(await totalStock()).toBe(before)
  })

  it('C5. 가용 재고 안내가 기존 반출 및 재고 처리 규칙을 변경하지 않는다', async () => {
    const { own, user, product } = await fixture()
    const popup = await db.popup.findFirstOrThrow({ where: { name: `${NAME} 초과` } })
    const available = (await getPopupSourceStock([own.id]))[own.id]?.[product.id] ?? 0
    const before = await totalStock()

    // ① 실제 출고는 여전히 가용 재고를 넘을 수 없다 — 계획이 크다고 통과하지 않는다
    await expect(
      db.$transaction((tx) =>
        allocateLots(tx, {
          productId: product.id,
          locationId: own.id,
          quantity: available + 1,
        })
      )
    ).rejects.toBeInstanceOf(InsufficientStockError)
    expect(await totalStock()).toBe(before)

    // ② 가용 재고 안에서의 반출은 그대로 — FEFO로 임박분부터 빠지고 총 재고는 변하지 않는다
    const shipped = STOCK_SOON + 10
    const lotsBefore = await db.lot.findMany({
      where: { productId: product.id, locationId: own.id, quantity: { gt: 0 } },
    })
    const { plan } = planAllocation(lotsBefore, shipped, ALLOCATION.FEFO)

    await db.$transaction(async (tx) => {
      const plan = await allocateLots(tx, {
        productId: product.id,
        locationId: own.id,
        quantity: shipped,
      })
      for (const a of plan) {
        await applyMovement(tx, {
          type: 'POPUP_OUT',
          productId: product.id,
          expiryDate: a.expiryDate,
          quantity: a.qty,
          fromLocationId: own.id,
          toLocationId: popup.locationId,
          popupId: popup.id,
          userId: user.id,
        })
      }
    })

    // 유통기한이 빠른 로트부터 예정대로 빠졌는지 로트 단위로 확인한다 (FEFO)
    expect(plan.length).toBeGreaterThan(0)
    for (const a of plan) {
      const after = await db.lot.findUniqueOrThrow({ where: { id: a.lotId } })
      const beforeLot = lotsBefore.find((l) => l.id === a.lotId)!
      expect(after.quantity).toBe(beforeLot.quantity - a.qty)
    }
    expect(await totalStock()).toBe(before) // 내부 이동이라 총합은 그대로

    // ③ 안내 숫자는 실제 재고를 따라 줄어든다
    expect((await getPopupSourceStock([own.id]))[own.id]?.[product.id] ?? 0).toBe(
      available - shipped
    )

    // ④ 반출 기록은 사유 없는 위치 이동 그대로다 (F5-1)
    const movements = await db.movement.findMany({ where: { popupId: popup.id } })
    expect(movements.length).toBeGreaterThan(0)
    for (const m of movements) {
      expect(m.type).toBe('POPUP_OUT')
      expect(m.reason).toBeNull()
      expect(m.fromLocationId).toBe(own.id)
      expect(m.toLocationId).toBe(popup.locationId)
    }
  })
})
