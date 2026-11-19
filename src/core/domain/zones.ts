import { DomainError } from './errors'

/** Time-zone helpers for the pill log (T15): doses are absolute moments, shown in a zone's local time. */

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
    formatters.set(zone, f)
  }
  return f
}

/** An IANA zone name the runtime knows, like "Europe/Madrid". */
export function checkZone(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > 64) throw new DomainError('VALIDATION', 'Time zone is missing')
  try {
    formatter(value)
  } catch {
    throw new DomainError('VALIDATION', 'Time zone is not valid')
  }
  return value
}

/** The local date and time of an absolute moment in a zone. */
export function localParts(iso: string, zone: string): { date: string; time: string } {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export const minutesBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 60000)

export const addMinutes = (iso: string, minutes: number): string => new Date(Date.parse(iso) + minutes * 60000).toISOString()
