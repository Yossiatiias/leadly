// ─── טווחי תאריכים מהירים — משותף בין מסך "מאגר פונים" למסך "דוחות" ─────────
// חולץ לכאן כי לוגיקה טהורה (בלי תלות ב-DB/React) קלה יותר לבדוק, ומונעת
// שני יישומים שיתבדרו זה מזה בטעות עם הזמן

export type QuickRange = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth'

export const QUICK_RANGES: { key: QuickRange; label: string }[] = [
  { key: 'today',     label: 'היום' },
  { key: 'yesterday', label: 'אתמול' },
  { key: 'week',      label: 'השבוע' },
  { key: 'month',     label: 'החודש' },
  { key: 'lastMonth', label: 'חודש שעבר' },
]

/* תאריך מקומי כ-YYYY-MM-DD */
export function dstr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function quickRangeDates(key: QuickRange): { start: string; end: string } {
  const now = new Date()
  const today = dstr(now)
  if (key === 'today') return { start: today, end: today }
  if (key === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1)
    return { start: dstr(y), end: dstr(y) }
  }
  if (key === 'week') {
    const sunday = new Date(now); sunday.setDate(sunday.getDate() - sunday.getDay())
    return { start: dstr(sunday), end: today }
  }
  if (key === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: dstr(first), end: today }
  }
  // lastMonth
  const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastLast = new Date(now.getFullYear(), now.getMonth(), 0)
  return { start: dstr(firstLast), end: dstr(lastLast) }
}
