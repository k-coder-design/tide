import { describe, expect, it } from 'vitest'
import type { MedicationInput } from '../../shared/types'
import { openTestMemory } from '../testing'
import type { Context } from './context'
import { MedicationService } from './medications'
import { PillService } from './pills'

const MADRID = 'Europe/Madrid'
const BANGKOK = 'Asia/Bangkok'

/** A context whose clock the test moves. */
function setup(start: string) {
  let now = start
  let ids = 0
  const ctx: Context = { db: openTestMemory().db, now: () => now, newId: () => `id-${++ids}` }
  const input: MedicationInput = {
    name: 'Oral contraceptive',
    isContraceptive: true,
    regimen: 'continuous',
    startedOn: '2026-11-01',
    endedOn: null,
    intervalHours: 24,
    delayWindowHours: 3,
    usualTimeFrom: null,
    usualTimeTo: null,
    note: null
  }
  const medication = new MedicationService(ctx).create(input, '2026-11-13')
  return {
    pills: new PillService(ctx),
    id: medication.id,
    at: (iso: string) => {
      now = iso
    }
  }
}

describe('pill log (T13, T15)', () => {
  it('measures real intervals, flags late doses, and survives a time-zone change', () => {
    const { pills, id, at } = setup('2026-11-13T06:37:00Z')
    pills.take({ medicationId: id, takenAt: null, timeZone: MADRID }) // Fri 13, 07:37 Madrid
    at('2026-11-14T11:12:00Z')
    pills.take({ medicationId: id, takenAt: null, timeZone: MADRID }) // Sat 14, 12:12 Madrid — 28 h 35 min, late by 1 h 35 min
    at('2026-11-16T07:05:00Z')
    pills.miss({ medicationId: id, localDate: '2026-11-15', timeZone: MADRID })
    pills.take({ medicationId: id, takenAt: '2026-11-16T07:05:00Z', timeZone: MADRID }) // Mon 16, 08:05 Madrid
    at('2026-11-17T07:10:00Z')
    pills.take({ medicationId: id, takenAt: null, timeZone: BANGKOK }) // Tue 17, 14:10 Bangkok

    const log = pills.log(id, BANGKOK)
    expect(log.firstLoggedOn).toBe('2026-11-13')
    expect(log.doses.map((d) => [d.localDate, d.status, d.localTime, d.intervalMinutes, d.lateMinutes])).toEqual([
      ['2026-11-17', 'taken', '14:10', 24 * 60 + 5, null],
      ['2026-11-16', 'taken', '08:05', 44 * 60 - 7, 17 * 60 - 7],
      ['2026-11-15', 'missed', null, null, null],
      ['2026-11-14', 'taken', '12:12', 28 * 60 + 35, 95],
      ['2026-11-13', 'taken', '07:37', null, null]
    ])
    expect(log.doses[0]!.previousElsewhere).toEqual({ localTime: '08:05', timeZone: MADRID })
    // The next dose in the phone's current zone: 24 h later, latest 3 h after that.
    expect(log.status).toMatchObject({
      takenToday: true,
      overdue: false,
      next: { dueLocal: '14:10', latestLocal: '17:10', dueDate: '2026-11-18' }
    })
    expect(pills.summaries('2026-11-17', 30)).toEqual([{ medicationId: id, name: 'Oral contraceptive', onTime: 2, late: 2, missed: 1 }])
  })

  it('shows what is due on Today, and overdue past the latest time', () => {
    const { pills, id, at } = setup('2026-11-17T07:00:00Z')
    expect(pills.today(MADRID)[0]).toMatchObject({ last: null, next: null, takenToday: false })
    pills.take({ medicationId: id, takenAt: null, timeZone: MADRID })
    at('2026-11-18T07:30:00Z')
    expect(pills.today(MADRID)[0]).toMatchObject({ takenToday: false, overdue: false, minutesSinceLast: 24 * 60 + 30 })
    at('2026-11-18T10:01:00Z')
    expect(pills.today(MADRID)[0]!.overdue).toBe(true)
  })

  it('refuses doses in the future and unknown zones; a dose can be deleted', () => {
    const { pills, id } = setup('2026-11-17T07:00:00Z')
    expect(() => pills.take({ medicationId: id, takenAt: '2026-11-17T08:00:00Z', timeZone: MADRID })).toThrow('has not come yet')
    expect(() => pills.take({ medicationId: id, takenAt: null, timeZone: 'Mars/Olympus' })).toThrow('Time zone is not valid')
    expect(() => pills.miss({ medicationId: id, localDate: '2026-11-18', timeZone: MADRID })).toThrow('has not come yet')
    pills.take({ medicationId: id, takenAt: null, timeZone: MADRID })
    const dose = pills.log(id, MADRID).doses[0]!
    pills.delete(dose.id)
    expect(pills.log(id, MADRID).doses).toEqual([])
  })
})
