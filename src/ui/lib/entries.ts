import type { EventKind, Initiator, Protection, TideEvent } from '../../shared/types'
import type { IconName } from '../components/Icon'

/** How each kind of entry looks: name, icon and stream (partnered — terracotta, other — teal). */
export const KINDS: ReadonlyArray<{ kind: EventKind; label: string; icon: IconName; partnered: boolean }> = [
  { kind: 'sex', label: 'Sex', icon: 'sex', partnered: true },
  { kind: 'masturbation', label: 'Solo', icon: 'masturbation', partnered: false },
  { kind: 'dream', label: 'Dream', icon: 'dream', partnered: false },
  { kind: 'fantasy', label: 'Fantasy', icon: 'fantasy', partnered: false }
]

export const kindInfo = (kind: EventKind) => KINDS.find((k) => k.kind === kind) ?? KINDS[0]!

export const INITIATORS: ReadonlyArray<{ value: Initiator; label: string }> = [
  { value: 'me', label: 'Me' },
  { value: 'partner', label: 'Partner' },
  { value: 'mutual', label: 'Mutual' }
]

export const PROTECTIONS: ReadonlyArray<{ value: Protection; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'condom', label: 'Condom' },
  { value: 'other', label: 'Other' }
]

export const labelOf = <T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T | null) =>
  options.find((o) => o.value === value)?.label ?? null

/** The second line of an entry in lists: the details that were filled in. */
export function entrySummary(event: TideEvent): string {
  const parts: string[] = []
  if (event.partnerLabel) parts.push(`With ${event.partnerLabel}`)
  if (event.satisfaction !== null) parts.push(`satisfaction ${event.satisfaction}`)
  if (event.orgasm === true) parts.push('orgasm')
  if (event.orgasm === false) parts.push('no orgasm')
  if (event.note) parts.push(event.note.split('\n')[0] ?? '')
  const text = parts.join(' · ')
  return text === '' ? 'No details' : text.charAt(0).toUpperCase() + text.slice(1)
}
