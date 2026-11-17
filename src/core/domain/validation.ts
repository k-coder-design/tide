import { DomainError } from './errors'

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

export const NOTE_MAX = 2000
export const LABEL_MAX = 24

const invalid = (message: string): never => {
  throw new DomainError('VALIDATION', message)
}

/** A real calendar date in the form YYYY-MM-DD. */
export function checkDate(value: unknown, what = 'Date'): string {
  if (typeof value !== 'string') return invalid(`${what} is missing`)
  const match = DATE.exec(value)
  if (!match) return invalid(`${what} must look like 2026-11-17`)
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return invalid(`${what} does not exist`)
  }
  return value
}

export function checkMonth(value: unknown): string {
  if (typeof value !== 'string' || !MONTH.test(value)) return invalid('Month must look like 2026-11')
  return value
}

export function checkTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !TIME.test(value)) return invalid('Time must look like 23:10')
  return value
}

/** A whole number from 1 to 10, or null. */
export function checkRating(value: unknown, what: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
    return invalid(`${what} must be a whole number from 1 to 10`)
  }
  return value
}

export function checkNote(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return invalid('Note must be text')
  const text = value.trim()
  if (text.length > NOTE_MAX) return invalid(`Note is longer than ${NOTE_MAX} characters`)
  return text === '' ? null : text
}

export function checkLabel(value: unknown): string {
  if (typeof value !== 'string') return invalid('Label is missing')
  const label = value.trim().replace(/\s+/g, ' ')
  if (label === '') return invalid('Label is empty')
  if ([...label].length > LABEL_MAX) return invalid(`Label is longer than ${LABEL_MAX} characters`)
  return label
}

export function checkOneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) return invalid(`${what} is not valid`)
  return value as T
}

export function checkId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') return invalid(`${what} is missing`)
  return value
}
