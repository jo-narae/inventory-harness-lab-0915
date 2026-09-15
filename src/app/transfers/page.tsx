import Link from 'next/link'
import { db } from '@/lib/db'
import { Badge } from '@/components/StatusBadge'
import { TRANSFER_STATUS, TRANSIT_DELAY_DAYS } from '@/lib/constants'
import { daysAgo, formatDate } from '@/lib/date'

export const dynamic = 'force-dynamic'

export default async function TransfersPage() {
  const [sent, received] = await Promise.all([
    db.transfer.findMany({
      where: { status: TRANSFER_STATUS.SENT },
      include: { toLocation: true, fromLocation: true, lines: { include: { product: true } } },
      orderBy: { sentAt: 'asc' },
    }),
    db.transfer.findMany({
      where: { status: TRANSFER_STATUS.RECEIVED },
      include: { toLocation: true, lines: true },
      orderBy: { receivedAt: 'desc' },
      take: 5,
    }),
  ])

  const transitTotal = sent.reduce(
    (s, t) => s + t.lines.reduce((x, l) => x + l.sentQty, 0),
    0
  )

  return (
    <main className="pb-16">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/" className="text-[14.5px] font-extrabold">
          ‹ 배송 중
        </Link>
        <Link href="/transfers/new" className="text-[11.5px] font-bold text-acc">
          ＋ 발송
        </Link>
      </header>

      <p className="border-b border-line bg-dim px-4 py-2.5 text-[11.5px] text-[#5b5570]">
        {sent.length}건 · 총 {transitTotal}개가 이동 중입니다. 도착 확인을 해야 풀필먼트 재고로 잡힙니다
      </p>

      {sent.length === 0 && (
        <p className="px-4 py-12 text-center text-[13px] text-sub">배송 중인 건이 없습니다</p>
      )}

      {sent.map((t) => {
        const d = daysAgo(t.sentAt)
        const delayed = d >= TRANSIT_DELAY_DAYS
        const qty = t.lines.reduce((s, l) => s + l.sentQty, 0)
        return (
          <Link
            key={t.id}
            href={`/transfers/${t.id}`}
            className={`block border-b border-line px-4 py-3 ${delayed ? 'bg-[#fdf6f3]' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-bold">
                  {t.fromLocation.name} → {t.toLocation.name}
                </p>
                <p className="mt-[3px] text-[11px] text-sub tnum">
                  {formatDate(t.sentAt)} 발송 ·{' '}
                  <b className={delayed ? 'text-red' : 'text-[#5b5570]'}>{d}일 경과</b> ·{' '}
                  {t.lines.length}종 {qty}개
                </p>
              </div>
              {delayed ? <Badge tone="red">지연</Badge> : <Badge tone="acc">정상</Badge>}
            </div>
            <p className="mt-1.5 text-[10.5px] text-[#a9a3b8]">
              {t.lines
                .slice(0, 3)
                .map((l) => `${l.product.name} ${l.sentQty}${l.product.unit}`)
                .join(' · ')}
              {t.lines.length > 3 && ` 외 ${t.lines.length - 3}건`}
            </p>
          </Link>
        )
      })}

      {received.length > 0 && (
        <>
          <p className="px-4 pb-1 pt-5 text-[10.5px] font-extrabold tracking-wider text-sub">
            최근 도착 완료
          </p>
          {received.map((t) => (
            <div key={t.id} className="border-b border-line px-4 py-2.5 text-[11.5px] text-sub">
              {t.toLocation.name} · {formatDate(t.receivedAt!)} 도착 ·{' '}
              {t.lines.reduce((s, l) => s + (l.receivedQty ?? 0), 0)}개
            </div>
          ))}
        </>
      )}
    </main>
  )
}
