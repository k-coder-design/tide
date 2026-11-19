import type { InsightsBucket, InsightsDay, InsightsPeriod, InsightsSpan, LibidoInsights } from '../../shared/types'
import { addDays, type Context } from './context'
import { checkDate, checkOneOf } from './validation'

const PERIODS: readonly InsightsPeriod[] = ['12w', '6m', '1y']
/** Flow values that count as bleeding (T18); spotting does not. */
const BLEEDING = "('light', 'medium', 'heavy', 'unspecified')"
const COMPARE_DAYS = 28

interface DayRow {
  date: string
  partnered: number
  other: number
  desire: number | null
  bleeding: number
}

/**
 * Insights — libido (phase 5): activity and desire over a range, the last four weeks against the four before,
 * activity by day for the heat map. Read-only; numbers only, no advice.
 */
export class InsightsService {
  constructor(private readonly ctx: Context) {}

  libido(today: string, period: InsightsPeriod): LibidoInsights {
    const end = checkDate(today, 'Today')
    const chosen = checkOneOf(period, PERIODS, 'Period') ?? '12w'
    const ranges = chosen === '12w' ? weeks(end, 12) : months(end, chosen === '6m' ? 6 : 12)
    const from = ranges[0]!.from
    const compareFrom = addDays(end, -(2 * COMPARE_DAYS) + 1)
    const rows = this.dayRows(from < compareFrom ? from : compareFrom, end)
    const inRange = rows.filter((r) => r.date >= from)

    const buckets: InsightsBucket[] = ranges.map(({ from: start, to }) => {
      const days = inRange.filter((r) => r.date >= start && r.date <= to)
      return {
        from: start,
        to,
        partnered: sum(days, (d) => d.partnered),
        other: sum(days, (d) => d.other),
        desire: average(days),
        bleeding: days.some((d) => d.bleeding > 0)
      }
    })
    // Rates count from the first logged day, so a range reaching back before Tide was used is not diluted.
    const first = this.ctx.db
      .prepare('SELECT MIN(day) FROM (SELECT MIN(occurred_on) AS day FROM events UNION ALL SELECT MIN(date) FROM daily_checkins WHERE desire IS NOT NULL)')
      .pluck()
      .get() as string | null
    const length = dayCount(first && first > from ? (first > end ? end : first) : from, end)
    const span = (start: string, stop: string): InsightsSpan => {
      const days = rows.filter((r) => r.date >= start && r.date <= stop)
      return {
        from: start,
        to: stop,
        partnered: sum(days, (d) => d.partnered),
        other: sum(days, (d) => d.other),
        desire: average(days),
        bleedingDays: days.filter((d) => d.bleeding > 0).length
      }
    }
    const byDate = new Map(inRange.map((r) => [r.date, r]))
    const days: InsightsDay[] = []
    for (let date = from; date <= end; date = addDays(date, 1)) {
      const row = byDate.get(date)
      days.push({ date, entries: (row?.partnered ?? 0) + (row?.other ?? 0), partnered: row?.partnered ?? 0 })
    }
    const db = this.ctx.db
    return {
      period: chosen,
      unit: chosen === '12w' ? 'week' : 'month',
      buckets,
      perWeek: {
        partnered: round1((sum(buckets, (b) => b.partnered) * 7) / length),
        other: round1((sum(buckets, (b) => b.other) * 7) / length)
      },
      days,
      compare: {
        current: span(addDays(end, -COMPARE_DAYS + 1), end),
        previous: span(compareFrom, addDays(end, -COMPARE_DAYS))
      },
      hasFlow: Boolean(db.prepare('SELECT EXISTS (SELECT 1 FROM daily_checkins WHERE flow IS NOT NULL)').pluck().get()),
      hasData: Boolean(
        db.prepare('SELECT EXISTS (SELECT 1 FROM events) OR EXISTS (SELECT 1 FROM daily_checkins WHERE desire IS NOT NULL)').pluck().get()
      )
    }
  }

  /** Each day from `from` to `to` that has anything: entries by stream, desire, bleeding. */
  private dayRows(from: string, to: string): DayRow[] {
    return this.ctx.db
      .prepare(
        `SELECT day AS date,
                SUM(partnered) AS partnered, SUM(other) AS other, MAX(desire) AS desire, MAX(bleeding) AS bleeding
         FROM (
           SELECT occurred_on AS day, kind = 'sex' AS partnered, kind <> 'sex' AS other, NULL AS desire, 0 AS bleeding
           FROM events WHERE occurred_on BETWEEN @from AND @to
           UNION ALL
           SELECT date, 0, 0, desire, flow IN ${BLEEDING} FROM daily_checkins WHERE date BETWEEN @from AND @to
         )
         GROUP BY day ORDER BY day`
      )
      .all({ from, to }) as DayRow[]
  }
}

/** `count` stretches of 7 days, the last one ending on `end`. */
function weeks(end: string, count: number): Array<{ from: string; to: string }> {
  return Array.from({ length: count }, (_, i) => {
    const to = addDays(end, -7 * (count - 1 - i))
    return { from: addDays(to, -6), to }
  })
}

/** `count` calendar months, the last one being the month of `end` (up to `end`). */
function months(end: string, count: number): Array<{ from: string; to: string }> {
  const [year, month] = end.split('-').map(Number) as [number, number]
  return Array.from({ length: count }, (_, i) => {
    const first = new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1))
    const from = first.toISOString().slice(0, 10)
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    return { from, to: last < end ? last : end }
  })
}

function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0)
}

function average(days: DayRow[]): number | null {
  const rated = days.filter((d) => d.desire !== null)
  return rated.length === 0 ? null : round1(sum(rated, (d) => d.desire!) / rated.length)
}

const round1 = (value: number): number => Math.round(value * 10) / 10
