import type { Flow, LoggedFlow, MenstrualCycle, Regimen, SymptomTag } from '../../shared/types'

/** Labels for the cycle section (phase 6). Which flow counts as bleeding is decided in the core (T18). */
export const FLOW_OPTIONS: ReadonlyArray<{ value: LoggedFlow; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'spotting', label: 'Spotting' },
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'heavy', label: 'Heavy' }
]

export const flowLabel = (flow: Flow): string => (flow === 'unspecified' ? 'Bleeding' : (FLOW_OPTIONS.find((f) => f.value === flow)?.label ?? flow))

export const SYMPTOM_OPTIONS: ReadonlyArray<{ value: SymptomTag; label: string }> = [
  { value: 'cramps', label: 'Cramps' },
  { value: 'headache', label: 'Headache' },
  { value: 'bloating', label: 'Bloating' },
  { value: 'breast_tenderness', label: 'Breast tenderness' },
  { value: 'acne', label: 'Acne' },
  { value: 'low_mood', label: 'Low mood' },
  { value: 'irritability', label: 'Irritability' },
  { value: 'fatigue', label: 'Fatigue' }
]

export const REGIMENS: ReadonlyArray<{ value: Regimen; label: string }> = [
  { value: 'continuous', label: 'Continuous' },
  { value: '21/7', label: '21/7' },
  { value: '24/4', label: '24/4' },
  { value: 'other', label: 'Other' }
]

/** The phone's current IANA zone, sent with every pill call (T15). */
export const phoneZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** "Europe/Madrid" → "Madrid". */
export const zoneCity = (zone: string): string => (zone.split('/').pop() ?? zone).replace(/_/g, ' ')

/** 1690 → "28 h 10 min"; 45 → "45 min". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return `${h} h ${String(m).padStart(2, '0')} min`
}

/** Hours without trailing zeros: 24 → "24 h", 1.5 → "1.5 h". */
export const hours = (value: number): string => `${Number(value.toFixed(2))} h`

/** "21 Oct – 17 Nov", "4 – 30 Sep", "18 Nov – now". */
export function cycleDates(c: MenstrualCycle): string {
  const fmt = (date: string, o: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' })
  const short = (d: string) => fmt(d, { day: 'numeric', month: 'short' })
  if (c.end === null) return `${short(c.start)} – now`
  const sameMonth = c.start.slice(0, 7) === c.end.slice(0, 7)
  // Cycles from earlier years carry the year, so a long history stays readable.
  const year = c.end.slice(0, 4) === String(new Date().getFullYear()) ? '' : ` ${c.end.slice(0, 4)}`
  return `${sameMonth ? fmt(c.start, { day: 'numeric' }) : short(c.start)} – ${short(c.end)}${year}`
}

/** "heavy · +2 spotting · Health · current". */
export function cycleNote(c: MenstrualCycle): string {
  return [flowLabel(c.strongest).toLowerCase(), c.spottingDays ? `+${c.spottingDays} spotting` : null, c.fromHealth ? 'Health' : null, c.end === null ? 'current' : null]
    .filter(Boolean)
    .join(' · ')
}
