import { describe, expect, it } from 'vitest'
import type { EventInput, MedicationInput } from '../../shared/types'
import { openTestContext } from '../testing'
import { CheckinService } from './checkins'
import { CycleService } from './cycle'
import { EventService } from './events'
import { MedicationService } from './medications'

const TODAY = '2026-11-19'

function setup() {
  const ctx = openTestContext()
  return { ctx, cycle: new CycleService(ctx), checkins: new CheckinService(ctx), medications: new MedicationService(ctx), events: new EventService(ctx) }
}

const health = (ctx: ReturnType<typeof openTestContext>, date: string, flow: string) =>
  ctx.db.prepare("INSERT INTO daily_checkins (date, flow, flow_source, updated_at) VALUES (?, ?, 'health', 'x')").run(date, flow)

const course = (overrides: Partial<MedicationInput> = {}): MedicationInput => ({
  name: 'Oral contraceptive',
  isContraceptive: true,
  regimen: 'continuous',
  startedOn: '2026-01-01',
  endedOn: null,
  intervalHours: 24,
  delayWindowHours: 3,
  usualTimeFrom: null,
  usualTimeTo: null,
  note: null,
  ...overrides
})

describe('cycle — flow and symptoms (phase 6)', () => {
  it('stores flow and symptoms for a day; none is a real answer, null clears it', () => {
    const { cycle, checkins } = setup()
    expect(cycle.setFlow('2026-11-18', 'light')).toMatchObject({ flow: 'light', flowSource: 'tide', cycleDay: 1, startsCycle: true })
    expect(cycle.setSymptoms('2026-11-18', ['fatigue', 'cramps', 'cramps']).symptoms).toEqual(['cramps', 'fatigue'])
    expect(cycle.setFlow('2026-11-17', 'none').flow).toBe('none')
    expect(cycle.setFlow('2026-11-17', null).flow).toBeNull()
    // A day with desire keeps its row when the flow is cleared.
    checkins.setDesire('2026-11-16', 3)
    cycle.setFlow('2026-11-16', 'spotting')
    cycle.setFlow('2026-11-16', null)
    expect(checkins.desire('2026-11-16')).toBe(3)
    expect(() => cycle.setFlow('2026-11-16', 'unspecified' as never)).toThrow('Flow is not valid')
    expect(() => cycle.setSymptoms('2026-11-16', ['sneezing' as never])).toThrow('Symptom is not valid')
  })

  it('counts the cycle day from the latest episode start; spotting never starts one (T18)', () => {
    const { cycle } = setup()
    cycle.setFlow('2026-11-01', 'spotting')
    expect(cycle.day('2026-11-01')).toMatchObject({ cycleDay: null, startsCycle: false })
    cycle.setFlow('2026-11-02', 'medium')
    expect(cycle.day('2026-11-10')).toMatchObject({ cycleDay: 9, startsCycle: false })
  })
})

describe('cycle — bleeding episodes', () => {
  it('joins bleeding days across gaps of up to 2 days, counts nearby spotting, measures cycles', () => {
    const { ctx, cycle } = setup()
    // Episode 1 (Health): 10–13 Oct with a one-day gap, spotting the day before.
    health(ctx, '2026-10-09', 'spotting')
    health(ctx, '2026-10-10', 'medium')
    health(ctx, '2026-10-11', 'light')
    health(ctx, '2026-10-13', 'light')
    // Spotting between episodes, far from both. (10 Nov below counts for 6–8 Nov only, not also for 12 Nov.)
    health(ctx, '2026-10-24', 'spotting')
    // Episode 2: 6–8 Nov, spotting two days after.
    cycle.setFlow('2026-11-06', 'light')
    cycle.setFlow('2026-11-07', 'heavy')
    cycle.setFlow('2026-11-08', 'light')
    cycle.setFlow('2026-11-10', 'spotting')
    // A gap of 3 days starts a new episode: 12 Nov.
    cycle.setFlow('2026-11-12', 'light')
    // Ongoing: 18 Nov, one day before today.
    cycle.setFlow('2026-11-18', 'light')

    const episodes = cycle.episodes(TODAY)
    expect(episodes).toEqual([
      { start: '2026-10-10', last: '2026-10-13', ongoing: false, days: 4, strongest: 'medium', spottingDays: 1, cycle: 27, fromHealth: true },
      { start: '2026-11-06', last: '2026-11-08', ongoing: false, days: 3, strongest: 'heavy', spottingDays: 1, cycle: 6, fromHealth: false },
      { start: '2026-11-12', last: '2026-11-12', ongoing: false, days: 1, strongest: 'light', spottingDays: 0, cycle: 6, fromHealth: false },
      { start: '2026-11-18', last: '2026-11-18', ongoing: true, days: 1, strongest: 'light', spottingDays: 0, cycle: null, fromHealth: false }
    ])
  })

  it('insights: cycles newest first, averages over finished ones, desire by flow, first month', () => {
    const { ctx, cycle, checkins } = setup()
    health(ctx, '2026-09-13', 'medium')
    health(ctx, '2026-09-14', 'medium')
    health(ctx, '2026-10-10', 'light')
    health(ctx, '2026-10-11', 'light')
    health(ctx, '2026-10-12', 'light')
    health(ctx, '2026-10-20', 'spotting')
    cycle.setFlow('2026-11-06', 'light')
    checkins.setDesire('2026-11-06', 2)
    checkins.setDesire('2026-10-20', 4)
    checkins.setDesire('2026-11-15', 5)
    checkins.setDesire('2026-11-16', 4)

    const insights = cycle.insights(TODAY)
    expect(insights.cycles).toEqual([
      { start: '2026-11-06', end: null, bleedingDays: 1, bleedingOngoing: false, length: 14, strongest: 'light', spottingDays: 0, fromHealth: false },
      { start: '2026-10-10', end: '2026-11-05', bleedingDays: 3, bleedingOngoing: false, length: 27, strongest: 'light', spottingDays: 0, fromHealth: true },
      { start: '2026-09-13', end: '2026-10-09', bleedingDays: 2, bleedingOngoing: false, length: 27, strongest: 'medium', spottingDays: 0, fromHealth: true }
    ])
    expect(insights.averageBleeding).toBe(2) // (1 + 3 + 2) / 3; 6 Nov has ended — more than 2 days ago
    expect(insights.averageCycle).toBe(27) // the current cycle is left out
    expect(insights.cycleRange).toEqual({ min: 27, max: 27 })
    expect(insights.currentCycleDay).toBe(14)
    expect(insights.firstMonth).toBe('2026-09')
    expect(insights.desireByFlow).toEqual({ bleeding: 2, spotting: 4, other: 4.5 })
    expect(insights.hasFlow).toBe(true)
  })

  it('month: flow per day, cycle starts, and day numbers for the current cycle up to today only (T35)', () => {
    const { cycle } = setup()
    cycle.setFlow('2026-10-21', 'medium')
    cycle.setFlow('2026-11-04', 'spotting')
    cycle.setFlow('2026-11-05', 'heavy')
    cycle.setFlow('2026-11-06', 'light')
    const nov = cycle.month('2026-11', TODAY)
    expect(nov.days).toHaveLength(30)
    expect(nov.days[3]).toEqual({ date: '2026-11-04', flow: 'spotting', startsCycle: false, currentCycleDay: null })
    expect(nov.days[4]).toEqual({ date: '2026-11-05', flow: 'heavy', startsCycle: true, currentCycleDay: 1 })
    expect(nov.days[18]).toMatchObject({ date: TODAY, currentCycleDay: 15 })
    expect(nov.days[19]).toMatchObject({ flow: null, currentCycleDay: null })
    expect(nov).toMatchObject({ bleedingDays: 2, spottingDays: 1, cycleStarts: ['2026-11-05'] })
    // October's cycle is over, so its days carry no numbers.
    expect(cycle.month('2026-10', TODAY).days[20]).toEqual({ date: '2026-10-21', flow: 'medium', startsCycle: true, currentCycleDay: null })
    expect(() => cycle.month('2026-13', TODAY)).toThrow()
  })

  it('report: the chosen number of cycles, their months, symptoms and pills over the period (T35)', () => {
    const { cycle, medications } = setup()
    for (const start of ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']) cycle.setFlow(start, 'medium')
    cycle.setSymptoms('2026-10-01', ['cramps', 'fatigue'])
    cycle.setSymptoms('2026-11-01', ['cramps'])
    cycle.setSymptoms('2026-07-01', ['acne'])
    medications.create(course({ startedOn: '2026-09-01' }), TODAY)

    const last3 = cycle.report(TODAY, 'last3')
    expect(last3.from).toBe('2026-09-01')
    expect(last3.cycles.map((c) => c.start)).toEqual(['2026-11-01', '2026-10-01', '2026-09-01'])
    expect(last3.months.map((m) => m.month)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(last3.symptoms).toEqual([
      { tag: 'cramps', days: 2 },
      { tag: 'fatigue', days: 1 }
    ])
    expect(last3.averageCycle).toBe(31) // 30 and 31 days, rounded half up
    expect(last3.pills).toHaveLength(1)

    expect(cycle.report(TODAY, 'all').from).toBe('2026-06-01')
    expect(cycle.report(TODAY, 'last6').cycles).toHaveLength(6)
    expect(cycle.report(TODAY, 'year').from).toBe('2025-11-20')
    expect(() => cycle.report(TODAY, 'decade' as never)).toThrow('Period is not valid')
  })
})

describe('medications (T6)', () => {
  it('creates, lists current first, updates and deletes courses with their doses', () => {
    const { medications } = setup()
    const old = medications.create(course({ name: 'Old pill', startedOn: '2025-01-01', endedOn: '2025-12-31' }), TODAY)
    const pill = medications.create(course(), TODAY)
    expect(medications.list(TODAY).map((m) => [m.name, m.active, m.tracked])).toEqual([
      ['Oral contraceptive', true, true],
      ['Old pill', false, true]
    ])
    const renamed = medications.update(pill.id, course({ name: '  Yaz  ', intervalHours: 24, delayWindowHours: 12 }), TODAY)
    expect(renamed).toMatchObject({ name: 'Yaz', delayWindowHours: 12, regimen: 'continuous' })
    medications.delete(old.id)
    expect(medications.list(TODAY)).toHaveLength(1)
  })

  it('refuses a course that ends before it starts, odd intervals and a delay without an interval', () => {
    const { medications } = setup()
    expect(() => medications.create(course({ endedOn: '2025-12-01' }), TODAY)).toThrow('before the start')
    expect(() => medications.create(course({ intervalHours: 0 }), TODAY)).toThrow('Interval must be from 1 to 168 hours')
    expect(() => medications.create(course({ intervalHours: null }), TODAY)).toThrow('interval between doses first')
    expect(() => medications.create(course({ name: ' ' }), TODAY)).toThrow('Name the medication')
  })

  it('shows contraceptive courses on sex entries within their dates, computed at read time', () => {
    const { medications, events } = setup()
    const sex: EventInput = { kind: 'sex', occurredOn: '2026-03-10', occurredTime: null, satisfaction: null, orgasm: null, note: null, partnerId: null, initiator: null, protection: null }
    const entry = events.create(sex)
    expect(entry.contraception).toEqual([])
    const pill = medications.create(course({ name: 'Yaz', startedOn: '2026-03-01' }), TODAY)
    medications.create(course({ name: 'Vitamin D', isContraceptive: false, startedOn: '2026-01-01', intervalHours: null, delayWindowHours: null }), TODAY)
    expect(events.get(entry.id).contraception).toEqual(['Yaz'])
    expect(events.create({ ...sex, kind: 'masturbation' }).contraception).toEqual([])
    medications.update(pill.id, course({ name: 'Yaz', startedOn: '2026-03-11' }), TODAY)
    expect(events.get(entry.id).contraception).toEqual([])
  })
})
