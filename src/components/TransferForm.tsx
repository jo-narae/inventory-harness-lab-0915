'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PickerRow } from './PickerRow'
import { QtyInput } from './QtyInput'
import { ProductPicker, type PickProduct } from './ProductPicker'
import { Qty } from './Qty'
import { sendTransfer } from '@/actions/transfer'
import { ALLOCATION, ALLOCATION_REASON, planAllocation } from '@/lib/fefo'
import { daysUntil, formatDate } from '@/lib/date'
import type { OutLot } from './OutboundForm'

/** 풀필먼트 발송 (S3) — 여러 SKU를 담아 한 곳으로 보낸다 */
export function TransferForm({
  products,
  ownLocations,
  destinations,
  lots,
}: {
  products: PickProduct[]
  ownLocations: { id: number; name: string }[]
  destinations: { id: number; name: string }[]
  lots: OutLot[]
}) {
  const router = useRouter()
  const [fromId, setFromId] = useState(String(ownLocations[0]?.id ?? ''))
  const [toId, setToId] = useState(String(destinations[0]?.id ?? ''))
  const [picking, setPicking] = useState(false)
  const [current, setCurrent] = useState<PickProduct | null>(null)
  const [qty, setQty] = useState('')
  const [cart, setCart] = useState<{ product: PickProduct; qty: number }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const stockOf = useMemo(
    () => (productId: number) =>
      lots
        .filter((l) => l.productId === productId && l.locationId === Number(fromId))
        .reduce((s, l) => s + l.quantity, 0),
    [lots, fromId]
  )

  const previewOf = (productId: number, q: number) => {
    const my = lots
      .filter((l) => l.productId === productId && l.locationId === Number(fromId))
      .map((l) => ({ id: l.id, expiryDate: new Date(l.expiry), quantity: l.quantity }))
    return planAllocation(my, q, ALLOCATION.LEFO).plan
  }

  const addToCart = () => {
    if (!current || Number(qty) <= 0) return
    setCart((p) => [...p, { product: current, qty: Number(qty) }])
    setCurrent(null)
    setQty('')
    setPicking(false)
  }

  const submit = async () => {
    setPending(true)
    setError(null)
    const res = await sendTransfer({
      fromLocationId: Number(fromId),
      toLocationId: Number(toId),
      lines: cart.map((c) => ({ productId: c.product.id, quantity: c.qty })),
    })
    setPending(false)
    if (!res.ok) return setError(res.error)
    router.push('/transfers')
    router.refresh()
  }

  if (picking) {
    return (
      <main className="pb-32">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <button onClick={() => setPicking(false)} className="text-[14.5px] font-extrabold">
            ‹ 상품 담기
          </button>
        </header>
        {!current ? (
          <ProductPicker products={products} onPick={setCurrent} title="상품 검색" />
        ) : (
          <>
            <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-acc-line bg-acc-soft px-3.5 py-2.5">
              <b className="text-[13px] text-acc">🦴 {current.name}</b>
              <span className="text-[11.5px] font-bold text-acc">보유 {stockOf(current.id)}{current.unit}</span>
            </div>
            <div className="mx-4 mt-3">
              <label className="mb-1 block text-[10.5px] text-sub">보낼 수량</label>
              <QtyInput autoFocus value={qty} onChange={setQty} unit={current.unit} />
            </div>
            {Number(qty) > 0 && (
              <div className="mx-4 mt-3 rounded-xl bg-dim px-3.5 py-2.5 text-[11.5px] text-[#5b5570]">
                <b className="mb-1 block text-[10.5px] text-sub">보낼 로트 — 유통기한 늦은 순</b>
                {previewOf(current.id, Number(qty)).map((a) => {
                  const lot = lots.find((l) => l.id === a.lotId)!
                  const risky = daysUntil(new Date(a.expiryDate)) <= lot.alertDays
                  return (
                    <p key={a.lotId} className={`tnum ${risky ? 'font-bold text-amber' : ''}`}>
                      {formatDate(new Date(a.expiryDate))} · {a.qty}{current.unit}
                      {risky && ' ⚠ 임박분이 포함됐습니다'}
                    </p>
                  )
                })}
                <p className="mt-1.5 text-[10.5px] text-sub">{ALLOCATION_REASON.LEFO}</p>
              </div>
            )}
            <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[560px] border-t border-line bg-white p-3 lg:max-w-[960px]">
              <button
                onClick={addToCart}
                disabled={Number(qty) <= 0 || Number(qty) > stockOf(current.id)}
                className="acc-grad w-full rounded-xl py-3.5 text-[14.5px] font-extrabold text-white disabled:opacity-40"
              >
                목록에 담기
              </button>
            </div>
          </>
        )}
      </main>
    )
  }

  const total = cart.reduce((s, c) => s + c.qty, 0)

  return (
    <main className="pb-32">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/" className="text-[14.5px] font-extrabold">
          ‹ 풀필먼트 발송
        </Link>
        <Link href="/transfers" className="text-[11.5px] text-acc">
          배송 중 보기
        </Link>
      </header>

      <PickerRow
        items={[
          {
            label: '보내는 곳',
            value: fromId,
            options: ownLocations.map((l) => ({ value: String(l.id), label: `📍 ${l.name}` })),
            onChange: setFromId,
          },
          {
            label: '도착 거점',
            value: toId,
            options: destinations.map((l) => ({ value: String(l.id), label: `📍 ${l.name}` })),
            onChange: setToId,
          },
        ]}
      />

      <p className="px-4 pb-1 pt-4 text-[10.5px] font-extrabold tracking-wider text-sub">
        발송 목록 {cart.length > 0 && `· ${cart.length}종 ${total}개`}
      </p>

      {cart.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12.5px] text-sub">
          아직 담은 상품이 없습니다
        </p>
      ) : (
        cart.map((c, i) => (
          <div key={i} className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="text-[13px] font-bold">{c.product.name}</p>
              <p className="mt-[2px] text-[10.5px] text-sub tnum">
                {previewOf(c.product.id, c.qty)
                  .map((a) => `${formatDate(new Date(a.expiryDate))} ${a.qty}${c.product.unit}`)
                  .join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Qty value={c.qty} unit={c.product.unit} size="md" />
              <button
                onClick={() => setCart((p) => p.filter((_, idx) => idx !== i))}
                className="text-[11px] font-bold text-amber"
              >
                삭제
              </button>
            </div>
          </div>
        ))
      )}

      <button
        onClick={() => setPicking(true)}
        className="mx-4 mt-3 w-[calc(100%-2rem)] rounded-xl bg-acc-soft py-3 text-[13px] font-extrabold text-acc"
      >
        ＋ 상품 담기
      </button>

      {error && (
        <p className="mx-4 mt-3 rounded-xl bg-red-bg px-3.5 py-2.5 text-[12px] font-bold text-red">
          {error}
        </p>
      )}

      <p className="mx-4 mt-4 rounded-xl bg-dim px-3.5 py-3 text-[11.5px] leading-relaxed text-[#5b5570]">
        발송하면 재고가 <b>배송 중</b>으로 옮겨갑니다. 도착 확인 전까지 가용 재고에서는 빠지지만
        <b> 총 재고는 그대로</b>입니다.
      </p>

      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[560px] border-t border-line bg-white p-3 lg:max-w-[960px]">
        <button
          onClick={submit}
          disabled={pending || cart.length === 0}
          className="acc-grad w-full rounded-xl py-3.5 text-[14.5px] font-extrabold text-white disabled:opacity-40"
        >
          {pending ? '발송 중…' : `발송 확정 ${total > 0 ? `· ${total}개` : ''}`}
        </button>
      </div>
    </main>
  )
}
