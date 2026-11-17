import { describe, expect, it } from 'vitest'
import type { EventInput, EventKind } from '../../shared/types'
import { openTestContext } from '../testing'
import { CheckinService } from './checkins'
import { EventService } from './events'
import { JournalService } from './journal'

const entry = (kind: EventKind, occurredOn: string, occurredTime: string | null = null): EventInput => ({
  kind,
  occurredOn,
  occurredTime,
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
  events.create(entry('sex', '2026-11-16', '23:10'))
  events.create(entry('fantasy', '2026-11-16', '15:40'))
  events.create(entry('dream', '2026-11-15'))
  events.create(entry('masturbation', '2026-11-13', '22:40'))
  checkins.setDesire('2026-11-17', 7)
  checkins.setDesire('2026-11-16', 6)
  checkins.setDesire('2026-11-14', 5)
  return { ctx, journal: new JournalService(ctx), checkins }
}

describe('journal', () => {
  it('lists days latest first with events in time order and the check-in', () => {
    const { journal } = seed()
    const page = journal.days({ before: null, limit: 10, filter: 'all' })
    expect(page.days.map((d) => d.date)).toEqual(['2026-11-17', '2026-11-16', '2026-11-15', '2026-11-14', '2026-11-13'])
    expect(page.days[1]?.desire).toBe(6)
    expect(page.days[1]?.events.map((e) => e.kind)).toEqual(['sex', 'fantasy'])
    expect(page.nextBefore).toBeNull()
  })

  it('pages by day', () => {
    const { journal } = seed()
    const first = journal.days({ before: null, limit: 2, filter: 'all' })
    expect(first.days.map((d) => d.date)).toEqual(['2026-11-17', '2026-11-16'])
    expect(first.nextBefore).toBe('2026-11-16')
    const second = journal.days({ before: first.nextBefore, limit: 2, filter: 'all' })
    expect(second.days.map((d) => d.date)).toEqual(['2026-11-15', '2026-11-14'])
  })

  it('filters keep only matching days and events', () => {
    const { journal } = seed()
    const partnered = journal.days({ before: null, limit: 10, filter: 'partnered' })
    expect(partnered.days.map((d) => [d.date, d.events.map((e) => e.kind)])).toEqual([['2026-11-16', ['sex']]])
    const other = journal.days({ before: null, limit: 10, filter: 'other' })
    expect(other.days.map((d) => d.date)).toEqual(['2026-11-16', '2026-11-15', '2026-11-13'])
    expect(other.days[0]?.events.map((e) => e.kind)).toEqual(['fantasy'])
    const checkins = journal.days({ before: null, limit: 10, filter: 'checkins' })
    expect(checkins.days.map((d) => [d.date, d.events.length])).toEqual([
      ['2026-11-17', 0],
      ['2026-11-16', 0],
      ['2026-11-14', 0]
    ])
  })

  it('a check-in cleared to nothing disappears', () => {
    const { journal, checkins, ctx } = seed()
    checkins.setDesire('2026-11-14', null)
    expect(ctx.db.prepare('SELECT COUNT(*) FROM daily_checkins WHERE date = ?').pluck().get('2026-11-14')).toBe(0)
    expect(journal.days({ before: null, limit: 10, filter: 'checkins' }).days.map((d) => d.date)).not.toContain('2026-11-14')
  })

  it('month cells count partnered and other activity', () => {
    const { journal } = seed()
    expect(journal.month('2026-11')).toEqual([
      { date: '2026-11-13', partnered: 0, other: 1, desire: null },
      { date: '2026-11-14', partnered: 0, other: 0, desire: 5 },
      { date: '2026-11-15', partnered: 0, other: 1, desire: null },
      { date: '2026-11-16', partnered: 1, other: 1, desire: 6 },
      { date: '2026-11-17', partnered: 0, other: 0, desire: 7 }
    ])
    expect(journal.month('2026-10')).toEqual([])
  })

  it('the week ends today and averages the rated days', () => {
    const { journal } = seed()
    const week = journal.week('2026-11-17')
    expect(week.days.map((d) => d.date)).toEqual([
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17'
    ])
    expect(week.partnered).toBe(1)
    expect(week.other).toBe(3)
    expect(week.desireAverage).toBe(6)
    expect(week.days[6]).toEqual({ date: '2026-11-17', desire: 7, partnered: 0, other: 0 })
  })

  it('one day returns everything recorded on it, or an empty day', () => {
    const { journal } = seed()
    expect(journal.day('2026-11-16').events).toHaveLength(2)
    expect(journal.day('2026-11-01')).toEqual({ date: '2026-11-01', desire: null, events: [] })
  })
})
