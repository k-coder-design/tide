import type { HealthImportResult } from '../../shared/types'
import type { Context } from './context'
import { DomainError } from './errors'
import { checkDate } from './validation'

type ImportedFlow = 'spotting' | 'light' | 'medium' | 'heavy' | 'unspecified'
const FLOWS: readonly ImportedFlow[] = ['spotting', 'light', 'medium', 'heavy', 'unspecified']

/** Placeholder names for Health's contraceptive methods; the user renames them in phase 6. */
const METHOD_NAMES: Record<string, string> = {
  Oral: 'Oral contraceptive',
  Patch: 'Contraceptive patch',
  IntravaginalRing: 'Vaginal ring',
  Implant: 'Contraceptive implant',
  Injection: 'Contraceptive injection',
  IntrauterineDevice: 'IUD',
  Unspecified: 'Contraceptive'
}

interface HealthData {
  flow: Array<{ date: string; flow: ImportedFlow }>
  contraceptives: Array<{ method: string; startedOn: string; endedOn: string | null }>
}

/**
 * The one-time import from Apple Health (T12, T27): flow by day into the check-ins (`flow_source = 'health'`) and
 * contraceptive courses into medications (`source = 'health'`). A day that already has a flow in Tide is never
 * overwritten and a course already imported is kept as it is, so importing the same file again changes nothing.
 */
export class HealthImportService {
  constructor(private readonly ctx: Context) {}

  apply(input: unknown): HealthImportResult {
    const data = parse(input)
    const db = this.ctx.db
    const now = this.ctx.now()
    const result: HealthImportResult = { bleedingDays: 0, spottingDays: 0, keptDays: 0, courses: 0, keptCourses: 0 }
    db.transaction(() => {
      for (const { date, flow } of data.flow) {
        const row = db.prepare('SELECT flow FROM daily_checkins WHERE date = ?').get(date) as { flow: string | null } | undefined
        if (row?.flow != null) {
          result.keptDays++
          continue
        }
        db.prepare(
          `INSERT INTO daily_checkins (date, flow, flow_source, updated_at) VALUES (@date, @flow, 'health', @now)
           ON CONFLICT(date) DO UPDATE SET flow = excluded.flow, flow_source = 'health', updated_at = excluded.updated_at`
        ).run({ date, flow, now })
        if (flow === 'spotting') result.spottingDays++
        else result.bleedingDays++
      }
      for (const course of data.contraceptives) {
        const known = db
          .prepare("SELECT 1 FROM medications WHERE source = 'health' AND is_contraceptive = 1 AND started_on = ?")
          .pluck()
          .get(course.startedOn)
        if (known) {
          result.keptCourses++
          continue
        }
        db.prepare(
          `INSERT INTO medications (id, name, is_contraceptive, source, started_on, ended_on, updated_at)
           VALUES (@id, @name, 1, 'health', @startedOn, @endedOn, @now)`
        ).run({ id: this.ctx.newId(), name: METHOD_NAMES[course.method] ?? 'Contraceptive', startedOn: course.startedOn, endedOn: course.endedOn, now })
        result.courses++
      }
    })()
    return result
  }
}

function parse(input: unknown): HealthData {
  const bad = () => new DomainError('VALIDATION', 'The import file could not be read')
  if (typeof input !== 'object' || input === null) throw bad()
  const { kind, version, flow, contraceptives } = input as Record<string, unknown>
  if (kind !== 'tide-health-import') throw bad()
  if (version !== 1) throw new DomainError('VALIDATION', 'This file was made by a newer Tide. Update Tide, then try again.')
  if (!Array.isArray(flow) || !Array.isArray(contraceptives)) throw bad()
  return {
    flow: flow.map((item: unknown) => {
      const { date, flow: value } = (item ?? {}) as Record<string, unknown>
      if (!FLOWS.includes(value as ImportedFlow)) throw bad()
      return { date: checkDate(date), flow: value as ImportedFlow }
    }),
    contraceptives: contraceptives.map((item: unknown) => {
      const { method, startedOn, endedOn } = (item ?? {}) as Record<string, unknown>
      if (typeof method !== 'string') throw bad()
      return { method, startedOn: checkDate(startedOn), endedOn: endedOn == null ? null : checkDate(endedOn) }
    })
  }
}
