import { describe, expect, it } from 'vitest'
import { isLockRecord, type LockRecord } from './storage/lock'
import { Session } from './session'
import { JournalMissingError } from './storage/vault'
import { loadSqlite, memoryKeys, memorySlots } from './testing'

const TODAY = '2026-11-17'
const bytes = (fill: number, length = 32) => new Uint8Array(length).fill(fill)

async function start(slots = memorySlots(), keys = memoryKeys(), clock = { now: 1_000_000 }) {
  const session = await Session.start(await loadSqlite(), slots, keys, { clock: () => clock.now, pinIterations: 1000 })
  return { session, slots, keys, clock }
}

async function writeDesire(session: Session, desire: number) {
  session.handlers()['checkins.setDesire'](TODAY, desire)
  await session.persist()
}

const desire = (session: Session) => session.handlers()['today.summary'](TODAY).desire

describe('app lock', () => {
  it('lock off: Tide opens without a PIN and keeps the journal across launches', async () => {
    const { session, slots, keys } = await start()
    expect(session.status()).toMatchObject({ enabled: false, locked: false, autoLock: 1 })
    await writeDesire(session, 4)
    const again = await start(slots, keys)
    expect(desire(again.session)).toBe(4)
  })

  it('lock on: the next launch is locked and opens only with the right PIN', async () => {
    const { session, slots, keys } = await start()
    await writeDesire(session, 3)
    await session.enable('2580')
    expect(isLockRecord(keys.key)).toBe(true)

    const next = await start(slots, keys)
    expect(next.session.status()).toMatchObject({ enabled: true, locked: true })
    expect(() => next.session.handlers()).toThrow('Tide is locked')
    await expect(next.session.unlockWithPin('1111')).rejects.toThrow('Wrong PIN')
    expect((await next.session.unlockWithPin('2580')).locked).toBe(false)
    expect(desire(next.session)).toBe(3)
  })

  it('the saves are re-encrypted with the new key, so the old browser key no longer opens them', async () => {
    const { session, slots, keys } = await start()
    await writeDesire(session, 2)
    const plainKey = keys.key
    await session.enable('2580')
    const withOldKey = memoryKeys()
    withOldKey.key = plainKey
    await expect(start(slots, withOldKey)).rejects.toThrow('could not be decrypted')
  })

  it('locking drops the journal from memory until it is unlocked again', async () => {
    const { session } = await start()
    await session.enable('2580')
    await writeDesire(session, 5)
    expect(session.lock().locked).toBe(true)
    expect(() => desire(session)).toThrow('Tide is locked')
    await session.unlockWithPin('2580')
    expect(desire(session)).toBe(5)
  })

  it('without the lock, lock() changes nothing', async () => {
    const { session } = await start()
    expect(session.lock().locked).toBe(false)
  })

  it('wrong PINs: four free tries, the fifth starts a wait that survives a restart', async () => {
    const { session, slots, keys, clock } = await start()
    await session.enable('2580')
    session.lock()
    for (let i = 0; i < 4; i++) await expect(session.unlockWithPin('0000')).rejects.toThrow('Wrong PIN')
    expect(session.status().retryAt).toBeNull()
    await expect(session.unlockWithPin('0000')).rejects.toThrow('Try again in 30 s')
    expect(session.status().retryAt).toBe(clock.now + 30_000)
    await expect(session.unlockWithPin('2580')).rejects.toThrow('Try again in 30 s')

    const restarted = await start(slots, keys, clock)
    await expect(restarted.session.unlockWithPin('2580')).rejects.toThrow('Try again')
    clock.now += 30_000
    await restarted.session.unlockWithPin('2580')
    expect((keys.key as LockRecord).failed).toBe(0)
  })

  it('a lock record from v0.3.0 loses its Face ID copy of the key on start; the PIN still opens', async () => {
    const { session, slots, keys } = await start()
    await session.enable('2580')
    keys.key = { ...(keys.key as LockRecord), faceId: { credentialId: bytes(1, 16), prfSalt: bytes(2), iv: bytes(3, 12), data: bytes(4, 48) } } as LockRecord
    const next = await start(slots, keys)
    expect('faceId' in (keys.key as object)).toBe(false)
    await next.session.unlockWithPin('2580')
  })

  it('change PIN asks for the current one; the old PIN stops working', async () => {
    const { session, slots, keys } = await start()
    await session.enable('2580')
    await expect(session.changePin('1111', '7777')).rejects.toThrow('Wrong PIN')
    await session.changePin('2580', '7777')
    const next = await start(slots, keys)
    await expect(next.session.unlockWithPin('2580')).rejects.toThrow('Wrong PIN')
    await next.session.unlockWithPin('7777')
  })

  it('turning the lock off needs the PIN, then Tide opens freely with the same journal', async () => {
    const { session, slots, keys } = await start()
    await session.enable('2580')
    await writeDesire(session, 1)
    await expect(session.disable('1111')).rejects.toThrow('Wrong PIN')
    expect((await session.disable('2580')).enabled).toBe(false)
    expect(isLockRecord(keys.key)).toBe(false)

    const next = await start(slots, keys)
    expect(next.session.status()).toMatchObject({ enabled: false, locked: false })
    expect(desire(next.session)).toBe(1)
  })

  it('settings checks: PIN of 4 digits, known auto-lock values, lock changes only while open', async () => {
    const { session } = await start()
    await expect(session.enable('12345')).rejects.toThrow('4 digits')
    await expect(session.enable('12a4')).rejects.toThrow('4 digits')
    await expect(session.setAutoLock(5)).rejects.toThrow('App lock is off')
    await session.enable('2580')
    expect((await session.setAutoLock(0)).autoLock).toBe(0)
    await expect(session.setAutoLock(3 as 1)).rejects.toThrow('not valid')
    session.lock()
    await expect(session.setAutoLock(5)).rejects.toThrow('Tide is locked')
    await expect(session.changePin('2580', '1111')).rejects.toThrow('Tide is locked')
  })

  it('a save cut off while turning the lock on still opens with the old key', async () => {
    const { session, slots, keys } = await start()
    await writeDesire(session, 2)
    const plainKey = keys.key
    const failing = { ...keys, save: async () => Promise.reject(new Error('power off')) }
    const broken = await Session.start(await loadSqlite(), slots, failing, { pinIterations: 1000 })
    await expect(broken.enable('2580')).rejects.toThrow('power off')
    const withOldKey = memoryKeys()
    withOldKey.key = plainKey
    const reopened = await start(slots, withOldKey)
    expect(desire(reopened.session)).toBe(2)
  })
})

describe('a journal whose saves disappeared (T24)', () => {
  const wipeSaves = (slots: ReturnType<typeof memorySlots>) => slots.data.fill(null)

  it('stops instead of starting an empty journal, and writes nothing', async () => {
    const { session, slots, keys } = await start()
    await writeDesire(session, 4)
    expect(keys.saved).toBe(true)
    const key = keys.key
    wipeSaves(slots)
    await expect(start(slots, keys)).rejects.toThrow(JournalMissingError)
    expect(slots.data).toEqual([null, null])
    expect(keys.key).toBe(key)
  })

  it('stops before the PIN too, when the lock is on', async () => {
    const { session, slots, keys } = await start()
    await session.enable('2580')
    wipeSaves(slots)
    await expect(start(slots, keys)).rejects.toThrow('no longer on this phone')
  })

  it('a first launch cut off before its first save still opens, as a new journal', async () => {
    const { session, slots, keys } = await start()
    wipeSaves(slots)
    keys.saved = false
    void session
    const again = await start(slots, keys)
    expect(desire(again.session)).toBeNull()
  })

  it('a journal saved by an older Tide, without the note, gets the note on its next launch', async () => {
    const { session, slots, keys } = await start()
    await writeDesire(session, 2)
    keys.saved = false
    await start(slots, keys)
    expect(keys.saved).toBe(true)
  })

  it('starting over forgets the old key and the PIN and opens an empty journal', async () => {
    const { session, slots, keys } = await start()
    await session.enable('2580')
    wipeSaves(slots)
    const fresh = await Session.startOver(await loadSqlite(), slots, keys, { pinIterations: 1000 })
    expect(fresh.status()).toMatchObject({ enabled: false, locked: false })
    expect(desire(fresh)).toBeNull()
    await writeDesire(fresh, 3)
    expect(desire((await start(slots, keys)).session)).toBe(3)
  })

  it('starting over is refused while any save is present', async () => {
    const { session, slots, keys } = await start()
    await writeDesire(session, 5)
    slots.data[1] = null // the older save; the newest one stays
    await expect(Session.startOver(await loadSqlite(), slots, keys)).rejects.toThrow('nothing was reset')
    expect(desire((await start(slots, keys)).session)).toBe(5)
  })
})
