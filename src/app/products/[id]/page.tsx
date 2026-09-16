import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LotCard } from '@/components/LotCard'
import { ExpiryBadge } from '@/components/StatusBadge'
import { Qty } from '@/components/Qty'
import { getProductDetail } from '@/lib/inventory'
import { formatDate, humanizeRemaining, daysUntil } from '@/lib/date'

export const dynamic = 'force-dynamic'

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { id } = await params
  const { view } = await searchParams
  const data = await getProductDetail(Number(id))
  if (!data) notFound()

  const { product, readyToShip, available, total, lotCards, locationCards, excluded } = data
  const byLocation = view === 'location'

  return (
    <main className="pb-16">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/" className="text-[14.5px] font-extrabold">
          ‹ {product.name}
        </Link>
        <span className="text-[11px] text-sub">{product.sku}</span>
      </header>

      {/* 세 수량은 범위가 다르다 — 모두 유통기한이 지난 재고는 뺀 값이다 (Issue #8) */}
      <section className="px-4 pb-1 pt-4">
        <p className="text-[11.5px] text-sub">즉시 출고 가능 · 자사창고</p>
        <p className="text-[40px] font-extrabold leading-tight tracking-[-0.035em] text-acc tnum">
          {readyToShip.toLocaleString()}
          <span className="ml-1 text-[13px] font-bold text-sub">{product.unit}</span>
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-line px-3 py-2">
            <dt className="text-[11px] text-sub">가용 재고</dt>
            <dd>
              <Qty value={available} unit={product.unit} size="lg" />
              <p className="mt-[2px] text-[10px] text-sub">자사창고 + 풀필먼트</p>
            </dd>
          </div>
          <div className="rounded-xl border border-line px-3 py-2">
            <dt className="text-[11px] text-sub">전체 재고</dt>
            <dd>
              <Qty value={total} unit={product.unit} size="lg" />
              <p className="mt-[2px] text-[10px] text-sub">가용 + 팝업</p>
            </dd>
          </div>
        </dl>
        <p className="mt-1.5 text-[10.5px] text-sub">유통기한이 지난 재고는 세 수량 모두에서 뺍니다</p>
      </section>

      <nav className="flex gap-1.5 px-4 pt-2">
        {[
          { key: 'expiry', label: '유통기한순' },
          { key: 'location', label: '거점순' },
        ].map((t) => {
          const on = (t.key === 'location') === byLocation
          return (
            <Link
              key={t.key}
              href={`/products/${product.id}${t.key === 'location' ? '?view=location' : ''}`}
              className={`rounded-lg border px-2.5 py-1 text-[11.5px] ${
                on
                  ? 'border-acc-line bg-acc-soft font-extrabold text-acc'
                  : 'border-[#e2ddec] text-[#5b5570]'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>

      {!byLocation ? (
        <>
          <div className="px-4 pb-1 pt-3">
            <p className="text-[10.5px] font-extrabold tracking-wider text-sub">
              로트 = 거점 × 유통기한 · <span className="text-acc">출고</span> 나가는 순서
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-sub">
              출고·팝업 반출은 <b className="text-[#5b5570]">임박한 것부터</b>, 풀필먼트 발송은{' '}
              <b className="text-[#5b5570]">반대로 넉넉한 것부터</b> 나갑니다
            </p>
          </div>
          <div className="px-4">
            {lotCards.length === 0 && (
              <p className="py-10 text-center text-[13px] text-sub">가용 재고가 없습니다</p>
            )}
            {lotCards.map((c) => (
              <LotCard
                key={c.expiryDate.toISOString()}
                expiryDate={c.expiryDate}
                total={c.total}
                rank={c.rank}
                status={c.status}
                entries={c.entries}
                unit={product.unit}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="px-4 pb-1 pt-3 text-[10.5px] font-extrabold tracking-wider text-sub">
            거점별 보유
          </p>
          <div className="px-4">
            {locationCards.map((c) => (
              <div key={c.locationName} className="mt-2 overflow-hidden rounded-2xl border border-line">
                <div className="flex items-center justify-between border-b border-line bg-dim px-3.5 py-2.5">
                  <b className="text-[13px]">📍 {c.locationName}</b>
                  <Qty value={c.total} unit={product.unit} size="md" />
                </div>
                {c.lots.map((l) => (
                  <div
                    key={l.expiryDate.toISOString()}
                    className="flex items-center justify-between border-b border-line px-3.5 py-2 text-[11.5px] last:border-b-0"
                  >
                    <span className="flex items-center gap-1.5">
                      <ExpiryBadge status={l.status} />
                      <b className="tnum">{formatDate(l.expiryDate)}</b>
                      <span className="text-sub">· {humanizeRemaining(l.expiryDate)}</span>
                    </span>
                    <Qty value={l.qty} unit={product.unit} size="sm" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {excluded.length > 0 && (
        <>
          <p className="px-4 pb-1 pt-4 text-[10.5px] font-extrabold tracking-wider text-sub">
            가용에서 제외
          </p>
          {excluded.map((e, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-line bg-dim px-4 py-2.5 text-sub"
            >
              <div>
                <p className="text-[12.5px] font-semibold">{e.locationName}</p>
                <p className="mt-[2px] text-[10.5px] tnum">
                  {formatDate(e.expiryDate)} · {daysUntil(e.expiryDate)}일
                </p>
              </div>
              <Qty value={e.qty} unit={product.unit} size="md" />
            </div>
          ))}
        </>
      )}
    </main>
  )
}
