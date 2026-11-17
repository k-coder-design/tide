import type { Db } from '../db/types'

/** What every domain service needs: the database, the clock and new ids (replaceable in tests). */
export interface Context {
  db: Db
  /** Current moment, ISO 8601 UTC. */
  now(): string
  newId(): string
}

export function createContext(db: Db): Context {
  return { db, now: () => new Date().toISOString(), newId: () => crypto.randomUUID() }
}

/** Calendar arithmetic on local dates YYYY-MM-DD (no time zones involved). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return moved.toISOString().slice(0, 10)
}
