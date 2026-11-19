import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { ApiHandlers } from '../shared/api'
import type { BackupStatus, HealthImportResult, LockStatus, MergeResult, RestoreMode } from '../shared/types'
import { SCHEMA_VERSION } from './db/migrations'
import { openMemoryDatabase, type MemoryDatabase } from './db/wasm'
import { BackupService } from './domain/backups'
import { createContext } from './domain/context'
import { HealthImportService } from './domain/healthImport'
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
import { checkBackupPassword, deriveBackupKey, openBackup, openHealthFile, plainBackup, sealBackup } from './storage/backup'
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
    private readonly pinIterations?: number,
    private readonly backupIterations?: number
  ) {}

  static async start(
    sqlite3: Sqlite3Static,
    slots: SlotStore,
    keys: KeyStore,
    options: SessionOptions = {}
  ): Promise<Session> {
    const session = new Session(sqlite3, slots, keys, options.clock ?? Date.now, options.pinIterations, options.backupIterations)
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
    options: SessionOptions = {}
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

  /** Sets or changes the backup password; its key is kept inside the encrypted journal (T26). */
  async setBackupPassword(password: string): Promise<BackupStatus> {
    const journal = this.openJournal()
    const key = await deriveBackupKey(checkBackupPassword(password), undefined, this.backupIterations)
    const backups = new BackupService(createContext(journal.memory.db))
    backups.setKey(key)
    await this.persist()
    return backups.status()
  }

  /** The whole journal as a backup file: encrypted with the backup password, or as it is when the user chose no password (T28). */
  async createBackup(): Promise<Uint8Array> {
    const journal = this.openJournal()
    const backups = new BackupService(createContext(journal.memory.db))
    if (backups.status().plain) return plainBackup(journal.memory.serialize())
    const key = backups.key()
    if (!key) throw new DomainError('VALIDATION', 'Set a backup password first')
    return sealBackup(key, journal.memory.serialize())
  }

  /**
   * Restores a backup: "replace" makes it the whole journal, "merge" adds what is missing here and takes newer copies.
   * The app lock and its PIN stay as they are on this phone. Nothing changes unless the file opens and is a Tide journal.
   */
  async restoreBackup(file: Uint8Array, password: string, mode: RestoreMode): Promise<MergeResult> {
    const journal = this.openJournal()
    if (mode !== 'replace' && mode !== 'merge') throw new DomainError('VALIDATION', 'Choose Replace or Merge')
    if (!(file instanceof Uint8Array)) throw new DomainError('VALIDATION', 'Choose a backup file')
    const { image } = await openBackup(file, typeof password === 'string' ? password : '')
    const backup = this.openBackupImage(image)
    const local = new BackupService(createContext(journal.memory.db)).status()
    if (mode === 'merge') {
      try {
        const here = new BackupService(createContext(journal.memory.db))
        const result = here.merge(backup.db)
        here.adoptLocalState(local)
        await this.persist()
        return result
      } finally {
        backup.close()
      }
    }
    const contents = BackupService.contents(backup.db)
    new BackupService(createContext(backup.db)).adoptLocalState(local)
    const previous = journal.memory
    journal.memory = backup
    journal.handlers = createHandlers(createContext(backup.db))
    try {
      await this.persist()
    } catch (error) {
      backup.close()
      journal.memory = previous
      journal.handlers = createHandlers(createContext(previous.db))
      throw error
    }
    previous.close()
    return { ...contents, added: 0, updated: 0 }
  }

  /** The one-time Apple Health import (T12, T27): decrypts the file made on the Mac and adds what Tide does not have yet. */
  async importHealth(file: Uint8Array, password: string): Promise<HealthImportResult> {
    const journal = this.openJournal()
    if (!(file instanceof Uint8Array)) throw new DomainError('VALIDATION', 'Choose the import file')
    const data = await openHealthFile(file, typeof password === 'string' ? password : '')
    const result = new HealthImportService(createContext(journal.memory.db)).apply(data)
    await this.persist()
    return result
  }

  /**
   * Delete all data (phase 4): the journal leaves memory, both save files are emptied, then the keys and the PIN
   * are forgotten. The Worker then starts a new session, as on first launch. Saves go first: cut off after them,
   * the T24 screen offers a fresh start; never a readable journal without its owner's intent.
   */
  async deleteAll(): Promise<void> {
    const journal = this.openJournal()
    journal.memory.close()
    journal.raw?.fill(0)
    this.journal = null
    await this.slots.write(0, new Uint8Array(0))
    await this.slots.write(1, new Uint8Array(0))
    await this.keys.clear()
    this.record = null
  }

  /** A decrypted backup as a database, migrated to this version; refused if it is not a Tide journal or is newer. */
  private openBackupImage(image: Uint8Array): MemoryDatabase {
    let memory: MemoryDatabase
    try {
      memory = openMemoryDatabase(this.sqlite3, image)
    } catch {
      throw new DomainError('VALIDATION', 'The backup could not be read')
    }
    const version = memory.db.pragma('user_version', { simple: true }) as number
    const tables = memory.db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('events', 'partners', 'daily_checkins', 'sex_details', 'settings', 'medications')").pluck().get()
    if (version > SCHEMA_VERSION || tables !== 6) {
      memory.close()
      throw new DomainError('VALIDATION', version > SCHEMA_VERSION ? 'This backup was made by a newer Tide. Update Tide, then try again.' : 'The backup could not be read')
    }
    return memory
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

export interface SessionOptions {
  clock?: () => number
  /** Fewer PBKDF2 rounds — tests only. */
  pinIterations?: number
  backupIterations?: number
}

function waitText(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}
