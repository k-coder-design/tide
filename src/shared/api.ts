import type {
  BackupStatus,
  EventInput,
  HealthImportResult,
  MergeResult,
  RestoreMode,
  LockStatus,
  JournalDay,
  JournalFilter,
  JournalPage,
  MonthDay,
  Partner,
  Settings,
  Theme,
  TideEvent,
  TodaySummary
} from './types'

/**
 * Everything the interface can ask the core (in the Worker). The interface never touches the database:
 * it calls these methods through the client (src/ui/lib/client.ts).
 */
export interface ApiContract {
  'today.summary'(today: string): TodaySummary
  'checkins.setDesire'(date: string, desire: number | null): void
  'events.get'(id: string): TideEvent
  'events.create'(input: EventInput): TideEvent
  'events.update'(id: string, input: EventInput): TideEvent
  'events.delete'(id: string): void
  'journal.days'(query: { before: string | null; limit: number; filter: JournalFilter }): JournalPage
  'journal.day'(date: string): JournalDay
  'journal.month'(month: string): MonthDay[]
  'partners.list'(includeArchived: boolean): Partner[]
  'partners.create'(label: string): Partner
  'partners.rename'(id: string, label: string): Partner
  'partners.setArchived'(id: string, archived: boolean): Partner
  'settings.get'(): Settings
  'settings.setTheme'(theme: Theme): Settings
  'backup.status'(): BackupStatus
  /** After the backup file was saved or shared. */
  'backup.markDone'(): BackupStatus
  'backup.setReminder'(on: boolean): BackupStatus
  /** Backups without a password (T28). */
  'backup.setPlain'(on: boolean): BackupStatus
}

export type ApiMethod = keyof ApiContract

/** Methods that change data: after each one the Worker encrypts and stores the database. */
export const WRITE_METHODS: ReadonlySet<ApiMethod> = new Set<ApiMethod>([
  'checkins.setDesire',
  'events.create',
  'events.update',
  'events.delete',
  'partners.create',
  'partners.rename',
  'partners.setArchived',
  'settings.setTheme',
  'backup.markDone',
  'backup.setReminder',
  'backup.setPlain'
])

export type ApiHandlers = { [M in ApiMethod]: (...args: Parameters<ApiContract[M]>) => ReturnType<ApiContract[M]> }

const METHODS: ReadonlySet<string> = new Set<ApiMethod>([
  'today.summary',
  'checkins.setDesire',
  'events.get',
  'events.create',
  'events.update',
  'events.delete',
  'journal.days',
  'journal.day',
  'journal.month',
  'partners.list',
  'partners.create',
  'partners.rename',
  'partners.setArchived',
  'settings.get',
  'settings.setTheme',
  'backup.status',
  'backup.markDone',
  'backup.setReminder',
  'backup.setPlain'
])

export const isApiMethod = (value: unknown): value is ApiMethod => typeof value === 'string' && METHODS.has(value)

/** The app lock (T21): handled by the storage session in the Worker, answered even while Tide is locked. */
export interface LockContract {
  'lock.status'(): LockStatus
  'lock.unlockWithPin'(pin: string): LockStatus
  'lock.lock'(): LockStatus
  'lock.enable'(pin: string): LockStatus
  'lock.disable'(pin: string): LockStatus
  'lock.changePin'(current: string, next: string): LockStatus
  'lock.setAutoLock'(minutes: LockStatus['autoLock']): LockStatus
}

export type LockMethod = keyof LockContract

/** Storage as a whole — handled by the session in the Worker, which holds the keys and the encrypted saves. */
export interface StorageContract {
  /** After the saves disappeared (T24): forget the orphaned key and open a new, empty journal. Works even when the journal could not open. */
  'storage.startOver'(): LockStatus
  /** Phase 4: erase the journal, its saves and keys; Tide starts again as on first launch. */
  'storage.deleteAll'(): LockStatus
  'backup.setPassword'(password: string): BackupStatus
  /** The encrypted backup file, ready to save or share. */
  'backup.create'(): Uint8Array
  'backup.restore'(file: Uint8Array, password: string, mode: RestoreMode): MergeResult
  /** The encrypted file from scripts/health-import.mjs (T27). */
  'health.import'(file: Uint8Array, password: string): HealthImportResult
}

export type StorageMethod = keyof StorageContract

/** Everything the client can call. */
export type ClientContract = ApiContract & LockContract & StorageContract
export type ClientMethod = keyof ClientContract

const LOCK_METHODS: ReadonlySet<string> = new Set<LockMethod>([
  'lock.status',
  'lock.unlockWithPin',
  'lock.lock',
  'lock.enable',
  'lock.disable',
  'lock.changePin',
  'lock.setAutoLock'
])

export const isLockMethod = (value: unknown): value is LockMethod => typeof value === 'string' && LOCK_METHODS.has(value)
