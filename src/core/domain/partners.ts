import type { Partner } from '../../shared/types'
import type { Context } from './context'
import { DomainError } from './errors'
import { checkId, checkLabel } from './validation'

interface PartnerRow {
  id: string
  label: string
  archived: number
}

const toPartner = (row: PartnerRow): Partner => ({ id: row.id, label: row.label, archived: row.archived === 1 })

/**
 * Partner labels (T5): any nickname or initial. A label is never deleted — it stays in the history
 * of past events; archiving hides it from the entry form.
 */
export class PartnerService {
  constructor(private readonly ctx: Context) {}

  list(includeArchived: boolean): Partner[] {
    const rows = this.ctx.db
      .prepare(
        `SELECT id, label, archived FROM partners
         WHERE @all = 1 OR archived = 0
         ORDER BY archived, label COLLATE NOCASE`
      )
      .all({ all: includeArchived ? 1 : 0 }) as PartnerRow[]
    return rows.map(toPartner)
  }

  get(id: string): Partner {
    const row = this.ctx.db.prepare('SELECT id, label, archived FROM partners WHERE id = ?').get(checkId(id, 'Partner')) as
      | PartnerRow
      | undefined
    if (!row) throw new DomainError('NOT_FOUND', 'This partner label no longer exists')
    return toPartner(row)
  }

  create(label: string): Partner {
    const clean = checkLabel(label)
    this.ensureUnique(clean, null)
    const id = this.ctx.newId()
    const now = this.ctx.now()
    this.ctx.db
      .prepare('INSERT INTO partners (id, label, archived, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
      .run(id, clean, now, now)
    return this.get(id)
  }

  rename(id: string, label: string): Partner {
    const partner = this.get(id)
    const clean = checkLabel(label)
    this.ensureUnique(clean, partner.id)
    this.ctx.db.prepare('UPDATE partners SET label = ?, updated_at = ? WHERE id = ?').run(clean, this.ctx.now(), partner.id)
    return this.get(partner.id)
  }

  setArchived(id: string, archived: boolean): Partner {
    const partner = this.get(id)
    this.ctx.db
      .prepare('UPDATE partners SET archived = ?, updated_at = ? WHERE id = ?')
      .run(archived ? 1 : 0, this.ctx.now(), partner.id)
    return this.get(partner.id)
  }

  private ensureUnique(label: string, exceptId: string | null): void {
    const clash = this.ctx.db
      .prepare('SELECT id FROM partners WHERE label = ? COLLATE NOCASE AND id IS NOT ?')
      .pluck()
      .get(label, exceptId)
    if (clash) throw new DomainError('VALIDATION', `There is already a label "${label}"`)
  }
}
