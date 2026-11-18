import { describe, expect, it } from 'vitest'
import { Session } from './session'
import { memoryKeys, memorySlots, loadSqlite } from './testing'

const TODAY = '2026-11-17'
const PASSWORD = 'correct horse'

async function start(slots = memorySlots(), keys = memoryKeys(), clock = { now: Date.parse('2026-11-17T12:00:00Z') }) {
  const session = await Session.start(await loadSqlite(), slots, keys, { clock: () => clock.now, pinIterations: 1000, backupIterations: 1000 })
  return { session, slots, keys }
}

const api = (session: Session) => session.handlers()

async function logSolo(session: Session, date = TODAY, note: string | null = null) {
  const event = api(session)['events.create']({
    kind: 'masturbation',
    occurredOn: date,
    occurredTime: null,
    satisfaction: 7,
    orgasm: true,
    note,
    partnerId: null,
    initiator: null,
    protection: null
  })
  await session.persist()
  return event
}

async function backupOf(session: Session, password = PASSWORD) {
  await session.setBackupPassword(password)
  return session.createBackup()
}

describe('backups (phase 4)', () => {
  it('a backup needs a password of 8+ characters and is not readable without it', async () => {
    const { session } = await start()
    await expect(session.createBackup()).rejects.toThrow('Set a backup password first')
    await expect(session.setBackupPassword('short')).rejects.toThrow('at least 8')
    await logSolo(session, TODAY, 'private words')
    const file = await backupOf(session)
    expect(new TextDecoder().decode(file)).not.toContain('private words')
    expect(api(session)['backup.status']().passwordSet).toBe(true)
  })

  it('replace: a backup restores the whole journal on a new phone, and its password works there', async () => {
    const old = (await start()).session
    api(old)['checkins.setDesire'](TODAY, 4)
    await logSolo(old)
    const file = await backupOf(old)

    const { session: fresh, slots, keys } = await start()
    await expect(fresh.restoreBackup(file, 'wrong password', 'replace')).rejects.toThrow('Wrong password')
    expect(await fresh.restoreBackup(file, PASSWORD, 'replace')).toMatchObject({ entries: 1, days: 1 })
    expect(api(fresh)['today.summary'](TODAY).desire).toBe(4)
    // Saved to the phone, and the backup password came along for the next backup.
    const reopened = (await start(slots, keys)).session
    expect(api(reopened)['today.summary'](TODAY).week.other).toBe(1)
    expect(api(reopened)['backup.status']()).toMatchObject({ passwordSet: true, due: false })
    await reopened.createBackup()
  })

  it('merge: adds what is missing, takes newer copies, keeps newer local ones', async () => {
    const clock = { now: Date.parse('2026-11-17T12:00:00Z') }
    const phone = (await start(undefined, undefined, clock)).session
    const shared = await logSolo(phone, '2026-11-10', 'first')
    const file = await backupOf(phone)

    const other = (await start()).session
    await other.restoreBackup(file, PASSWORD, 'replace')
    api(other)['events.update'](shared.id, { ...shared, partnerId: null, initiator: null, protection: null, note: 'edited later' } as never)
    await logSolo(other, '2026-11-12', 'only in the backup')
    api(other)['checkins.setDesire']('2026-11-12', 2)
    await other.persist()
    const later = await other.createBackup()

    await logSolo(phone, '2026-11-15', 'only on the phone')
    const result = await phone.restoreBackup(later, PASSWORD, 'merge')
    expect(result).toMatchObject({ added: 2, updated: 1 })
    const notes = api(phone)['journal.days']({ before: null, limit: 30, filter: 'all' }).days.flatMap((d) => d.events.map((e) => e.note))
    expect(notes.sort()).toEqual(['edited later', 'only in the backup', 'only on the phone'])

    // The same backup again changes nothing.
    expect(await phone.restoreBackup(later, PASSWORD, 'merge')).toMatchObject({ added: 0, updated: 0 })
  })

  it('a file that is not a backup is refused and the journal stays', async () => {
    const { session } = await start()
    await logSolo(session)
    await expect(session.restoreBackup(new TextEncoder().encode('hello there, not a backup at all'), PASSWORD, 'replace')).rejects.toThrow(
      'not a Tide backup'
    )
    expect(api(session)['today.summary'](TODAY).week.other).toBe(1)
  })

  it('the weekly reminder: due with entries and no backup, quiet for a week after one, can be turned off', async () => {
    const clock = { now: Date.parse('2026-11-17T12:00:00Z') }
    const { session } = await start(undefined, undefined, clock)
    expect(api(session)['backup.status']().due).toBe(false)
    await logSolo(session)
    expect(api(session)['backup.status']().due).toBe(true)
    await backupOf(session)
    expect(api(session)['backup.markDone']().due).toBe(false)
    expect(api(session)['backup.setReminder'](false).reminder).toBe(false)
  })

  it('delete all data: saves and keys are gone, the next start is a new empty journal', async () => {
    const { session, slots, keys } = await start()
    await logSolo(session)
    await session.enable('2580')
    await session.deleteAll()
    expect(() => session.handlers()).toThrow('Tide is locked')
    expect(slots.data.every((d) => d === null || d.byteLength === 0)).toBe(true)
    expect(keys.key).toBeNull()
    const next = (await start(slots, keys)).session
    expect(next.status()).toMatchObject({ enabled: false, locked: false })
    expect(api(next)['today.summary'](TODAY).week.other).toBe(0)
  })
})
