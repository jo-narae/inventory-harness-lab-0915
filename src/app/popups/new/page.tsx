import { PopupCreateForm } from '@/components/PopupCreateForm'
import { db } from '@/lib/db'
import { getPopupSourceStock } from '@/lib/inventory'
import { LOCATION_TYPES } from '@/lib/constants'
import { formatDate, today } from '@/lib/date'

export const dynamic = 'force-dynamic'

export default async function NewPopupPage() {
  const [products, sources] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, unit: true },
      orderBy: { name: 'asc' },
    }),
    db.location.findMany({
      where: { isActive: true, type: LOCATION_TYPES.OWN },
      select: { id: true, name: true },
    }),
  ])

  // 반출서를 쓰는 사람이 지금 창고에 얼마나 있는지 보고 수량을 정할 수 있게 한다
  const sourceStock = await getPopupSourceStock(sources.map((s) => s.id))

  return (
    <PopupCreateForm
      products={products}
      sources={sources}
      sourceStock={sourceStock}
      today={formatDate(today())}
    />
  )
}
