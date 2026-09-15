import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { ReceiveForm } from '@/components/ReceiveForm'
import { Badge } from '@/components/StatusBadge'
import { Qty } from '@/components/Qty'
import { TRANSFER_STATUS, TRANSIT_DELAY_DAYS } from '@/lib/constants'
import { daysAgo, formatDate } from '@/lib/date'

export const dynamic = 'force-dynamic'

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const transfer = await db.transfer.findUnique({
    where: { id: Number(id) },
    include: {
      fromLocation: true,
      toLocation: true,
      sentBy: true,
      receivedBy: true,
      lines: { include: { product: true } },
    },
  })
  if (!transfer) notFound()

  const days = daysAgo(transfer.sentAt)
  const delayed = days >= TRANSIT_DELAY_DAYS && transfer.status === TRANSFER_STATUS.SENT
  const qty = transfer.lines.reduce((s, l) => s + l.sentQty, 0)

  return (
    <main className="pb-32">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/transfers" className="text-[14.5px] font-extrabold">
          ‹ {transfer.fromLocation.name} → {transfer.toLocation.name}
        </Link>
        {delayed ? (
          <Badge tone="red">지연 {days}일</Badge>
        ) : transfer.status === TRANSFER_STATUS.RECEIVED ? (
          <Badge tone="ok">도착 완료</Badge>
        ) : (
          <Badge tone="acc">{days}일 경과</Badge>
        )}
      </header>

      <div className="border-b border-line bg-dim px-4 py-3 text-[11.5px] text-[#5b5570]">
        <p className="tnum">
          {formatDate(transfer.sentAt)} 발송 · {transfer.sentBy.name} · {transfer.lines.length}종{' '}
          {qty}개
        </p>
        {transfer.receivedAt && (
          <p className="mt-1 tnum">
            {formatDate(transfer.receivedAt)} 도착 확인 · {transfer.receivedBy?.name}
          </p>
        )}
        {delayed && (
          <p className="mt-1.5 font-bold text-red">
            보통 3~5일이면 도착합니다. {days}일째 확인되지 않았습니다
          </p>
        )}
      </div>

      {transfer.status === TRANSFER_STATUS.SENT ? (
        <ReceiveForm
          transferId={transfer.id}
          destination={transfer.toLocation.name}
          lines={transfer.lines.map((l) => ({
            id: l.id,
            productName: l.product.name,
            expiry: l.expiryDate.toISOString(),
            sentQty: l.sentQty,
          }))}
        />
      ) : (
        <>
          <p className="px-4 pb-1 pt-4 text-[10.5px] font-extrabold tracking-wider text-sub">
            도착 내역
          </p>
          {transfer.lines.map((l) => (
            <div key={l.id} className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-[13px] font-bold">{l.product.name}</p>
                <p className="mt-[2px] text-[10.5px] text-sub tnum">
                  {formatDate(l.expiryDate)} · 보낸 {l.sentQty}{l.product.unit}
                  {l.receivedQty !== null && l.receivedQty !== l.sentQty && (
                    <span className="font-bold text-amber">
                      {' '}· 도착 {l.receivedQty}
                      {l.product.unit}
                    </span>
                  )}
                </p>
              </div>
              <Qty value={l.receivedQty ?? l.sentQty} unit={l.product.unit} size="lg" />
            </div>
          ))}
        </>
      )}
    </main>
  )
}
