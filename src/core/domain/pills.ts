import type { PillDose, PillLog, PillStatus, PillSummary } from '../../shared/types'
import { addDays, type Context } from './context'
import { DomainError } from './errors'
import { toMedication, type MedicationRow } from './medications'
import { checkDate, checkId } from './validation'
import { addMinutes, checkZone, localParts, minutesBetween } from './zones'

interface DoseRow {
  id: string
  medication_id: string
  status: 'taken' | 'missed'
  taken_at: string | null
  time_zone: string
  local_date: string
}

/** A dose may be logged a little ahead of the clock (a phone a minute fast), never later than this. */
const FUTURE_SLACK_MINUTES = 5

/**
 * The pill log (phase 6, T13, T15). A dose is an absolute moment plus the phone's zone; the interval is the real time
 * since the previous taken dose, late means longer than interval + the allowed delay set by the user. Flags only, no advice.
 */
export class PillService {
  constructor(private readonly ctx: Context) {}

  /** Tracked courses that cover today, for the pill cards on Today. */
  today(zone: string): PillStatus[] {
    const tz = checkZone(zone)
    const today = localParts(this.ctx.now(), tz).date
    const rows = this.ctx.db
      .prepare(
        `SELECT * FROM medications WHERE interval_hours IS NOT NULL AND started_on <= ? AND (ended_on IS NULL OR ended_on >= ?)
         ORDER BY started_on, name`
      )
      .all(today, today) as MedicationRow[]
    return rows.map((row) => this.status(row, tz))
  }

  log(medicationId: string, zone: string): PillLog {
    const tz = checkZone(zone)
    const row = this.medication(medicationId)
    const doses = this.doses(row)
    return {
      status: this.status(row, tz, doses),
      doses: [...doses].reverse(),
      firstLoggedOn: doses[0]?.localDate ?? null
    }
  }

  /** `takenAt` null — now. */
  take(input: { medicationId: string; takenAt: string | null; timeZone: string }): PillStatus {
    const row = this.medication(input?.medicationId)
    const zone = checkZone(input.timeZone)
    const now = this.ctx.now()
    const takenAt = input.takenAt === null || input.takenAt === undefined ? now : checkMoment(input.takenAt)
    if (minutesBetween(now, takenAt) > FUTURE_SLACK_MINUTES) throw new DomainError('VALIDATION', 'That time has not come yet')
    if (row.interval_hours === null) throw new DomainError('VALIDATION', 'Set the interval between doses first')
    this.ctx.db
      .prepare(
        `INSERT INTO pill_log (id, medication_id, status, taken_at, time_zone, local_date, updated_at)
         VALUES (?, ?, 'taken', ?, ?, ?, ?)`
      )
      .run(this.ctx.newId(), row.id, takenAt, zone, localParts(takenAt, zone).date, now)
    return this.status(row, zone)
  }

  miss(input: { medicationId: string; localDate: string; timeZone: string }): PillStatus {
    const row = this.medication(input?.medicationId)
    const zone = checkZone(input.timeZone)
    const date = checkDate(input.localDate)
    if (date > localParts(this.ctx.now(), zone).date) throw new DomainError('VALIDATION', 'That day has not come yet')
    this.ctx.db
      .prepare(
        `INSERT INTO pill_log (id, medication_id, status, taken_at, time_zone, local_date, updated_at)
         VALUES (?, ?, 'missed', NULL, ?, ?, ?)`
      )
      .run(this.ctx.newId(), row.id, zone, date, this.ctx.now())
    return this.status(row, zone)
  }

  delete(id: string): void {
    const result = this.ctx.db.prepare('DELETE FROM pill_log WHERE id = ?').run(checkId(id, 'Dose'))
    if (result.changes === 0) throw new DomainError('NOT_FOUND', 'This dose no longer exists')
  }

  /** On time, late and missed over the last `days` days (by local date), per tracked course. */
  summaries(today: string, days: number): PillSummary[] {
    const from = addDays(today, -(days - 1))
    const rows = this.ctx.db
      .prepare('SELECT * FROM medications WHERE interval_hours IS NOT NULL AND started_on <= ? AND (ended_on IS NULL OR ended_on >= ?) ORDER BY started_on')
      .all(today, from) as MedicationRow[]
    return rows.map((row) => {
      const recent = this.doses(row).filter((d) => d.localDate >= from && d.localDate <= today)
      return {
        medicationId: row.id,
        name: row.name,
        onTime: recent.filter((d) => d.status === 'taken' && d.lateMinutes === null).length,
        late: recent.filter((d) => d.lateMinutes !== null).length,
        missed: recent.filter((d) => d.status === 'missed').length
      }
    })
  }

  private medication(id: unknown): MedicationRow {
    const row = this.ctx.db.prepare('SELECT * FROM medications WHERE id = ?').get(checkId(id, 'Medication')) as MedicationRow | undefined
    if (!row) throw new DomainError('NOT_FOUND', 'This medication no longer exists')
    return row
  }

  /** All doses of a course, oldest first, with intervals and lateness. */
  private doses(row: MedicationRow): PillDose[] {
    const rows = this.ctx.db
      .prepare(
        `SELECT id, medication_id, status, taken_at, time_zone, local_date FROM pill_log WHERE medication_id = ?
         ORDER BY COALESCE(taken_at, local_date || 'T23:59:59Z'), id`
      )
      .all(row.id) as DoseRow[]
    const allowed = row.interval_hours === null ? null : (row.interval_hours + (row.delay_window_hours ?? 0)) * 60
    let previous: DoseRow | null = null
    return rows.map((dose) => {
      let intervalMinutes: number | null = null
      let lateMinutes: number | null = null
      let previousElsewhere: PillDose['previousElsewhere'] = null
      if (dose.status === 'taken' && dose.taken_at) {
        if (previous?.taken_at) {
          intervalMinutes = minutesBetween(previous.taken_at, dose.taken_at)
          if (allowed !== null && intervalMinutes > allowed) lateMinutes = intervalMinutes - allowed
          if (previous.time_zone !== dose.time_zone) {
            previousElsewhere = { localTime: localParts(previous.taken_at, previous.time_zone).time, timeZone: previous.time_zone }
          }
        }
        previous = dose
      }
      return {
        id: dose.id,
        medicationId: dose.medication_id,
        status: dose.status,
        takenAt: dose.taken_at,
        timeZone: dose.time_zone,
        localDate: dose.local_date,
        localTime: dose.taken_at ? localParts(dose.taken_at, dose.time_zone).time : null,
        intervalMinutes,
        lateMinutes,
        previousElsewhere
      }
    })
  }

  private status(row: MedicationRow, zone: string, known?: PillDose[]): PillStatus {
    const now = this.ctx.now()
    const here = localParts(now, zone)
    const doses = known ?? this.doses(row)
    const last = doses.findLast((d) => d.status === 'taken') ?? null
    let next: PillStatus['next'] = null
    if (last?.takenAt && row.interval_hours !== null) {
      const due = addMinutes(last.takenAt, row.interval_hours * 60)
      const latest = addMinutes(due, (row.delay_window_hours ?? 0) * 60)
      const dueParts = localParts(due, zone)
      const latestParts = localParts(latest, zone)
      next = { due, latest, dueLocal: dueParts.time, latestLocal: latestParts.time, dueDate: dueParts.date, latestDate: latestParts.date }
    }
    return {
      medication: toMedication(row, here.date),
      last,
      takenToday: last?.takenAt ? localParts(last.takenAt, zone).date === here.date : false,
      next,
      minutesSinceLast: last?.takenAt ? minutesBetween(last.takenAt, now) : null,
      overdue: next !== null && now > next.latest,
      zone
    }
  }
}

function checkMoment(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new DomainError('VALIDATION', 'Time taken is not valid')
  }
  return new Date(value).toISOString()
}
