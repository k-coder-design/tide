/** Local dates as YYYY-MM-DD strings, the way the core stores them. */

const pad = (n: number) => String(n).padStart(2, '0')

export const toDateKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const today = (): string => toDateKey(new Date())

export const nowTime = (): string => {
  const now = new Date()
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, day)
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

/** "Tuesday, 17 November" */
export const longDate = (key: string): string =>
  parseDateKey(key).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

/** "Tue 17 Nov", with the year when it is not this year. */
export function shortDate(key: string): string {
  const date = parseDateKey(key)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "Today · Tue 17 Nov", "Yesterday · Mon 16 Nov", or just the date. */
export function dayHeading(key: string): string {
  const now = today()
  if (key === now) return `Today · ${shortDate(key)}`
  if (key === addDays(now, -1)) return `Yesterday · ${shortDate(key)}`
  return shortDate(key)
}

/** "Today, 17 Nov" for the entry form. */
export function formDate(key: string): string {
  const date = parseDateKey(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (key === today()) return `Today, ${date}`
  if (key === addDays(today(), -1)) return `Yesterday, ${date}`
  return parseDateKey(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export const monthKey = (key: string): string => key.slice(0, 7)

export function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number]
  const date = new Date(year, m - 1 + by, 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

export const monthTitle = (month: string): string =>
  parseDateKey(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

/** The month as calendar cells, Monday first; null for the blanks before day 1. */
export function monthCells(month: string): Array<string | null> {
  const first = parseDateKey(`${month}-01`)
  const blanks = (first.getDay() + 6) % 7
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return [...Array<null>(blanks).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)]
}

/** One-letter weekday: M T W T F S S. */
export const weekdayLetter = (key: string): string =>
  parseDateKey(key).toLocaleDateString('en-GB', { weekday: 'narrow' })
