import type { EventKind } from '../shared/types'

export type Tab = 'today' | 'journal' | 'insights' | 'settings'

/** Screens and sheets opened over the tabs. */
export type Overlay =
  | { type: 'form'; kind: EventKind; date: string }
  | { type: 'edit'; id: string }
  | { type: 'detail'; id: string }
  | { type: 'desire'; date: string }

export type Navigate = (overlay: Overlay) => void
