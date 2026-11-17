import { describe, expect, it } from 'vitest'
import type { EventInput } from '../../shared/types'
import { openTestContext } from '../testing'
import { EventService } from './events'
import { PartnerService } from './partners'

const sex = (over: Partial<EventInput> = {}): EventInput => ({
  kind: 'sex',
  occurredOn: '2026-11-16',
  occurredTime: '23:10',
  satisfaction: 8,
  orgasm: true,
  note: '  Slow evening  ',
  partnerId: null,
  initiator: 'mutual',
  protection: 'none',
  ...over
})

describe('events', () => {
  it('creates a partnered entry with its details and partner label', () => {
    const ctx = openTestContext()
    const partner = new PartnerService(ctx).create('A')
    const event = new EventService(ctx).create(sex({ partnerId: partner.id }))
    expect(event).toMatchObject({
      kind: 'sex',
      occurredOn: '2026-11-16',
      occurredTime: '23:10',
      satisfaction: 8,
      orgasm: true,
      note: 'Slow evening',
      partnerId: partner.id,
      partnerLabel: 'A',
      initiator: 'mutual',
      protection: 'none'
    })
  })

  it('drops fields that do not apply to the kind', () => {
    const ctx = openTestContext()
    const partner = new PartnerService(ctx).create('A')
    const events = new EventService(ctx)
    const solo = events.create(sex({ kind: 'masturbation', partnerId: partner.id }))
    expect(solo).toMatchObject({ satisfaction: 8, orgasm: true, partnerId: null, initiator: null, protection: null })
    const dream = events.create(sex({ kind: 'dream' }))
    expect(dream).toMatchObject({ satisfaction: null, orgasm: null, initiator: null, protection: null })
    expect(ctx.db.prepare('SELECT COUNT(*) FROM sex_details').pluck().get()).toBe(0)
  })

  it('changing sex to another kind removes the partnered details', () => {
    const ctx = openTestContext()
    const events = new EventService(ctx)
    const event = events.create(sex())
    expect(ctx.db.prepare('SELECT COUNT(*) FROM sex_details').pluck().get()).toBe(1)
    ctx.tick()
    const updated = events.update(event.id, sex({ kind: 'fantasy' }))
    expect(updated).toMatchObject({ kind: 'fantasy', initiator: null, satisfaction: null })
    expect(updated.updatedAt > event.updatedAt).toBe(true)
    expect(ctx.db.prepare('SELECT COUNT(*) FROM sex_details').pluck().get()).toBe(0)
  })

  it('rejects invalid input', () => {
    const events = new EventService(openTestContext())
    expect(() => events.create(sex({ occurredOn: '2026-02-30' }))).toThrow(/does not exist/)
    expect(() => events.create(sex({ occurredTime: '24:00' }))).toThrow(/Time/)
    expect(() => events.create(sex({ satisfaction: 11 }))).toThrow(/1 to 10/)
    expect(() => events.create(sex({ satisfaction: 7.5 }))).toThrow(/whole number/)
    expect(() => events.create(sex({ partnerId: 'missing' }))).toThrow(/no longer exists/)
    expect(() => events.create(sex({ protection: 'pill' as never }))).toThrow(/Protection/)
  })

  it('an archived label is kept on old entries but cannot be picked for new ones', () => {
    const ctx = openTestContext()
    const partners = new PartnerService(ctx)
    const events = new EventService(ctx)
    const partner = partners.create('M')
    const old = events.create(sex({ partnerId: partner.id }))
    partners.setArchived(partner.id, true)
    expect(events.update(old.id, sex({ partnerId: partner.id, satisfaction: 6 })).partnerLabel).toBe('M')
    expect(() => events.create(sex({ partnerId: partner.id }))).toThrow(/archived/)
  })

  it('deletes an entry with its details', () => {
    const ctx = openTestContext()
    const events = new EventService(ctx)
    const event = events.create(sex())
    events.delete(event.id)
    expect(() => events.get(event.id)).toThrow(/no longer exists/)
    expect(ctx.db.prepare('SELECT COUNT(*) FROM sex_details').pluck().get()).toBe(0)
  })
})
