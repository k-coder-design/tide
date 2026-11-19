import type {
  BackupStatus,
  CycleDay,
  CycleInsights,
  CycleMonth,
  CycleReport,
  ReportPeriod,
  LoggedFlow,
  Medication,
  MedicationInput,
  PillLog,
  PillStatus,
  SymptomTag,
  EventInput,
  HealthImportResult,
  InsightsPeriod,
  LibidoInsights,
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
  'insights.libido'(today: string, period: InsightsPeriod): LibidoInsights
  'backup.status'(): BackupStatus
  /** After the backup file was saved or shared. */
  'backup.markDone'(): BackupStatus
  'backup.setReminder'(on: boolean): BackupStatus
  /** Backups without a password (T28). */
  'backup.setPlain'(on: boolean): BackupStatus
  /** Phase 6 — the cycle (T13, T18); a null flow — not recorded. */
  'cycle.day'(date: string): CycleDay
  'cycle.setFlow'(date: string, flow: LoggedFlow | null): CycleDay
  'cycle.setSymptoms'(date: string, tags: SymptomTag[]): CycleDay
  'insights.cycle'(today: string): CycleInsights
  /** The Cycle tab's calendar (T35). */
  'cycle.month'(month: string, today: string): CycleMonth
  /** Data for the cycle report PDF, drawn on the phone (T35). */
  'reports.cycle'(today: string, period: ReportPeriod): CycleReport
  /** Medication courses (T6). */
  'medications.list'(today: string): Medication[]
  'medications.create'(input: MedicationInput, today: string): Medication
  'medications.update'(id: string, input: MedicationInput, today: string): Medication
  'medications.delete'(id: string): void
  /** The pill log (T15): `zone` is the phone's current IANA zone. */
  'pills.today'(zone: string): PillStatus[]
  'pills.log'(medicationId: string, zone: string): PillLog
  'pills.take'(input: { medicationId: string; takenAt: string | null; timeZone: string }): PillStatus
  'pills.miss'(input: { medicationId: string; localDate: string; timeZone: string }): PillStatus
  'pills.delete'(id: string): void
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
  'backup.setPlain',
  'cycle.setFlow',
  'cycle.setSymptoms',
  'medications.create',
  'medications.update',
  'medications.delete',
  'pills.take',
  'pills.miss',
  'pills.delete'
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
  'insights.libido',
  'backup.status',
  'backup.markDone',
  'backup.setReminder',
  'backup.setPlain',
  'cycle.day',
  'cycle.setFlow',
  'cycle.setSymptoms',
  'insights.cycle',
  'cycle.month',
  'reports.cycle',
  'medications.list',
  'medications.create',
  'medications.update',
  'medications.delete',
  'pills.today',
  'pills.log',
  'pills.take',
  'pills.miss',
  'pills.delete'
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
