import type { Flow, LoggedFlow, Regimen, SymptomTag } from '../../shared/types'

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
