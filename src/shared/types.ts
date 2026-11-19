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
  /** Sex only: contraceptive courses covering the date (T6) — computed from medications, never stored per event. */
  contraception: string[]
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

/** Insights (phase 5): the range shown — 12 weeks by week, 6 months or a year by month. */
export type InsightsPeriod = '12w' | '6m' | '1y'

/** One bar: a 7-day stretch or a calendar month. */
export interface InsightsBucket {
  /** First and last day, inclusive; the last bucket ends today. */
  from: string
  to: string
  partnered: number
  other: number
  /** Average of the rated days; null — none rated. */
  desire: number | null
  /** Any day with bleeding (light, medium, heavy or unspecified flow) — shaded on the desire chart. */
  bleeding: boolean
}

/** A day of the heat map. */
export interface InsightsDay {
  date: string
  entries: number
  partnered: number
}

/** Counts for one side of the comparison. */
export interface InsightsSpan {
  from: string
  to: string
  partnered: number
  other: number
  desire: number | null
  bleedingDays: number
}

export interface LibidoInsights {
  period: InsightsPeriod
  unit: 'week' | 'month'
  buckets: InsightsBucket[]
  /** Entries per week over the whole range. */
  perWeek: { partnered: number; other: number }
  days: InsightsDay[]
  /** The last 28 days against the 28 before. */
  compare: { current: InsightsSpan; previous: InsightsSpan }
  /** Any flow recorded (from Tide or the Health import) — the bleeding row and shading show only then. */
  hasFlow: boolean
  /** Anything logged at all. */
  hasData: boolean
}

export interface TodaySummary {
  desire: number | null
  week: WeekSummary
}

export interface Settings {
  theme: Theme
}

/** Backups as the interface sees them (phase 4, T14, T26). */
export interface BackupStatus {
  passwordSet: boolean
  /** The user chose backups without a password (T28): the file is not encrypted. */
  plain: boolean
  /** ISO moment of the last backup that was saved or shared; null — never. */
  lastBackupAt: string | null
  reminder: boolean
  /** The weekly reminder is due: on, a week or more since the last backup (or none yet), and the journal has entries. */
  due: boolean
}

/** What a backup held, and for a merge what it changed here. */
export interface MergeResult {
  entries: number
  days: number
  added: number
  updated: number
}

export type RestoreMode = 'replace' | 'merge'

/** What the Apple Health import added, and what was already in Tide and kept (T27). */
export interface HealthImportResult {
  bleedingDays: number
  spottingDays: number
  /** Days that already had a flow in Tide — never overwritten. */
  keptDays: number
  courses: number
  keptCourses: number
}

/** Daily flow (T13, T18): `unspecified` comes only from the Health import; NULL — not recorded, unlike `none`. */
export type Flow = 'none' | 'spotting' | 'light' | 'medium' | 'heavy' | 'unspecified'
/** What the check-in offers. */
export type LoggedFlow = Exclude<Flow, 'unspecified'>
export type SymptomTag = 'cramps' | 'headache' | 'bloating' | 'breast_tenderness' | 'acne' | 'low_mood' | 'irritability' | 'fatigue'

/** The cycle part of a day's check-in. */
export interface CycleDay {
  date: string
  flow: Flow | null
  flowSource: 'tide' | 'health' | null
  symptoms: SymptomTag[]
  /** 1 on the first bleeding day of the latest episode on or before this date; null — no episode yet. */
  cycleDay: number | null
  /** This day is the first bleeding day of an episode. */
  startsCycle: boolean
}

/** Consecutive bleeding days; gaps of up to 2 days do not break it, spotting never starts one (T18). */
export interface BleedingEpisode {
  start: string
  /** Last bleeding day, also while ongoing. */
  last: string
  /** The last bleeding day was within 2 days of today, so the episode may go on. */
  ongoing: boolean
  /** From the first to the last bleeding day, inclusive. */
  days: number
  strongest: Flow
  /** Spotting within 2 days before, inside, or within 2 days after. */
  spottingDays: number
  /** Days from this start to the next episode's start; null for the latest. */
  cycle: number | null
  /** Any of its days came from the Health import. */
  fromHealth: boolean
}

export type Regimen = 'continuous' | '21/7' | '24/4' | 'other'

/** A medication course (phase 6). With `intervalHours` it gets a pill card on Today and a dose log. */
export interface MedicationInput {
  name: string
  isContraceptive: boolean
  regimen: Regimen | null
  startedOn: string
  endedOn: string | null
  intervalHours: number | null
  /** Allowed delay from the leaflet, set by the user; Tide gives no medical advice. */
  delayWindowHours: number | null
  /** Approximate usual local time for days without a dose log (imported history); both null — time unknown. */
  usualTimeFrom: string | null
  usualTimeTo: string | null
  note: string | null
}

export interface Medication extends MedicationInput {
  id: string
  source: 'tide' | 'health'
  /** The course covers today. */
  active: boolean
  /** Has an interval, so doses are logged. */
  tracked: boolean
}

/** One logged dose (T15): an absolute moment plus the phone's zone at the time. */
export interface PillDose {
  id: string
  medicationId: string
  status: 'taken' | 'missed'
  takenAt: string | null
  timeZone: string
  localDate: string
  /** HH:MM in the zone it was taken in; null for a missed dose. */
  localTime: string | null
  /** Real time since the previous taken dose; null for the first one and for missed doses. */
  intervalMinutes: number | null
  /** Minutes past interval + allowed delay; null — on time. */
  lateMinutes: number | null
  /** The previous dose was taken in another zone: its local time there. */
  previousElsewhere: { localTime: string; timeZone: string } | null
}

/** A tracked medication right now, for the pill card on Today and the top of the pill log. */
export interface PillStatus {
  medication: Medication
  last: PillDose | null
  /** The last taken dose falls on today's date in the phone's current zone. */
  takenToday: boolean
  /** The next dose: due = last + interval, latest = due + allowed delay, in the phone's current zone. */
  next: { due: string; latest: string; dueLocal: string; latestLocal: string; dueDate: string; latestDate: string } | null
  minutesSinceLast: number | null
  /** Past the latest time. */
  overdue: boolean
  zone: string
}

export interface PillLog {
  status: PillStatus
  doses: PillDose[]
  /** Local date of the first dose logged in Tide; days of the course before it have no dose log. */
  firstLoggedOn: string | null
}

export interface PillSummary {
  medicationId: string
  name: string
  onTime: number
  late: number
  missed: number
}

/** A menstrual cycle (T35): from one episode's first bleeding day to the day before the next one's. */
export interface MenstrualCycle {
  start: string
  /** The day before the next cycle starts; null — the current cycle, still running. */
  end: string | null
  /** First to last bleeding day of its episode, inclusive. */
  bleedingDays: number
  /** The episode may go on (its last bleeding day was within 2 days of today). */
  bleedingOngoing: boolean
  /** Days from this start to the next one; for the current cycle, the days so far including today. */
  length: number
  strongest: Flow
  /** Spotting counted for its episode (T18). */
  spottingDays: number
  fromHealth: boolean
}

export interface CycleCalendarDay {
  date: string
  flow: Flow | null
  startsCycle: boolean
  /** Day of the current cycle, up to today; null outside it. */
  currentCycleDay: number | null
}

/** One month of the cycle calendar (T35); days after today have no flow. */
export interface CycleMonth {
  month: string
  days: CycleCalendarDay[]
  bleedingDays: number
  spottingDays: number
  /** First days of cycles in this month. */
  cycleStarts: string[]
}

export interface DesireByFlow {
  bleeding: number | null
  spotting: number | null
  other: number | null
}

/** The Cycle tab (T13, T35). Numbers only: no predictions, no advice. */
export interface CycleInsights {
  /** Newest first; the first one is the current cycle. */
  cycles: MenstrualCycle[]
  /** Over episodes that have ended. */
  averageBleeding: number | null
  /** Over finished cycles. */
  averageCycle: number | null
  cycleRange: { min: number; max: number } | null
  currentCycleDay: number | null
  /** The earliest month with recorded flow, for the calendar's back arrow; null — none. */
  firstMonth: string | null
  /** Average desire on bleeding days, spotting days and other rated days. */
  desireByFlow: DesireByFlow
  /** Pills over the last 30 days, per tracked medication. */
  pills: PillSummary[]
  hasFlow: boolean
}

export type ReportPeriod = 'last3' | 'last6' | 'year' | 'all'

/** Everything a cycle report (PDF, T35) can hold, for the chosen period. The phone draws it; nothing is sent. */
export interface CycleReport {
  madeOn: string
  from: string
  to: string
  /** Cycles that start in the period, newest first. */
  cycles: MenstrualCycle[]
  averageBleeding: number | null
  averageCycle: number | null
  cycleRange: { min: number; max: number } | null
  /** Oldest first, from the period's first month to this one. */
  months: CycleMonth[]
  /** Days each symptom was recorded in the period, most frequent first. */
  symptoms: Array<{ tag: SymptomTag; days: number }>
  pills: PillSummary[]
  desireByFlow: DesireByFlow
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
