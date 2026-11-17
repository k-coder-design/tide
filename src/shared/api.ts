import type {
  EventInput,
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
  'settings.setTheme'
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
  'settings.setTheme'
])

export const isApiMethod = (value: unknown): value is ApiMethod => typeof value === 'string' && METHODS.has(value)
