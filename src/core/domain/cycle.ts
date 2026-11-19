import type { BleedingEpisode, CycleDay, CycleInsights, Flow, LoggedFlow, SymptomTag } from '../../shared/types'
import { addDays, type Context } from './context'
import { DomainError } from './errors'
import { PillService } from './pills'
import { checkDate, checkOneOf } from './validation'

export const LOGGED_FLOWS: readonly LoggedFlow[] = ['none', 'spotting', 'light', 'medium', 'heavy']
export const SYMPTOMS: readonly SymptomTag[] = ['cramps', 'headache', 'bloating', 'breast_tenderness', 'acne', 'low_mood', 'irritability', 'fatigue']
/** Bleeding forms episodes and starts cycles; spotting does not (T18). */
export const isBleeding = (flow: Flow | null): boolean => flow === 'light' || flow === 'medium' || flow === 'heavy' || flow === 'unspecified'
const STRENGTH: Record<Flow, number> = { none: 0, spotting: 1, unspecified: 2, light: 3, medium: 4, heavy: 5 }
/** Up to this many days without bleeding inside an episode do not break it; spotting this close counts as its own. */
const GAP_DAYS = 2
const MONTHS_SHOWN = 6

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
    const finished = episodes.filter((e) => !e.ongoing)
    const cycles = episodes.flatMap((e) => (e.cycle === null ? [] : [e.cycle]))

    const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => shiftMonth(end.slice(0, 7), i - MONTHS_SHOWN + 1)).map((month) => {
      const inMonth = rows.filter((r) => r.date.startsWith(month))
      return {
        month,
        bleedingDays: inMonth.filter((r) => isBleeding(r.flow)).length,
        spottingDays: inMonth.filter((r) => r.flow === 'spotting').length
      }
    })

    const start = addDays(mondayOf(end), -7 * 11)
    const byDate = new Map(rows.map((r) => [r.date, r.flow]))
    const days = Array.from({ length: daysBetween(start, end) + 1 }, (_, i) => {
      const date = addDays(start, i)
      return { date, flow: byDate.get(date) ?? null }
    })

    const rated = this.ctx.db.prepare('SELECT flow, desire FROM daily_checkins WHERE desire IS NOT NULL AND date <= ?').all(end) as Array<{
      flow: Flow | null
      desire: number
    }>
    const desireByFlow = {
      bleeding: average(rated.filter((r) => isBleeding(r.flow)).map((r) => r.desire)),
      spotting: average(rated.filter((r) => r.flow === 'spotting').map((r) => r.desire)),
      other: average(rated.filter((r) => !isBleeding(r.flow) && r.flow !== 'spotting').map((r) => r.desire))
    }

    return {
      episodes: [...episodes].reverse(),
      averageEpisode: finished.length ? Math.round(finished.reduce((s, e) => s + e.days, 0) / finished.length) : null,
      averageCycle: cycles.length ? Math.round(cycles.reduce((s, c) => s + c, 0) / cycles.length) : null,
      cycleRange: cycles.length ? { min: Math.min(...cycles), max: Math.max(...cycles) } : null,
      months,
      days,
      desireByFlow,
      pills: new PillService(this.ctx).summaries(end, 30),
      historyFrom: rows.find((r) => r.flow !== 'none')?.date ?? null,
      hasFlow: rows.some((r) => r.flow !== 'none')
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

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function mondayOf(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(date, -weekday)
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
