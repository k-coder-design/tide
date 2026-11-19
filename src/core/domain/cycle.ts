import type {
  BleedingEpisode,
  CycleDay,
  CycleInsights,
  CycleMonth,
  CycleReport,
  DesireByFlow,
  Flow,
  LoggedFlow,
  MenstrualCycle,
  ReportPeriod,
  SymptomTag
} from '../../shared/types'
import { addDays, type Context } from './context'
import { DomainError } from './errors'
import { PillService } from './pills'
import { checkDate, checkMonth, checkOneOf } from './validation'

export const LOGGED_FLOWS: readonly LoggedFlow[] = ['none', 'spotting', 'light', 'medium', 'heavy']
export const SYMPTOMS: readonly SymptomTag[] = ['cramps', 'headache', 'bloating', 'breast_tenderness', 'acne', 'low_mood', 'irritability', 'fatigue']
/** Bleeding forms episodes and starts cycles; spotting does not (T18). */
export const isBleeding = (flow: Flow | null): boolean => flow === 'light' || flow === 'medium' || flow === 'heavy' || flow === 'unspecified'
const STRENGTH: Record<Flow, number> = { none: 0, spotting: 1, unspecified: 2, light: 3, medium: 4, heavy: 5 }
/** Up to this many days without bleeding inside an episode do not break it; spotting this close counts as its own. */
const GAP_DAYS = 2
const REPORT_PERIODS: readonly ReportPeriod[] = ['last3', 'last6', 'year', 'all']

interface FlowRow {
  date: string
  flow: Flow
  flow_source: 'tide' | 'health' | null
}

/**
 * The cycle section (phase 6, T13, T18): daily flow and symptoms in the check-in, bleeding episodes and cycles computed
 * from the days, and the cycle insights. Nothing is predicted.
 */
export class CycleService {
  constructor(private readonly ctx: Context) {}

  day(date: string, today?: string): CycleDay {
    const day = checkDate(date)
    const row = this.ctx.db.prepare('SELECT flow, flow_source FROM daily_checkins WHERE date = ?').get(day) as
      | { flow: Flow | null; flow_source: 'tide' | 'health' | null }
      | undefined
    const symptoms = this.ctx.db.prepare('SELECT tag FROM day_symptoms WHERE date = ?').pluck().all(day) as SymptomTag[]
    const episodes = episodesOf(this.flowRows(day), today ?? day)
    const current = episodes.findLast((e) => e.start <= day)
    return {
      date: day,
      flow: row?.flow ?? null,
      flowSource: row?.flow == null ? null : (row.flow_source ?? 'tide'),
      symptoms: SYMPTOMS.filter((tag) => symptoms.includes(tag)),
      cycleDay: current ? daysBetween(current.start, day) + 1 : null,
      startsCycle: current?.start === day
    }
  }

  /** null clears the day's flow (not recorded); 'none' is stored as a real answer. */
  setFlow(date: string, flow: LoggedFlow | null): CycleDay {
    const day = checkDate(date)
    const value = checkOneOf(flow, LOGGED_FLOWS, 'Flow')
    this.ctx.db.transaction(() => {
      this.ctx.db
        .prepare(
          `INSERT INTO daily_checkins (date, flow, flow_source, updated_at) VALUES (@day, @value, @source, @now)
           ON CONFLICT(date) DO UPDATE SET flow = excluded.flow, flow_source = excluded.flow_source, updated_at = excluded.updated_at`
        )
        .run({ day, value, source: value === null ? null : 'tide', now: this.ctx.now() })
      this.ctx.db.prepare('DELETE FROM daily_checkins WHERE date = ? AND desire IS NULL AND flow IS NULL AND note IS NULL').run(day)
    })()
    return this.day(day)
  }

  setSymptoms(date: string, tags: SymptomTag[]): CycleDay {
    const day = checkDate(date)
    if (!Array.isArray(tags)) throw new DomainError('VALIDATION', 'Symptoms must be a list')
    const clean = [...new Set(tags.map((tag) => checkOneOf(tag, SYMPTOMS, 'Symptom') as SymptomTag))]
    this.ctx.db.transaction(() => {
      this.ctx.db.prepare('DELETE FROM day_symptoms WHERE date = ?').run(day)
      const insert = this.ctx.db.prepare('INSERT INTO day_symptoms (date, tag) VALUES (?, ?)')
      for (const tag of clean) insert.run(day, tag)
    })()
    return this.day(day)
  }

  episodes(today: string): BleedingEpisode[] {
    const end = checkDate(today, 'Today')
    return episodesOf(this.flowRows(end), end)
  }

  insights(today: string): CycleInsights {
    const end = checkDate(today, 'Today')
    const rows = this.flowRows(end)
    const episodes = episodesOf(rows, end)
    const cycles = cyclesOf(episodes, end)
    const current = cycles[0]
    return {
      cycles,
      ...averagesOf(cycles),
      currentCycleDay: current ? current.length : null,
      firstMonth: rows.find((r) => r.flow !== 'none')?.date.slice(0, 7) ?? null,
      desireByFlow: this.desireByFlow(null, end),
      pills: new PillService(this.ctx).summaries(end, 30),
      hasFlow: rows.some((r) => r.flow !== 'none')
    }
  }

  /** One month of the cycle calendar: flow on each day, cycle starts, and the current cycle's day numbers up to today. */
  month(month: string, today: string): CycleMonth {
    const prefix = checkMonth(month)
    const end = checkDate(today, 'Today')
    const rows = this.flowRows(end)
    return monthOf(prefix, rows, episodesOf(rows, end), end)
  }

  /** The data for a cycle report over the chosen period (T35). Only reads; the phone draws the PDF. */
  report(today: string, period: ReportPeriod): CycleReport {
    const end = checkDate(today, 'Today')
    const span = checkOneOf(period, REPORT_PERIODS, 'Period') ?? 'last6'
    const rows = this.flowRows(end)
    const episodes = episodesOf(rows, end)
    const all = cyclesOf(episodes, end)
    const firstFlow = rows.find((r) => r.flow !== 'none')?.date ?? end
    let from: string
    if (span === 'year') from = addDays(end, -364)
    else if (span === 'all') from = firstFlow
    else from = all[Math.min(span === 'last3' ? 2 : 5, all.length - 1)]?.start ?? firstFlow
    const cycles = all.filter((c) => c.start >= from)
    const months: CycleMonth[] = []
    for (let m = from.slice(0, 7); m <= end.slice(0, 7); m = shiftMonth(m, 1)) months.push(monthOf(m, rows, episodes, end))
    const symptoms = this.ctx.db
      .prepare('SELECT tag, COUNT(*) AS days FROM day_symptoms WHERE date BETWEEN ? AND ? GROUP BY tag ORDER BY days DESC, tag')
      .all(from, end) as Array<{ tag: SymptomTag; days: number }>
    return {
      madeOn: end,
      from,
      to: end,
      cycles,
      ...averagesOf(cycles),
      months,
      symptoms,
      pills: new PillService(this.ctx).summaries(end, daysBetween(from, end) + 1),
      desireByFlow: this.desireByFlow(from, end)
    }
  }

  private desireByFlow(from: string | null, to: string): DesireByFlow {
    const rated = this.ctx.db
      .prepare('SELECT flow, desire FROM daily_checkins WHERE desire IS NOT NULL AND (@from IS NULL OR date >= @from) AND date <= @to')
      .all({ from, to }) as Array<{ flow: Flow | null; desire: number }>
    return {
      bleeding: average(rated.filter((r) => isBleeding(r.flow)).map((r) => r.desire)),
      spotting: average(rated.filter((r) => r.flow === 'spotting').map((r) => r.desire)),
      other: average(rated.filter((r) => !isBleeding(r.flow) && r.flow !== 'spotting').map((r) => r.desire))
    }
  }

  private flowRows(upTo: string): FlowRow[] {
    return this.ctx.db
      .prepare('SELECT date, flow, flow_source FROM daily_checkins WHERE flow IS NOT NULL AND date <= ? ORDER BY date')
      .all(upTo) as FlowRow[]
  }
}

/** Episodes oldest first (docs/DATA_MODEL.md, "Bleeding episodes"). */
export function episodesOf(rows: FlowRow[], today: string): BleedingEpisode[] {
  const groups: FlowRow[][] = []
  for (const row of rows) {
    if (!isBleeding(row.flow)) continue
    const group = groups.at(-1)
    const last = group?.at(-1)
    if (group && last && daysBetween(last.date, row.date) <= GAP_DAYS + 1) group.push(row)
    else groups.push([row])
  }
  const episodes: BleedingEpisode[] = groups.map((group, i) => {
    const start = group[0]!.date
    const last = group.at(-1)!.date
    const next = groups[i + 1]?.[0]?.date
    return {
      start,
      last,
      ongoing: !next && addDays(last, GAP_DAYS) >= today,
      days: daysBetween(start, last) + 1,
      strongest: group.reduce<Flow>((top, r) => (STRENGTH[r.flow] > STRENGTH[top] ? r.flow : top), 'none'),
      spottingDays: 0,
      cycle: next ? daysBetween(start, next) : null,
      fromHealth: group.some((r) => r.flow_source === 'health')
    }
  })
  // Each spotting day counts for the first episode it is close to, never twice.
  for (const row of rows) {
    if (row.flow !== 'spotting') continue
    const near = episodes.find((e) => row.date >= addDays(e.start, -GAP_DAYS) && row.date <= addDays(e.last, GAP_DAYS))
    if (near) near.spottingDays++
  }
  return episodes
}

/** Cycles newest first: each episode starts one; it ends the day before the next one starts (T35). */
export function cyclesOf(episodes: BleedingEpisode[], today: string): MenstrualCycle[] {
  return episodes
    .map((e, i) => {
      const next = episodes[i + 1]
      return {
        start: e.start,
        end: next ? addDays(next.start, -1) : null,
        bleedingDays: e.days,
        bleedingOngoing: e.ongoing,
        length: next ? daysBetween(e.start, next.start) : daysBetween(e.start, today) + 1,
        strongest: e.strongest,
        spottingDays: e.spottingDays,
        fromHealth: e.fromHealth
      }
    })
    .reverse()
}

/** Bleeding over episodes that have ended, length over finished cycles, both rounded to whole days. */
function averagesOf(cycles: MenstrualCycle[]): Pick<CycleInsights, 'averageBleeding' | 'averageCycle' | 'cycleRange'> {
  const bleeding = cycles.filter((c) => !c.bleedingOngoing).map((c) => c.bleedingDays)
  const lengths = cycles.filter((c) => c.end !== null).map((c) => c.length)
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  return {
    averageBleeding: mean(bleeding),
    averageCycle: mean(lengths),
    cycleRange: lengths.length ? { min: Math.min(...lengths), max: Math.max(...lengths) } : null
  }
}

function monthOf(month: string, rows: FlowRow[], episodes: BleedingEpisode[], today: string): CycleMonth {
  const byDate = new Map(rows.map((r) => [r.date, r.flow]))
  const starts = new Set(episodes.map((e) => e.start))
  const current = episodes.at(-1)?.start ?? null
  const [year, m] = month.split('-').map(Number) as [number, number]
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate()
  const days = Array.from({ length: count }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`
    const inCurrent = current !== null && date >= current && date <= today
    return {
      date,
      flow: date <= today ? (byDate.get(date) ?? null) : null,
      startsCycle: starts.has(date),
      currentCycleDay: inCurrent ? daysBetween(current, date) + 1 : null
    }
  })
  return {
    month,
    days,
    bleedingDays: days.filter((d) => isBleeding(d.flow)).length,
    spottingDays: days.filter((d) => d.flow === 'spotting').length,
    cycleStarts: days.filter((d) => d.startsCycle).map((d) => d.date)
  }
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number]
  const moved = new Date(Date.UTC(year, m - 1 + by, 1))
  return moved.toISOString().slice(0, 7)
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}
