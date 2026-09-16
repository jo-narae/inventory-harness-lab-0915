import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../helpers'
import { applyMovement } from '@/lib/stock'
import { getProductDetail } from '@/lib/inventory'
import { addDays, dateOnly, today } from '@/lib/date'

/**
 * Issue #8 — 재고 상세 화면의 세 가지 재고 범위
 *
 *   즉시 출고 가능 = 유효한 OWN
 *   가용 재고     = 유효한 OWN + FULFILLMENT
 *   전체 재고     = 유효한 OWN + FULFILLMENT + POPUP
 *
 * '유효한'은 유통기한이 지나지 않았다는 뜻이다. 오늘이 유통기한인 재고는 아직 유효하다.
 *
 * 기대값은 화면 계산 로직을 다시 부르지 않고, 각 종료 조건에 적힌 거점 범위를 기준으로
 * DB의 로트에서 직접 세어 판정한다.
 *
 * 시연용 시드는 건드리지 않는다 — 전용 상품 · 전용 팝업 거점만 만들고 끝나면 지운다.
 */
const SKU = '__TEST-ISSUE8'
const POPUP_NAME = '__테스트 팝업 거점(Issue 8)'

const VALID_FAR = dateOnly(addDays(today(), 400)) // 넉넉한 유효 재고
const VALID_TODAY = dateOnly(today()) // 경계 — 오늘까지는 유효하다
const EXPIRED_EDGE = dateOnly(addDays(today(), -1)) // 경계 — 어제부터는 만료다
const EXPIRED_OLD = dateOnly(addDays(today(), -30))

async function cleanup() {
  const product = await db.product.findUnique({ where: { sku: SKU } })
  if (product) {
    await db.movement.deleteMany({ where: { productId: product.id } })
    await db.lot.deleteMany({ where: { productId: product.id } })
  }
  for (const location of await db.location.findMany({ where: { name: POPUP_NAME } })) {
    await db.movement.deleteMany({
      where: { OR: [{ fromLocationId: location.id }, { toLocationId: location.id }] },
    })
    await db.lot.deleteMany({ where: { locationId: location.id } })
    await db.location.delete({ where: { id: location.id } })
  }
  if (product) await db.product.delete({ where: { id: product.id } })
}

async function fixture() {
  const [own, ff, user, product] = await Promise.all([
    db.location.findFirstOrThrow({ where: { type: 'OWN' } }),
    db.location.findFirstOrThrow({ where: { type: 'FULFILLMENT' } }),
    db.user.findFirstOrThrow(),
    db.product.upsert({
      where: { sku: SKU },
      update: {},
      create: { sku: SKU, name: '__테스트 상품(Issue 8)', unit: '개' },
    }),
  ])
  const popup =
    (await db.location.findFirst({ where: { name: POPUP_NAME } })) ??
    (await db.location.create({ data: { name: POPUP_NAME, type: 'POPUP' } }))
  return { own, ff, popup, user, product }
}

/** 외부 입고 — 거점에 재고를 채우는 유일한 통로 */
async function inbound(locationId: number, expiryDate: Date, quantity: number) {
  const { user, product } = await fixture()
  await db.$transaction((tx) =>
    applyMovement(tx, {
      type: 'INBOUND',
      reason: 'PURCHASE',
      productId: product.id,
      expiryDate,
      quantity,
      toLocationId: locationId,
      userId: user.id,
    })
  )
}

/** 내부 이동 — 총 재고는 변하지 않는다 */
async function transfer(fromId: number, toId: number, expiryDate: Date, quantity: number) {
  const { user, product } = await fixture()
  await db.$transaction((tx) =>
    applyMovement(tx, {
      type: 'TRANSFER',
      productId: product.id,
      expiryDate,
      quantity,
      fromLocationId: fromId,
      toLocationId: toId,
      userId: user.id,
    })
  )
}

/**
 * 종료 조건이 말하는 그대로를 DB에서 직접 센다.
 * 화면의 계산 함수를 부르지 않는 것이 이 함수의 존재 이유다.
 */
async function countByTypes(productId: number, types: string[]) {
  const lots = await db.lot.findMany({
    where: { productId, quantity: { gt: 0 } },
    include: { location: true },
  })
  return lots
    .filter((l) => types.includes(l.location.type))
    .filter((l) => dateOnly(l.expiryDate).getTime() >= today().getTime()) // 유통기한이 지나지 않은 것
    .reduce((s, l) => s + l.quantity, 0)
}

async function scopes(productId: number) {
  const data = await getProductDetail(productId)
  if (!data) throw new Error('상품 상세를 찾을 수 없습니다')
  return { readyToShip: data.readyToShip, available: data.available, total: data.total }
}

describe('재고 상세 — 즉시 출고 가능 · 가용 재고 · 전체 재고', () => {
  beforeAll(cleanup)
  beforeEach(async () => {
    // 각 조건을 앞 조건의 잔여 재고 없이 본다
    const product = await db.product.findUnique({ where: { sku: SKU } })
    if (product) {
      await db.movement.deleteMany({ where: { productId: product.id } })
      await db.lot.deleteMany({ where: { productId: product.id } })
    }
  })
  afterAll(async () => {
    await cleanup()
    await db.$disconnect()
  })

  it('C1. 즉시 출고 가능은 유효한 OWN 재고의 합과 같다', async () => {
    const { own, ff, popup, product } = await fixture()
    await inbound(own.id, VALID_FAR, 40)
    await inbound(own.id, VALID_TODAY, 7) // 오늘까지는 유효하다
    await inbound(own.id, EXPIRED_EDGE, 5)
    await inbound(ff.id, VALID_FAR, 100)
    await inbound(popup.id, VALID_FAR, 100)

    const expected = await countByTypes(product.id, ['OWN'])
    expect(expected).toBe(47) // 40 + 7, 만료분 5는 빠진다

    expect((await scopes(product.id)).readyToShip).toBe(expected)
  })

  it('C2. 가용 재고는 유효한 OWN과 FULFILLMENT 재고의 합과 같다', async () => {
    const { own, ff, popup, product } = await fixture()
    await inbound(own.id, VALID_FAR, 40)
    await inbound(ff.id, VALID_FAR, 60)
    await inbound(ff.id, VALID_TODAY, 3)
    await inbound(ff.id, EXPIRED_OLD, 9)
    await inbound(popup.id, VALID_FAR, 100)

    const expected = await countByTypes(product.id, ['OWN', 'FULFILLMENT'])
    expect(expected).toBe(103) // 40 + 60 + 3, 만료분 9와 팝업 100은 빠진다

    const s = await scopes(product.id)
    expect(s.available).toBe(expected)
    expect(s.available).toBeGreaterThan(s.readyToShip) // 풀필먼트는 즉시 출고가 아니다
  })

  it('C3. 전체 재고는 유효한 OWN과 FULFILLMENT와 POPUP 재고의 합과 같다', async () => {
    const { own, ff, popup, product } = await fixture()
    await inbound(own.id, VALID_FAR, 40)
    await inbound(ff.id, VALID_FAR, 60)
    await inbound(popup.id, VALID_FAR, 25)
    await inbound(popup.id, VALID_TODAY, 5)
    await inbound(popup.id, EXPIRED_EDGE, 11)

    const expected = await countByTypes(product.id, ['OWN', 'FULFILLMENT', 'POPUP'])
    expect(expected).toBe(130) // 40 + 60 + 25 + 5, 만료분 11은 빠진다

    const s = await scopes(product.id)
    expect(s.total).toBe(expected)
    expect(s.total).toBeGreaterThan(s.available) // 팝업 재고는 보유하지만 출고에 쓸 수 없다
  })

  it('C4. 유통기한이 지난 재고는 세 재고 수량에서 모두 제외된다', async () => {
    const { own, ff, popup, product } = await fixture()
    await inbound(own.id, VALID_FAR, 30)
    await inbound(ff.id, VALID_FAR, 20)
    await inbound(popup.id, VALID_FAR, 10)
    const before = await scopes(product.id)
    expect(before).toEqual({ readyToShip: 30, available: 50, total: 60 })

    // 세 거점 모두에 만료 재고를 넣는다 — 경계(어제)와 한참 지난 것 둘 다
    for (const location of [own, ff, popup]) {
      await inbound(location.id, EXPIRED_EDGE, 8)
      await inbound(location.id, EXPIRED_OLD, 12)
    }

    expect(await scopes(product.id)).toEqual(before) // 만료 재고는 어느 수량도 늘리지 않는다

    // 만료 재고가 실제로 로트로 남아 있는지 확인한다 — 빠진 게 아니라 제외된 것이다 (REQ-5)
    const expiredLots = await db.lot.findMany({
      where: { productId: product.id, quantity: { gt: 0 }, expiryDate: { lt: today() } },
    })
    expect(expiredLots.reduce((s, l) => s + l.quantity, 0)).toBe(60)
  })

  it('C5. OWN에서 POPUP으로 내부 이동하면 즉시 출고 가능과 가용 재고만 감소한다', async () => {
    const { own, ff, popup, product } = await fixture()
    await inbound(own.id, VALID_FAR, 50)
    await inbound(ff.id, VALID_FAR, 20)
    const before = await scopes(product.id)

    const moved = 12
    await transfer(own.id, popup.id, VALID_FAR, moved)

    const after = await scopes(product.id)
    expect(after.readyToShip).toBe(before.readyToShip - moved)
    expect(after.available).toBe(before.available - moved)
    expect(after.total).toBe(before.total)

    // 각 수량이 종료 조건의 거점 범위와 여전히 일치하는지 독립으로 확인한다
    expect(after.readyToShip).toBe(await countByTypes(product.id, ['OWN']))
    expect(after.available).toBe(await countByTypes(product.id, ['OWN', 'FULFILLMENT']))
    expect(after.total).toBe(await countByTypes(product.id, ['OWN', 'FULFILLMENT', 'POPUP']))
  })

  it('C6. OWN에서 FULFILLMENT로 내부 이동하면 즉시 출고 가능만 감소한다', async () => {
    const { own, ff, popup, product } = await fixture()
    await inbound(own.id, VALID_FAR, 50)
    await inbound(popup.id, VALID_FAR, 15)
    const before = await scopes(product.id)

    const moved = 20
    await transfer(own.id, ff.id, VALID_FAR, moved)

    const after = await scopes(product.id)
    expect(after.readyToShip).toBe(before.readyToShip - moved)
    expect(after.available).toBe(before.available)
    expect(after.total).toBe(before.total)

    expect(after.readyToShip).toBe(await countByTypes(product.id, ['OWN']))
    expect(after.available).toBe(await countByTypes(product.id, ['OWN', 'FULFILLMENT']))
    expect(after.total).toBe(await countByTypes(product.id, ['OWN', 'FULFILLMENT', 'POPUP']))
  })

  it('C7. OWN 외부 입고는 세 재고 수량을 모두 증가시킨다', async () => {
    const { own, ff, popup, product } = await fixture()
    await inbound(own.id, VALID_FAR, 10)
    await inbound(ff.id, VALID_FAR, 10)
    await inbound(popup.id, VALID_FAR, 10)
    const before = await scopes(product.id)

    const received = 33
    await inbound(own.id, VALID_FAR, received)

    const after = await scopes(product.id)
    expect(after.readyToShip).toBe(before.readyToShip + received)
    expect(after.available).toBe(before.available + received)
    expect(after.total).toBe(before.total + received)
  })
})
