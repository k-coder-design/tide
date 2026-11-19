import type { Medication, MedicationInput, Regimen } from '../../shared/types'
import type { Context } from './context'
import { DomainError } from './errors'
import { checkDate, checkId, checkNote, checkOneOf, checkTime } from './validation'

const REGIMENS: readonly Regimen[] = ['continuous', '21/7', '24/4', 'other']
export const MEDICATION_NAME_MAX = 40

export interface MedicationRow {
  id: string
  name: string
  is_contraceptive: number
  regimen: Regimen | null
  source: 'tide' | 'health'
  usual_time_from: string | null
  usual_time_to: string | null
  interval_hours: number | null
  delay_window_hours: number | null
  started_on: string
  ended_on: string | null
  note: string | null
}

export function toMedication(row: MedicationRow, today: string): Medication {
  return {
    id: row.id,
    name: row.name,
    isContraceptive: row.is_contraceptive === 1,
    regimen: row.regimen,
    source: row.source,
    startedOn: row.started_on,
    endedOn: row.ended_on,
    intervalHours: row.interval_hours,
    delayWindowHours: row.delay_window_hours,
    usualTimeFrom: row.usual_time_from,
    usualTimeTo: row.usual_time_to,
    note: row.note,
    active: row.started_on <= today && (row.ended_on === null || row.ended_on >= today),
    tracked: row.interval_hours !== null
  }
}

/**
 * Medication courses (phase 6, T6): any medication, a contraceptive among them. A contraceptive course is shown on sex
 * entries within its dates; a course with an interval gets a pill card on Today and a dose log (T13, T15).
 */
export class MedicationService {
  constructor(private readonly ctx: Context) {}

  /** Current courses first, then by start, latest first. */
  list(today: string): Medication[] {
    const day = checkDate(today, 'Today')
    const rows = this.ctx.db.prepare('SELECT * FROM medications ORDER BY started_on DESC, name').all() as MedicationRow[]
    const all = rows.map((row) => toMedication(row, day))
    return [...all.filter((m) => m.active), ...all.filter((m) => !m.active)]
  }

  get(id: string, today: string): Medication {
    const row = this.ctx.db.prepare('SELECT * FROM medications WHERE id = ?').get(checkId(id, 'Medication')) as MedicationRow | undefined
    if (!row) throw new DomainError('NOT_FOUND', 'This medication no longer exists')
    return toMedication(row, checkDate(today, 'Today'))
  }

  create(input: MedicationInput, today: string): Medication {
    const clean = this.clean(input)
    const id = this.ctx.newId()
    this.ctx.db
      .prepare(
        `INSERT INTO medications (id, name, is_contraceptive, regimen, source, usual_time_from, usual_time_to, interval_hours,
           delay_window_hours, started_on, ended_on, note, updated_at)
         VALUES (@id, @name, @isContraceptive, @regimen, 'tide', @usualTimeFrom, @usualTimeTo, @intervalHours,
           @delayWindowHours, @startedOn, @endedOn, @note, @now)`
      )
      .run({ ...clean, id, now: this.ctx.now() })
    return this.get(id, today)
  }

  update(id: string, input: MedicationInput, today: string): Medication {
    const existing = this.get(id, today)
    const clean = this.clean(input)
    this.ctx.db
      .prepare(
        `UPDATE medications SET name = @name, is_contraceptive = @isContraceptive, regimen = @regimen,
           usual_time_from = @usualTimeFrom, usual_time_to = @usualTimeTo, interval_hours = @intervalHours,
           delay_window_hours = @delayWindowHours, started_on = @startedOn, ended_on = @endedOn, note = @note, updated_at = @now
         WHERE id = @id`
      )
      .run({ ...clean, id: existing.id, now: this.ctx.now() })
    return this.get(existing.id, today)
  }

  /** Deletes the course and its dose log. */
  delete(id: string): void {
    const row = this.ctx.db.prepare('SELECT id FROM medications WHERE id = ?').get(checkId(id, 'Medication'))
    if (!row) throw new DomainError('NOT_FOUND', 'This medication no longer exists')
    this.ctx.db.transaction(() => {
      this.ctx.db.prepare('DELETE FROM pill_log WHERE medication_id = ?').run(id)
      this.ctx.db.prepare('DELETE FROM medications WHERE id = ?').run(id)
    })()
  }

  private clean(input: MedicationInput): Record<string, unknown> {
    if (typeof input !== 'object' || input === null) throw new DomainError('VALIDATION', 'Medication is missing')
    const invalid = (message: string): never => {
      throw new DomainError('VALIDATION', message)
    }
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : ''
    if (name === '') invalid('Name the medication')
    if ([...name].length > MEDICATION_NAME_MAX) invalid(`Name is longer than ${MEDICATION_NAME_MAX} characters`)
    if (typeof input.isContraceptive !== 'boolean') invalid('Contraceptive must be yes or no')
    const startedOn = checkDate(input.startedOn, 'Start date')
    const endedOn = input.endedOn ? checkDate(input.endedOn, 'End date') : null
    if (endedOn !== null && endedOn < startedOn) invalid('The end date is before the start')
    const intervalHours = hours(input.intervalHours, 'Interval', 1, 168)
    const delayWindowHours = hours(input.delayWindowHours, 'Allowed delay', 0, 48)
    if (delayWindowHours !== null && intervalHours === null) invalid('Set the interval between doses first')
    const usualTimeFrom = checkTime(input.usualTimeFrom)
    const usualTimeTo = checkTime(input.usualTimeTo)
    return {
      name,
      isContraceptive: input.isContraceptive ? 1 : 0,
      regimen: input.isContraceptive ? checkOneOf(input.regimen, REGIMENS, 'Regimen') : null,
      startedOn,
      endedOn,
      intervalHours,
      delayWindowHours,
      usualTimeFrom: usualTimeFrom ?? usualTimeTo,
      usualTimeTo: usualTimeTo ?? usualTimeFrom,
      note: checkNote(input.note)
    }
  }
}

function hours(value: unknown, what: string, min: number, max: number): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new DomainError('VALIDATION', `${what} must be from ${min} to ${max} hours`)
  }
  return Math.round(value * 4) / 4
}
