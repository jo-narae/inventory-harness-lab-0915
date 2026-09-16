'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { QtyInput } from './QtyInput'
import { ProductPicker, type PickProduct } from './ProductPicker'
import { PickerRow } from './PickerRow'
import { Qty } from './Qty'
import { createPopup } from '@/actions/popup'
import type { SourceStockMap } from '@/lib/inventory'

/**
 * 팝업 만들기 + 반출서 (S6) — P2(영업)가 행사 며칠 전에 쓰는 화면.
 * 반출서는 계획일 뿐이다. 여기서는 재고가 1개도 움직이지 않는다.
 */
export function PopupCreateForm({
  products,
  sources,
  sourceStock,
  today,
}: {
  products: PickProduct[]
  sources: { id: number; name: string }[]
  /** 가져가는 곳 × 상품 → 지금 출고 가능한 수량 (안내용) */
  sourceStock: SourceStockMap
  today: string // YYYY-MM-DD
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [sourceId, setSourceId] = useState(String(sources[0]?.id ?? ''))
  const [lines, setLines] = useState<{ product: PickProduct; qty: number }[]>([])
  const [picking, setPicking] = useState(false)
  const [current, setCurrent] = useState<PickProduct | null>(null)
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  /**
   * 지금 그 창고에서 출고 가능한 수량. 반출서는 계획이므로 이 숫자를 넘겨도 담을 수 있다 —
   * 막기 위한 값이 아니라, 실제와 크게 어긋난 계획을 쓰지 않도록 보여주는 값이다.
   */
  const availableOf = (productId: number) => sourceStock[Number(sourceId)]?.[productId] ?? 0

  const submit = async () => {
    setPending(true)
    setError(null)
    const res = await createPopup({
      name,
      startDate: start,
      endDate: end,
      sourceLocationId: Number(sourceId),
      planLines: lines.map((l) => ({ productId: l.product.id, plannedQty: l.qty })),
    })
    setPending(false)
    if (!res.ok) return setError(res.error)
    router.push(`/popups/${res.popupId}`)
    router.refresh()
  }

  if (picking) {
    return (
      <main className="pb-32">
        <header className="border-b border-line px-4 py-3">
          <button onClick={() => setPicking(false)} className="text-[14.5px] font-extrabold">
            ‹ 반출서에 담기
          </button>
        </header>
        {!current ? (
          <ProductPicker products={products} onPick={setCurrent} title="상품 검색" />
        ) : (
          <>
            <div className="mx-4 mt-3 rounded-xl border border-acc-line bg-acc-soft px-3.5 py-2.5 text-[13px] font-bold text-acc">
              🦴 {current.name}
            </div>
            <div className="mx-4 mt-2 flex items-center justify-between rounded-xl bg-dim px-3.5 py-2.5">
              <span className="text-[11.5px] text-[#5b5570]">
                {sources.find((s) => String(s.id) === sourceId)?.name ?? '가져가는 곳'} 가용 재고
              </span>
              <span className="text-[13px] font-extrabold tnum">
                {availableOf(current.id).toLocaleString()}
                {current.unit}
              </span>
            </div>
            <div className="mx-4 mt-3">
              <label className="mb-1 block text-[10.5px] text-sub">가져갈 예정 수량</label>
              <QtyInput autoFocus value={qty} onChange={setQty} unit={current.unit} />
              {Number(qty) > availableOf(current.id) && (
                <p className="mt-1.5 text-[11.5px] font-bold text-amber">
                  가용 재고보다 많습니다. 반출서는 계획이므로 이대로 담을 수 있습니다
                </p>
              )}
            </div>
            <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[560px] border-t border-line bg-white p-3 lg:max-w-[960px]">
              <button
                onClick={() => {
                  setLines((p) => [...p, { product: current, qty: Number(qty) }])
                  setCurrent(null)
                  setQty('')
                  setPicking(false)
                }}
                disabled={Number(qty) <= 0}
                className="acc-grad w-full rounded-xl py-3.5 text-[14.5px] font-extrabold text-white disabled:opacity-40"
              >
                반출서에 담기
              </button>
            </div>
          </>
        )}
      </main>
    )
  }

  const total = lines.reduce((s, l) => s + l.qty, 0)

  return (
    <main className="pb-32">
      <header className="border-b border-line px-4 py-3">
        <Link href="/popups" className="text-[14.5px] font-extrabold">
          ‹ 팝업 만들기
        </Link>
      </header>

      <div className="px-4 pt-3">
        <label className="mb-1 block text-[10.5px] text-sub">팝업 이름</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 성수 팝업"
          className="w-full rounded-xl border-2 border-acc px-3.5 py-2.5 text-[14px] font-bold outline-none"
        />
      </div>

      <div className="flex gap-2 px-4 pt-3">
        {[
          { label: '시작일', value: start, set: setStart },
          { label: '종료일', value: end, set: setEnd },
        ].map((d) => (
          <div key={d.label} className="flex-1 rounded-xl border border-[#e2ddec] bg-[#f5f3f9] px-3 py-2">
            <span className="block text-[10.5px] text-sub">{d.label}</span>
            <input
              type="date"
              value={d.value}
              onChange={(e) => d.set(e.target.value)}
              className="w-full bg-transparent text-[12.5px] font-bold tnum outline-none"
            />
          </div>
        ))}
      </div>

      <PickerRow
        items={[
          {
            label: '가져가는 곳',
            value: sourceId,
            options: sources.map((s) => ({ value: String(s.id), label: `📍 ${s.name}` })),
            onChange: setSourceId,
          },
        ]}
      />

      <p className="px-4 pb-1 pt-4 text-[10.5px] font-extrabold tracking-wider text-sub">
        반출서 {lines.length > 0 && `· ${lines.length}종 ${total}개 예정`}
      </p>

      {lines.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-sub">
          가져갈 상품을 담으세요. 실제 수량은 반출할 때 다시 확인합니다
        </p>
      ) : (
        lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-bold">{l.product.name}</p>
              <p className="text-[10.5px] text-sub tnum">
                가용 {availableOf(l.product.id).toLocaleString()}
                {l.product.unit}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Qty value={l.qty} unit={l.product.unit} size="md" />
              <button
                onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
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
        반출서는 <b>계획</b>입니다. 저장해도 재고는 움직이지 않습니다. 창고 담당자가 실제로 물건을
        꺼낼 때 수량을 확인하고 <b>반출 확정</b>을 누르면 그때 재고가 팝업으로 옮겨집니다.
      </p>

      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[560px] border-t border-line bg-white p-3 lg:max-w-[960px]">
        <button
          onClick={submit}
          disabled={pending || !name.trim()}
          className="acc-grad w-full rounded-xl py-3.5 text-[14.5px] font-extrabold text-white disabled:opacity-40"
        >
          {pending ? '만드는 중…' : '팝업 만들기'}
        </button>
      </div>
    </main>
  )
}
