import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { ApiHandlers } from '../shared/api'
import type { LockStatus } from '../shared/types'
import { openMemoryDatabase, type MemoryDatabase } from './db/wasm'
import { createContext } from './domain/context'
import { DomainError } from './domain/errors'
import { createHandlers } from './services'
import {
  afterWrongPin,
  DEFAULT_AUTO_LOCK,
  importDataKey,
  isAutoLock,
  isPin,
  newRawKey,
  PIN_LENGTH,
  unwrapWithPin,
  wrapWithPin,
  type AutoLock,
  type Bytes,
  type LockRecord
} from './storage/lock'
import { StorageError, Vault, type KeyStore, type Opened, type SlotStore } from './storage/vault'

interface OpenJournal {
  memory: MemoryDatabase
  vault: Vault
  handlers: ApiHandlers
  /** The data key in the clear, kept only while open and only with the lock on (to re-wrap it). */
  raw: Bytes | null
}

/**
 * Tide's storage session in the Worker (T17, T21): either the journal is open — decrypted in memory —
 * or Tide is locked and nothing of the journal is in memory, only the wrapped key.
 */
export class Session {
  private journal: OpenJournal | null = null
  private record: LockRecord | null = null

  private constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly slots: SlotStore,
    private readonly keys: KeyStore,
    private readonly clock: () => number,
    private readonly pinIterations?: number
  ) {}

  static async start(
    sqlite3: Sqlite3Static,
    slots: SlotStore,
    keys: KeyStore,
    options: { clock?: () => number; pinIterations?: number } = {}
  ): Promise<Session> {
    const session = new Session(sqlite3, slots, keys, options.clock ?? Date.now, options.pinIterations)
    const opened = await Vault.open(slots, keys)
    if ('locked' in opened) session.record = await session.withoutFaceId(opened.locked)
    else await session.load(opened, null)
    return session
  }

  /**
   * After the saves disappeared (T24): forgets the orphaned key and opens a new, empty journal, with the lock off.
   * The vault refuses while any save is present, so this cannot erase a journal.
   */
  static async startOver(
    sqlite3: Sqlite3Static,
    slots: SlotStore,
    keys: KeyStore,
    options: { clock?: () => number; pinIterations?: number } = {}
  ): Promise<Session> {
    await Vault.startOver(slots, keys)
    return Session.start(sqlite3, slots, keys, options)
  }

  /** The domain API; only while the journal is open. */
  handlers(): ApiHandlers {
    if (!this.journal) throw new DomainError('LOCKED', 'Tide is locked')
    return this.journal.handlers
  }

  /** Encrypts and stores the journal after a change. */
  async persist(): Promise<void> {
    if (!this.journal) throw new DomainError('LOCKED', 'Tide is locked')
    try {
      await this.journal.vault.save(this.journal.memory.serialize())
    } catch (error) {
      console.error(error)
      throw new StorageError('The change could not be saved to the phone. Close Tide and open it again.')
    }
  }

  status(): LockStatus {
    const record = this.record
    return {
      enabled: record !== null,
      locked: this.journal === null,
      autoLock: record?.autoLock ?? DEFAULT_AUTO_LOCK,
      retryAt: record && record.retryAt > this.clock() ? record.retryAt : null
    }
  }

  async unlockWithPin(pin: string): Promise<LockStatus> {
    if (this.journal || !this.record) return this.status()
    const raw = await this.checkPin(pin)
    await this.load(await Vault.withKey(this.slots, this.keys, await importDataKey(raw)), raw)
    return this.status()
  }

  /** Closes the journal: the database and the key leave memory. Only with the lock on. */
  lock(): LockStatus {
    if (this.record && this.journal) {
      this.journal.memory.close()
      this.journal.raw?.fill(0)
      this.journal = null
    }
    return this.status()
  }

  /** Turns the lock on: a new data key, wrapped by the PIN, replaces the browser-kept one. */
  async enable(pin: string): Promise<LockStatus> {
    const journal = this.openJournal()
    if (this.record) throw new DomainError('VALIDATION', 'App lock is already on')
    if (!isPin(pin)) throw new DomainError('VALIDATION', `The PIN must be ${PIN_LENGTH} digits`)
    const raw = newRawKey()
    const record: LockRecord = {
      kind: 'lock',
      version: 1,
      pin: await wrapWithPin(raw, pin, this.pinIterations),
      autoLock: DEFAULT_AUTO_LOCK,
      failed: 0,
      retryAt: 0
    }
    await journal.vault.rekey(await importDataKey(raw), journal.memory.serialize(), () => this.keys.save(record))
    this.record = record
    journal.raw = raw
    return this.status()
  }

  /** Turns the lock off after the PIN: the same data key goes back to the browser's keeping. */
  async disable(pin: string): Promise<LockStatus> {
    const journal = this.openJournal()
    const raw = await this.checkPin(pin)
    await this.keys.save(await importDataKey(raw))
    this.record = null
    journal.raw?.fill(0)
    journal.raw = null
    return this.status()
  }

  async changePin(current: string, next: string): Promise<LockStatus> {
    this.openJournal()
    if (!isPin(next)) throw new DomainError('VALIDATION', `The PIN must be ${PIN_LENGTH} digits`)
    const raw = await this.checkPin(current)
    await this.store({ ...this.lockRecord(), pin: await wrapWithPin(raw, next, this.pinIterations) })
    return this.status()
  }

  async setAutoLock(minutes: AutoLock): Promise<LockStatus> {
    this.openJournal()
    if (!isAutoLock(minutes)) throw new DomainError('VALIDATION', 'Auto-lock is not valid')
    await this.store({ ...this.lockRecord(), autoLock: minutes })
    return this.status()
  }

  private async load({ vault, image }: Opened, raw: Bytes | null): Promise<void> {
    const memory = openMemoryDatabase(this.sqlite3, image ?? undefined)
    this.journal = { memory, vault, raw, handlers: createHandlers(createContext(memory.db)) }
    // Store right away: on first launch the new empty journal, after an update any schema migration.
    await this.persist()
  }

  private openJournal(): OpenJournal {
    if (!this.journal) throw new DomainError('LOCKED', 'Tide is locked')
    return this.journal
  }

  private lockRecord(): LockRecord {
    if (!this.record) throw new DomainError('VALIDATION', 'App lock is off')
    return this.record
  }

  /**
   * Face ID was removed (T22). A lock record from v0.3.0 may still hold the data key wrapped by a passkey
   * secret: drop that copy, so only the PIN opens the journal.
   */
  private async withoutFaceId(record: LockRecord): Promise<LockRecord> {
    if (!('faceId' in record)) return record
    const { faceId: _removed, ...rest } = record as LockRecord & { faceId?: unknown }
    await this.keys.save(rest)
    return rest
  }

  private async store(record: LockRecord): Promise<void> {
    await this.keys.save(record)
    this.record = record
  }

  /** The raw key for a right PIN; a wrong one is counted and, after four, makes the next try wait. */
  private async checkPin(pin: string): Promise<Bytes> {
    const record = this.lockRecord()
    const now = this.clock()
    if (record.retryAt > now) {
      throw new DomainError('WAIT', `Too many wrong PINs. Try again in ${waitText(record.retryAt - now)}.`)
    }
    const raw = isPin(pin) ? await unwrapWithPin(record.pin, pin) : null
    if (!raw) {
      const next = afterWrongPin(record, now)
      await this.store(next)
      if (next.retryAt > now) throw new DomainError('WAIT', `Too many wrong PINs. Try again in ${waitText(next.retryAt - now)}.`)
      throw new DomainError('WRONG_PIN', 'Wrong PIN')
    }
    if (record.failed > 0) await this.store({ ...record, failed: 0, retryAt: 0 })
    return raw
  }
}

function waitText(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}
