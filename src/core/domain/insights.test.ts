import { describe, expect, it } from 'vitest'
import type { EventInput, EventKind } from '../../shared/types'
import { openTestContext } from '../testing'
import { CheckinService } from './checkins'
import { EventService } from './events'
import { InsightsService } from './insights'

const TODAY = '2026-11-19'

const entry = (kind: EventKind, occurredOn: string): EventInput => ({
  kind,
  occurredOn,
  occurredTime: null,
  satisfaction: null,
  orgasm: null,
  note: null,
  partnerId: null,
  initiator: null,
  protection: null
})

function seed() {
  const ctx = openTestContext()
  const events = new EventService(ctx)
  const checkins = new CheckinService(ctx)
  // This week (13–19 Nov): 2 partnered, 1 other, desire 4 and 2.
  events.create(entry('sex', '2026-11-19'))
  events.create(entry('sex', '2026-11-14'))
  events.create(entry('fantasy', '2026-11-13'))
  checkins.setDesire('2026-11-19', 4)
  checkins.setDesire('2026-11-15', 2)
  // The week before (6–12 Nov): 1 other, desire 5.
  events.create(entry('masturbation', '2026-11-10'))
  checkins.setDesire('2026-11-08', 5)
  // Five weeks back (in the previous 28 days): 1 partnered, a bleeding day and a spotting day.
  events.create(entry('sex', '2026-10-18'))
  ctx.db.prepare("INSERT INTO daily_checkins (date, flow, flow_source, updated_at) VALUES ('2026-10-17', 'light', 'health', 'x')").run()
  ctx.db.prepare("INSERT INTO daily_checkins (date, flow, flow_source, updated_at) VALUES ('2026-11-02', 'spotting', 'health', 'x')").run()
  return new InsightsService(ctx)
}

describe('insights — libido (phase 5)', () => {
  it('12 weeks: weekly bars ending today, desire averages, bleeding weeks, per-week rates', () => {
    const insights = seed().libido(TODAY, '12w')
    expect(insights.unit).toBe('week')
    expect(insights.buckets).toHaveLength(12)
    expect(insights.buckets[11]).toEqual({ from: '2026-11-13', to: '2026-11-19', partnered: 2, other: 1, desire: 3, bleeding: false })
    expect(insights.buckets[10]).toMatchObject({ from: '2026-11-06', to: '2026-11-12', partnered: 0, other: 1, desire: 5 })
    // Spotting does not shade a week; bleeding does (T18).
    expect(insights.buckets[8]).toMatchObject({ from: '2026-10-23', to: '2026-10-29', bleeding: false })
    expect(insights.buckets[7]).toMatchObject({ from: '2026-10-16', to: '2026-10-22', partnered: 1, bleeding: true })
    expect(insights.buckets[9]).toMatchObject({ bleeding: false })
    // Counted from the first logged day (18 Oct, 33 days), not from the start of the 12 weeks: 3 and 2 entries.
    expect(insights.perWeek).toEqual({ partnered: 0.6, other: 0.4 })
    expect(insights.days).toHaveLength(84)
    expect(insights.days.at(-1)).toEqual({ date: TODAY, entries: 1, partnered: 1 })
    expect(insights).toMatchObject({ hasFlow: true, hasData: true })
  })

  it('compares the last 28 days with the 28 before', () => {
    const { current, previous } = seed().libido(TODAY, '12w').compare
    expect(current).toEqual({ from: '2026-10-23', to: TODAY, partnered: 2, other: 2, desire: 3.7, bleedingDays: 0 })
    expect(previous).toEqual({ from: '2026-09-25', to: '2026-10-22', partnered: 1, other: 0, desire: null, bleedingDays: 1 })
  })

  it('6 months and a year: calendar months, the last one up to today', () => {
    const service = seed()
    const half = service.libido(TODAY, '6m')
    expect(half.unit).toBe('month')
    expect(half.buckets.map((b) => b.from)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'])
    expect(half.buckets[5]).toMatchObject({ to: TODAY, partnered: 2, other: 2 })
    expect(half.buckets[4]).toMatchObject({ to: '2026-10-31', partnered: 1, bleeding: true })
    const year = service.libido(TODAY, '1y')
    expect(year.buckets).toHaveLength(12)
    expect(year.buckets[0]!.from).toBe('2025-12-01')
  })

  it('an empty journal says so', () => {
    const insights = new InsightsService(openTestContext()).libido(TODAY, '12w')
    expect(insights).toMatchObject({ hasData: false, hasFlow: false, perWeek: { partnered: 0, other: 0 } })
    expect(insights.buckets.every((b) => b.desire === null)).toBe(true)
  })
})
