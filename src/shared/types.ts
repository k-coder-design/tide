/** Types shared by the core (in the Worker) and the interface. Field names follow docs/DATA_MODEL.md. */

export type EventKind = 'sex' | 'masturbation' | 'dream' | 'fantasy'
export type Initiator = 'me' | 'partner' | 'mutual'
export type Protection = 'none' | 'condom' | 'other'
export type Theme = 'system' | 'light' | 'dark'

/** What the entry form sends. Fields that do not apply to the kind are ignored (stored as NULL). */
export interface EventInput {
  kind: EventKind
  /** Local date YYYY-MM-DD. */
  occurredOn: string
  /** Local time HH:MM, or null when not set. */
  occurredTime: string | null
  /** 1–10; sex and masturbation only. */
  satisfaction: number | null
  /** Sex and masturbation only. */
  orgasm: boolean | null
  note: string | null
  /** Sex only. */
  partnerId: string | null
  initiator: Initiator | null
  protection: Protection | null
}

export interface TideEvent extends EventInput {
  id: string
  partnerLabel: string | null
  createdAt: string
  updatedAt: string
}

export interface Partner {
  id: string
  label: string
  archived: boolean
}

/** One day of the journal: the check-in (if any) and the events, latest first. */
export interface JournalDay {
  date: string
  desire: number | null
  events: TideEvent[]
}

export type JournalFilter = 'all' | 'partnered' | 'other' | 'checkins'

export interface JournalPage {
  days: JournalDay[]
  /** Pass as `before` to get older days; null — no more. */
  nextBefore: string | null
}

/** A calendar cell: counts for the dots and the desire of the day. */
export interface MonthDay {
  date: string
  partnered: number
  other: number
  desire: number | null
}

export interface WeekDay {
  date: string
  desire: number | null
  partnered: number
  other: number
}

export interface WeekSummary {
  /** Seven days ending today, oldest first. */
  days: WeekDay[]
  partnered: number
  other: number
  desireAverage: number | null
}

export interface TodaySummary {
  desire: number | null
  week: WeekSummary
}

export interface Settings {
  theme: Theme
}

/** LOCKED — Tide is locked; WRONG_PIN — the PIN did not match; WAIT — too many wrong PINs, try later. */
export type ErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'STORAGE' | 'INTERNAL' | 'LOCKED' | 'WRONG_PIN' | 'WAIT' | 'MISSING'

export interface AppError {
  code: ErrorCode
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

/** The app lock as the interface sees it (T7, T21, T22). Minutes of auto-lock: 0 — when Tide leaves the screen. */
export interface LockStatus {
  enabled: boolean
  locked: boolean
  autoLock: 0 | 1 | 5 | 15
  /** When the next PIN try is allowed (ms since 1970), after too many wrong ones. */
  retryAt: number | null
}
