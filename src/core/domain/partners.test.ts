import { describe, expect, it } from 'vitest'
import { openTestContext } from '../testing'
import { PartnerService } from './partners'
import { SettingsService } from './settings'

describe('partner labels', () => {
  it('creates, renames, archives; archived labels are listed only on request', () => {
    const partners = new PartnerService(openTestContext())
    const a = partners.create('  A  ')
    const m = partners.create('M')
    expect(a.label).toBe('A')
    expect(partners.rename(m.id, 'Max').label).toBe('Max')
    partners.setArchived(a.id, true)
    expect(partners.list(false).map((p) => p.label)).toEqual(['Max'])
    expect(partners.list(true).map((p) => [p.label, p.archived])).toEqual([
      ['Max', false],
      ['A', true]
    ])
  })

  it('labels are unique regardless of case and not empty', () => {
    const partners = new PartnerService(openTestContext())
    const a = partners.create('A')
    expect(() => partners.create('a')).toThrow(/already/)
    expect(() => partners.create('   ')).toThrow(/empty/)
    expect(() => partners.create('x'.repeat(25))).toThrow(/longer/)
    expect(partners.rename(a.id, 'a').label).toBe('a')
  })
})

describe('settings', () => {
  it('theme defaults to system and rejects unknown values', () => {
    const settings = new SettingsService(openTestContext())
    expect(settings.get().theme).toBe('system')
    expect(settings.setTheme('dark').theme).toBe('dark')
    expect(() => settings.setTheme('blue' as never)).toThrow(/Appearance/)
  })
})
