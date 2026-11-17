import type { JournalDay, JournalFilter, JournalPage, MonthDay, TideEvent, WeekSummary } from '../../shared/types'
import { addDays, type Context } from './context'
import { DomainError } from './errors'
import { EVENT_ORDER, EVENT_SELECT, toEvent, type EventRow } from './events'
import { checkDate, checkMonth, checkOneOf } from './validation'

const FILTERS: readonly JournalFilter[] = ['all', 'partnered', 'other', 'checkins']
export const PAGE_DAYS_MAX = 60

/** Which events a filter keeps (SQL on the events table, alias e); check-ins are kept by "all" and "checkins". */
const EVENT_CONDITION: Record<JournalFilter, string | null> = {
  all: '1 = 1',
  partnered: "e.kind = 'sex'",
  other: "e.kind <> 'sex'",
  checkins: null
}

/** Reading the journal: the list by day, the calendar month, the week on Today. Nothing here writes. */
export class JournalService {
  constructor(private readonly ctx: Context) {}

  /** Days with something matching the filter, latest first, `limit` days per page. */
  days(query: { before: string | null; limit: number; filter: JournalFilter }): JournalPage {
    const filter = checkOneOf(query.filter, FILTERS, 'Filter') ?? 'all'
    const before = query.before === null ? null : checkDate(query.before)
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > PAGE_DAYS_MAX) {
      throw new DomainError('VALIDATION', `Page size must be from 1 to ${PAGE_DAYS_MAX}`)
    }
    const sources: string[] = []
    const eventCondition = EVENT_CONDITION[filter]
    if (eventCondition) sources.push(`SELECT e.occurred_on AS day FROM events e WHERE ${eventCondition}`)
    if (filter === 'all' || filter === 'checkins') sources.push('SELECT date AS day FROM daily_checkins WHERE desire IS NOT NULL')
    const dates = this.ctx.db
      .prepare(
        `SELECT day FROM (${sources.join(' UNION ')})
         WHERE @before IS NULL OR day < @before
         ORDER BY day DESC LIMIT @take`
      )
      .pluck()
      .all({ before, take: query.limit + 1 }) as string[]
    const more = dates.length > query.limit
    const pageDates = dates.slice(0, query.limit)
    const days = this.load(pageDates, eventCondition)
    return { days, nextBefore: more ? (pageDates[pageDates.length - 1] ?? null) : null }
  }

  /** Everything recorded on one day. */
  day(date: string): JournalDay {
    const day = checkDate(date)
    return this.load([day], EVENT_CONDITION.all)[0] ?? { date: day, desire: null, events: [] }
  }

  /** One calendar month: a cell for each day that has anything. */
  month(month: string): MonthDay[] {
    const prefix = checkMonth(month)
    const from = `${prefix}-01`
    const to = `${prefix}-31`
    const rows = this.ctx.db
      .prepare(
        `SELECT day,
                SUM(partnered) AS partnered, SUM(other) AS other, MAX(desire) AS desire
         FROM (
           SELECT occurred_on AS day, kind = 'sex' AS partnered, kind <> 'sex' AS other, NULL AS desire
           FROM events WHERE occurred_on BETWEEN @from AND @to
           UNION ALL
           SELECT date, 0, 0, desire FROM daily_checkins WHERE date BETWEEN @from AND @to AND desire IS NOT NULL
         )
         GROUP BY day ORDER BY day`
      )
      .all({ from, to }) as Array<{ day: string; partnered: number; other: number; desire: number | null }>
    return rows.map((row) => ({ date: row.day, partnered: row.partnered, other: row.other, desire: row.desire }))
  }

  /** The seven days ending `today` (inclusive), for the Today screen. */
  week(today: string): WeekSummary {
    const end = checkDate(today, 'Today')
    const start = addDays(end, -6)
    const counts = this.ctx.db
      .prepare(
        `SELECT occurred_on AS day, SUM(kind = 'sex') AS partnered, SUM(kind <> 'sex') AS other
         FROM events WHERE occurred_on BETWEEN ? AND ? GROUP BY occurred_on`
      )
      .all(start, end) as Array<{ day: string; partnered: number; other: number }>
    const desires = this.ctx.db
      .prepare('SELECT date, desire FROM daily_checkins WHERE date BETWEEN ? AND ? AND desire IS NOT NULL')
      .all(start, end) as Array<{ date: string; desire: number }>
    const byDay = new Map(counts.map((row) => [row.day, row]))
    const desireByDay = new Map(desires.map((row) => [row.date, row.desire]))
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i)
      const count = byDay.get(date)
      return { date, desire: desireByDay.get(date) ?? null, partnered: count?.partnered ?? 0, other: count?.other ?? 0 }
    })
    const rated = days.flatMap((d) => (d.desire === null ? [] : [d.desire]))
    return {
      days,
      partnered: days.reduce((sum, d) => sum + d.partnered, 0),
      other: days.reduce((sum, d) => sum + d.other, 0),
      desireAverage: rated.length === 0 ? null : Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10
    }
  }

  private load(dates: string[], eventCondition: string | null): JournalDay[] {
    if (dates.length === 0) return []
    const newest = dates[0] as string
    const oldest = dates[dates.length - 1] as string
    const wanted = new Set(dates)
    const events: TideEvent[] = eventCondition
      ? (
          this.ctx.db
            .prepare(`${EVENT_SELECT} WHERE e.occurred_on BETWEEN ? AND ? AND ${eventCondition} ${EVENT_ORDER}`)
            .all(oldest, newest) as EventRow[]
        ).map(toEvent)
      : []
    const desires = this.ctx.db
      .prepare('SELECT date, desire FROM daily_checkins WHERE date BETWEEN ? AND ? AND desire IS NOT NULL')
      .all(oldest, newest) as Array<{ date: string; desire: number }>
    const desireByDay = new Map(desires.map((row) => [row.date, row.desire]))
    return dates.map((date) => ({
      date,
      desire: desireByDay.get(date) ?? null,
      events: wanted.has(date) ? events.filter((event) => event.occurredOn === date) : []
    }))
  }
}
