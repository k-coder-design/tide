import type { EventKind } from '../shared/types'

/** T35: Today first, then Cycle and Libido, each with its own calendar. */
export type Tab = 'today' | 'cycle' | 'libido' | 'journal' | 'settings'

/** Screens and sheets opened over the tabs. */
export type Overlay =
  | { type: 'form'; kind: EventKind; date: string }
  | { type: 'edit'; id: string }
  | { type: 'detail'; id: string }
  | { type: 'desire'; date: string }
  | { type: 'pills'; medicationId: string }
  /** null — a new medication. */
  | { type: 'medication'; id: string | null }

export type Navigate = (overlay: Overlay) => void
