import type { EventInput, EventKind, Initiator, Protection, TideEvent } from '../../shared/types'
import type { Context } from './context'
import { DomainError } from './errors'
import { checkDate, checkId, checkNote, checkOneOf, checkRating, checkTime, SATISFACTION_MAX } from './validation'

const KINDS: readonly EventKind[] = ['sex', 'masturbation', 'dream', 'fantasy']
const INITIATORS: readonly Initiator[] = ['me', 'partner', 'mutual']
const PROTECTIONS: readonly Protection[] = ['none', 'condom', 'other']

/** Satisfaction and orgasm apply to sex and masturbation (T5); partner details — to sex only. */
export const hasSatisfaction = (kind: EventKind): boolean => kind === 'sex' || kind === 'masturbation'
export const isPartnered = (kind: EventKind): boolean => kind === 'sex'

export interface EventRow {
  id: string
  kind: EventKind
  occurred_on: string
  occurred_time: string | null
  satisfaction: number | null
  orgasm: number | null
  note: string | null
  created_at: string
  updated_at: string
  partner_id: string | null
  partner_label: string | null
  initiator: Initiator | null
  protection: Protection | null
}

/** Events with their partnered details; a WHERE clause and ORDER BY are appended by callers. */
export const EVENT_SELECT = `
  SELECT e.id, e.kind, e.occurred_on, e.occurred_time, e.satisfaction, e.orgasm, e.note, e.created_at, e.updated_at,
         d.partner_id, p.label AS partner_label, d.initiator, d.protection
  FROM events e
  LEFT JOIN sex_details d ON d.event_id = e.id
  LEFT JOIN partners p ON p.id = d.partner_id`

/** Latest first within a day; events without a time go after the timed ones, newest entry first. */
export const EVENT_ORDER = 'ORDER BY e.occurred_on DESC, e.occurred_time IS NULL, e.occurred_time DESC, e.created_at DESC'

export function toEvent(row: EventRow): TideEvent {
  return {
    id: row.id,
    kind: row.kind,
    occurredOn: row.occurred_on,
    occurredTime: row.occurred_time,
    satisfaction: row.satisfaction,
    orgasm: row.orgasm === null ? null : row.orgasm === 1,
    note: row.note,
    partnerId: row.partner_id,
    partnerLabel: row.partner_label,
    initiator: row.initiator,
    protection: row.protection,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class EventService {
  constructor(private readonly ctx: Context) {}

  get(id: string): TideEvent {
    const row = this.ctx.db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(checkId(id, 'Entry')) as EventRow | undefined
    if (!row) throw new DomainError('NOT_FOUND', 'This entry no longer exists')
    return toEvent(row)
  }

  create(input: EventInput): TideEvent {
    const clean = this.clean(input, null)
    const id = this.ctx.newId()
    const now = this.ctx.now()
    this.ctx.db.transaction(() => {
      this.ctx.db
        .prepare(
          `INSERT INTO events (id, kind, occurred_on, occurred_time, satisfaction, orgasm, note, created_at, updated_at)
           VALUES (@id, @kind, @occurredOn, @occurredTime, @satisfaction, @orgasm, @note, @now, @now)`
        )
        .run({ ...this.columns(clean), id, now })
      this.writeDetails(id, clean)
    })()
    return this.get(id)
  }

  update(id: string, input: EventInput): TideEvent {
    const existing = this.get(id)
    const clean = this.clean(input, existing)
    this.ctx.db.transaction(() => {
      this.ctx.db
        .prepare(
          `UPDATE events SET kind = @kind, occurred_on = @occurredOn, occurred_time = @occurredTime,
             satisfaction = @satisfaction, orgasm = @orgasm, note = @note, updated_at = @now
           WHERE id = @id`
        )
        .run({ ...this.columns(clean), id: existing.id, now: this.ctx.now() })
      this.writeDetails(existing.id, clean)
    })()
    return this.get(existing.id)
  }

  delete(id: string): void {
    const existing = this.get(id)
    this.ctx.db.prepare('DELETE FROM events WHERE id = ?').run(existing.id)
  }

  /** Validates the form and drops fields that do not apply to the kind. */
  private clean(input: EventInput, existing: TideEvent | null): EventInput {
    if (typeof input !== 'object' || input === null) throw new DomainError('VALIDATION', 'Entry is missing')
    const kind = checkOneOf(input.kind, KINDS, 'Kind')
    if (!kind) throw new DomainError('VALIDATION', 'Choose what to log')
    const rated = hasSatisfaction(kind)
    const partnered = isPartnered(kind)
    if (input.orgasm !== null && input.orgasm !== undefined && typeof input.orgasm !== 'boolean') {
      throw new DomainError('VALIDATION', 'Orgasm must be yes or no')
    }
    const partnerId = partnered && input.partnerId ? this.checkPartner(input.partnerId, existing) : null
    return {
      kind,
      occurredOn: checkDate(input.occurredOn),
      occurredTime: checkTime(input.occurredTime),
      satisfaction: rated ? checkRating(input.satisfaction, 'Satisfaction', SATISFACTION_MAX) : null,
      orgasm: rated ? (input.orgasm ?? null) : null,
      note: checkNote(input.note),
      partnerId,
      initiator: partnered ? checkOneOf(input.initiator, INITIATORS, 'Initiator') : null,
      protection: partnered ? checkOneOf(input.protection, PROTECTIONS, 'Protection') : null
    }
  }

  /** An archived label can stay on an entry that already has it, but is not offered for new ones. */
  private checkPartner(partnerId: string, existing: TideEvent | null): string {
    const row = this.ctx.db.prepare('SELECT archived FROM partners WHERE id = ?').get(partnerId) as { archived: number } | undefined
    if (!row) throw new DomainError('VALIDATION', 'This partner label no longer exists')
    if (row.archived === 1 && existing?.partnerId !== partnerId) {
      throw new DomainError('VALIDATION', 'This partner label is archived')
    }
    return partnerId
  }

  private columns(clean: EventInput): Record<string, unknown> {
    return {
      kind: clean.kind,
      occurredOn: clean.occurredOn,
      occurredTime: clean.occurredTime,
      satisfaction: clean.satisfaction,
      orgasm: clean.orgasm === null ? null : clean.orgasm ? 1 : 0,
      note: clean.note
    }
  }

  /** sex_details exists only for sex, and only when at least one detail is set. */
  private writeDetails(id: string, clean: EventInput): void {
    this.ctx.db.prepare('DELETE FROM sex_details WHERE event_id = ?').run(id)
    if (!isPartnered(clean.kind)) return
    if (clean.partnerId === null && clean.initiator === null && clean.protection === null) return
    this.ctx.db
      .prepare('INSERT INTO sex_details (event_id, partner_id, initiator, protection) VALUES (?, ?, ?, ?)')
      .run(id, clean.partnerId, clean.initiator, clean.protection)
  }
}
