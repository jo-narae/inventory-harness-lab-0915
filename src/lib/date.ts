/** 날짜 유틸 — 유통기한은 시각을 갖지 않는 '날짜'로 다룬다 (UTC 자정 고정) */

export function dateOnly(d: Date | string): Date {
  const x = typeof d === 'string' ? new Date(d) : d
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()))
}

export function today(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return dateOnly(d)
}

/** 오늘 기준 남은 일수. 음수면 이미 지난 것 */
export function daysUntil(target: Date): number {
  const MS = 86_400_000
  return Math.round((dateOnly(target).getTime() - today().getTime()) / MS)
}

/** 그때부터 지금까지 지난 일수 (발송 후 경과일 등) */
export function daysAgo(from: Date): number {
  return Math.floor((Date.now() - from.getTime()) / 86_400_000)
}

/** 2026-11-30 형식 */
export function formatDate(d: Date): string {
  return dateOnly(d).toISOString().slice(0, 10)
}

/** 남은 기간을 사람 말로: 23일 / 1년 7개월 / 8일 지남 */
export function humanizeRemaining(target: Date): string {
  const days = daysUntil(target)
  if (days < 0) return `${Math.abs(days)}일 지남`
  if (days === 0) return '오늘까지'
  if (days < 60) return `${days}일`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}개월`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return rest === 0 ? `${years}년` : `${years}년 ${rest}개월`
}

/**
 * 유통기한 6자리 입력 파싱 (E1)
 *   '270331' → 2027-03-31
 *   '2703'   → 2027-03-31 (해당 월의 말일)
 */
export function parseExpiryInput(raw: string): { date: Date | null; error?: string } {
  const s = raw.replace(/\D/g, '')
  if (s.length !== 4 && s.length !== 6) {
    return { date: null, error: '6자리(YYMMDD) 또는 4자리(YYMM)로 입력하세요' }
  }
  const year = 2000 + Number(s.slice(0, 2))
  const month = Number(s.slice(2, 4))
  if (month < 1 || month > 12) return { date: null, error: '월이 올바르지 않습니다' }

  let day: number
  if (s.length === 4) {
    day = new Date(Date.UTC(year, month, 0)).getUTCDate() // 말일
  } else {
    day = Number(s.slice(4, 6))
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (day < 1 || day > lastDay) return { date: null, error: '일이 올바르지 않습니다' }
  }
  return { date: new Date(Date.UTC(year, month - 1, day)) }
}

/** 저장 전 상식 검사 — 막지는 않고 경고 문구만 돌려준다 */
export function expiryWarning(date: Date): string | null {
  const days = daysUntil(date)
  if (days < 0) return '이미 지난 날짜입니다'
  if (days > 3650) return '10년을 넘는 유통기한입니다. 확인해주세요'
  return null
}
