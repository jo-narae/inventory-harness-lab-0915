import { db } from './db'
import { addDays, dateOnly, daysUntil, today } from './date'
import { expiryStatus, type ExpiryStatus } from './expiry'
import {
  AVAILABLE_LOCATION_TYPES,
  HELD_LOCATION_TYPES,
  LOCATION_TYPES,
  READY_TO_SHIP_LOCATION_TYPES,
  TRANSIT_DELAY_DAYS,
} from './constants'

/** 재고 목록 한 줄에 필요한 것 (05-design 4.4) */
export type StockRowData = {
  productId: number
  sku: string
  name: string
  unit: string
  available: number // 지금 출고 가능 (배송 중·팝업 제외)
  byLocation: { name: string; type: string; qty: number }[]
  excluded: { name: string; type: string; qty: number }[]
  headline: { expiryDate: Date; status: ExpiryStatus; days: number; locationName: string; qty: number } | null
}

export async function getStockRows(params: { q?: string; filter?: string } = {}) {
  const { q, filter } = params

  const products = await db.product.findMany({
    where: {
      isActive: true,
      ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }] } : {}),
    },
    include: {
      lots: { where: { quantity: { gt: 0 } }, include: { location: true } },
    },
    orderBy: { name: 'asc' },
  })

  const rows: StockRowData[] = products.map((p) => {
    const available = p.lots
      .filter((l) => (AVAILABLE_LOCATION_TYPES as string[]).includes(l.location.type))
      .reduce((s, l) => s + l.quantity, 0)

    const group = (types: string[]) => {
      const map = new Map<string, { name: string; type: string; qty: number }>()
      for (const l of p.lots) {
        if (!types.includes(l.location.type)) continue
        const cur = map.get(l.location.name) ?? { name: l.location.name, type: l.location.type, qty: 0 }
        cur.qty += l.quantity
        map.set(l.location.name, cur)
      }
      return [...map.values()].sort((a, b) => b.qty - a.qty)
    }

    // 가장 임박한 로트 = 목록에서 대표로 보여줄 유통기한
    // 로트는 '거점 × 유통기한'이므로 거점을 합산하지 않는다. 지금 손댈 수 있는 거점만 본다.
    const actionable = p.lots
      .filter((l) => (AVAILABLE_LOCATION_TYPES as string[]).includes(l.location.type))
      .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime() || b.quantity - a.quantity)
    const head = actionable[0]

    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      available,
      byLocation: group([...AVAILABLE_LOCATION_TYPES]),
      excluded: group([LOCATION_TYPES.TRANSIT, LOCATION_TYPES.POPUP]),
      headline: head
        ? {
            expiryDate: head.expiryDate,
            status: expiryStatus(head.expiryDate, p.expiryAlertDays),
            days: daysUntil(head.expiryDate),
            locationName: head.location.name,
            qty: head.quantity,
          }
        : null,
    }
  })

  // 필터
  const filtered = rows.filter((r) => {
    if (!filter || filter === 'all') return true
    if (filter === 'soon') return r.headline?.status === 'SOON'
    if (filter === 'expired') return r.headline?.status === 'EXPIRED'
    return r.byLocation.some((l) => l.name === filter) || r.excluded.some((l) => l.name === filter)
  })

  return filtered
}

/** 홈 상단 요약 */
export async function getSummary() {
  const [skuCount, agg] = await Promise.all([
    db.product.count({ where: { isActive: true } }),
    db.lot.aggregate({
      _sum: { quantity: true },
      where: { quantity: { gt: 0 }, location: { type: { in: [...AVAILABLE_LOCATION_TYPES] } } },
    }),
  ])
  return { skuCount, available: agg._sum.quantity ?? 0 }
}

/** 오늘 할 일 (E2) — 세 종류로 고정한다 */
export async function getTodos() {
  const fulfillments = await db.location.findMany({
    where: { type: LOCATION_TYPES.FULFILLMENT, isActive: true },
    orderBy: { name: 'asc' },
  })
  const t = new Date()
  const reflected = fulfillments.map((f) => ({
    id: f.id,
    name: f.name,
    done: !!f.lastReflectedAt && f.lastReflectedAt.toDateString() === t.toDateString(),
    lastReflectedAt: f.lastReflectedAt,
  }))

  const sentTransfers = await db.transfer.findMany({
    where: { status: 'SENT' },
    include: { toLocation: true },
    orderBy: { sentAt: 'asc' },
  })
  const delayed = sentTransfers.filter(
    (t2) => Math.floor((Date.now() - t2.sentAt.getTime()) / 86_400_000) >= TRANSIT_DELAY_DAYS
  )

  const expiredLots = await db.lot.findMany({
    where: { quantity: { gt: 0 }, expiryDate: { lt: today() } },
    include: { product: true, location: true },
  })

  return {
    fulfillments: reflected,
    pendingReflect: reflected.filter((r) => !r.done).length,
    transfersInTransit: sentTransfers.length,
    transfersDelayed: delayed.length,
    expiredCount: expiredLots.length,
    total:
      reflected.filter((r) => !r.done).length + delayed.length + (expiredLots.length > 0 ? 1 : 0),
  }
}

/** 임박·만료 건수 (필터 칩에 표시) */
export async function getExpiryCounts() {
  const lots = await db.lot.findMany({
    where: { quantity: { gt: 0 } },
    include: { product: true },
  })
  let soon = 0
  let expired = 0
  for (const l of lots) {
    const s = expiryStatus(l.expiryDate, l.product.expiryAlertDays)
    if (s === 'SOON') soon++
    if (s === 'EXPIRED') expired++
  }
  return { soon, expired }
}

export async function getLocations() {
  return db.location.findMany({
    where: { isActive: true, type: { notIn: [LOCATION_TYPES.DISPOSAL] } },
    orderBy: { id: 'asc' },
  })
}

/** 상품 상세 — 로트를 유통기한순(FEFO 순서)으로 (05-design 4.5) */
export async function getProductDetail(productId: number) {
  const product = await db.product.findUnique({
    where: { id: productId },
    include: {
      lots: { where: { quantity: { gt: 0 } }, include: { location: true } },
    },
  })
  if (!product) return null

  // 재고 범위 세 가지 (Issue #8) — 유통기한이 지난 재고는 거점과 관계없이 어디에도 넣지 않는다
  const valid = product.lots.filter((l) => daysUntil(l.expiryDate) >= 0)
  const sumOf = (types: string[]) =>
    valid.filter((l) => types.includes(l.location.type)).reduce((s, l) => s + l.quantity, 0)
  const readyToShip = sumOf(READY_TO_SHIP_LOCATION_TYPES) // 즉시 출고 가능
  const available = sumOf(AVAILABLE_LOCATION_TYPES) // 가용 재고
  const total = sumOf(HELD_LOCATION_TYPES) // 전체 재고

  // 유통기한별로 묶되, 안에 거점별 수량을 반드시 나열한다
  const byExpiry = new Map<
    number,
    { expiryDate: Date; total: number; entries: { locationName: string; type: string; qty: number }[] }
  >()
  for (const l of product.lots) {
    if (!(AVAILABLE_LOCATION_TYPES as string[]).includes(l.location.type)) continue
    const key = l.expiryDate.getTime()
    const cur = byExpiry.get(key) ?? { expiryDate: l.expiryDate, total: 0, entries: [] }
    cur.total += l.quantity
    cur.entries.push({ locationName: l.location.name, type: l.location.type, qty: l.quantity })
    byExpiry.set(key, cur)
  }
  const lotCards = [...byExpiry.values()]
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime())
    .map((c, i) => ({
      ...c,
      rank: i + 1,
      status: expiryStatus(c.expiryDate, product.expiryAlertDays),
      days: daysUntil(c.expiryDate),
      entries: c.entries.sort((a, b) => b.qty - a.qty),
    }))

  // 거점순 보기
  const byLocation = new Map<
    string,
    { locationName: string; type: string; total: number; lots: { expiryDate: Date; qty: number; status: ExpiryStatus; days: number }[] }
  >()
  for (const l of product.lots) {
    const cur = byLocation.get(l.location.name) ?? {
      locationName: l.location.name,
      type: l.location.type,
      total: 0,
      lots: [],
    }
    cur.total += l.quantity
    cur.lots.push({
      expiryDate: l.expiryDate,
      qty: l.quantity,
      status: expiryStatus(l.expiryDate, product.expiryAlertDays),
      days: daysUntil(l.expiryDate),
    })
    byLocation.set(l.location.name, cur)
  }
  const locationCards = [...byLocation.values()].map((c) => ({
    ...c,
    lots: c.lots.sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime()),
  }))

  const excluded = product.lots
    .filter((l) => !(AVAILABLE_LOCATION_TYPES as string[]).includes(l.location.type))
    .map((l) => ({
      locationName: l.location.name,
      type: l.location.type,
      qty: l.quantity,
      expiryDate: l.expiryDate,
    }))

  return { product, readyToShip, available, total, lotCards, locationCards, excluded }
}

// ───────────────────────── 풀필먼트 일일 반영 (S5)

/** 최근 움직임 판정 기준 — 이 안에 입출고가 있었으면 오늘도 있을 가능성이 높다 */
const RECENT_DAYS = 14

export type FulfillmentCard = {
  id: number
  name: string
  lastReflectedAt: Date | null
  doneToday: boolean
  daysSince: number | null
  skuCount: number
  total: number
}

/** 반영 대상 거점 목록 — 마지막 반영일이 곧 그 숫자의 신뢰도다 (P6) */
export async function getFulfillmentLocations(): Promise<FulfillmentCard[]> {
  const locations = await db.location.findMany({
    where: { type: LOCATION_TYPES.FULFILLMENT, isActive: true },
    include: { lots: { where: { quantity: { gt: 0 } } } },
    orderBy: { id: 'asc' },
  })
  const now = new Date()

  return locations.map((l) => ({
    id: l.id,
    name: l.name,
    lastReflectedAt: l.lastReflectedAt,
    doneToday: !!l.lastReflectedAt && l.lastReflectedAt.toDateString() === now.toDateString(),
    daysSince: l.lastReflectedAt
      ? Math.floor((today().getTime() - dateOnly(l.lastReflectedAt).getTime()) / 86_400_000)
      : null,
    skuCount: new Set(l.lots.map((lot) => lot.productId)).size,
    total: l.lots.reduce((s, lot) => s + lot.quantity, 0),
  }))
}

/** 마지막 반영일은 단순 날짜가 아니라 그 거점 숫자의 신뢰도다 (P6) */
export function reflectedLabel(daysSince: number | null) {
  if (daysSince === null) return '없음'
  if (daysSince === 0) return '오늘'
  if (daysSince === 1) return '어제'
  return `${daysSince}일 전`
}

export type SheetRow = {
  productId: number
  sku: string
  name: string
  unit: string
  current: number
  recent: boolean // 최근 14일 안에 움직임이 있었다
  lots: { id: number; expiry: string; quantity: number }[] // FEFO 순
}

/**
 * 일일 반영 시트 — 상품을 하나씩 검색하게 만들지 않는다.
 * 3사 × 10SKU면 하루 30번 검색이 되어 앱이 버려진다 (S5).
 * 이 거점에 재고가 있는 상품만 나열하고, 수량칸만 채우게 한다.
 */
export async function getFulfillmentSheet(locationId: number) {
  const location = await db.location.findUnique({ where: { id: locationId } })
  if (!location || location.type !== LOCATION_TYPES.FULFILLMENT) return null

  const [lots, recentMovements] = await Promise.all([
    db.lot.findMany({
      where: { locationId, quantity: { gt: 0 } },
      include: { product: true },
      orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
    }),
    db.movement.findMany({
      where: {
        createdAt: { gte: addDays(today(), -RECENT_DAYS) },
        OR: [{ fromLocationId: locationId }, { toLocationId: locationId }],
      },
      select: { productId: true },
    }),
  ])

  const recentIds = new Set(recentMovements.map((m) => m.productId))
  const byProduct = new Map<number, SheetRow>()

  for (const lot of lots) {
    const row = byProduct.get(lot.productId) ?? {
      productId: lot.productId,
      sku: lot.product.sku,
      name: lot.product.name,
      unit: lot.product.unit,
      current: 0,
      recent: recentIds.has(lot.productId),
      lots: [],
    }
    row.current += lot.quantity
    row.lots.push({ id: lot.id, expiry: lot.expiryDate.toISOString(), quantity: lot.quantity })
    byProduct.set(lot.productId, row)
  }

  const rows = [...byProduct.values()].sort(
    (a, b) => Number(b.recent) - Number(a.recent) || a.name.localeCompare(b.name, 'ko')
  )
  return { location, rows }
}

// ───────────────────────── 팝업 반출서 (S6)

/** 가져가는 곳 × 상품 → 지금 출고 가능한 수량 */
export type SourceStockMap = Record<number, Record<number, number>>

/**
 * 반출서 작성 화면용 — 가져가는 곳별·상품별 현재 가용 재고.
 *
 * 반출서는 계획이라 재고를 움직이지 않지만, 지금 창고에 무엇이 얼마나 있는지 모르면
 * 실제와 크게 어긋난 계획을 쓰게 된다. 숫자를 보여줄 뿐 수량을 막지는 않는다.
 * 기준은 재고 목록·상품 상세와 같다 — 배송 중·팝업 거점은 가용에서 빠진다.
 */
export async function getPopupSourceStock(locationIds: number[]): Promise<SourceStockMap> {
  if (locationIds.length === 0) return {}

  const lots = await db.lot.findMany({
    where: {
      locationId: { in: locationIds },
      quantity: { gt: 0 },
      location: { type: { in: [...AVAILABLE_LOCATION_TYPES] } },
    },
    select: { locationId: true, productId: true, quantity: true },
  })

  const map: SourceStockMap = {}
  for (const id of locationIds) map[id] = {}
  for (const lot of lots) {
    const byProduct = (map[lot.locationId] ??= {})
    byProduct[lot.productId] = (byProduct[lot.productId] ?? 0) + lot.quantity
  }
  return map
}
