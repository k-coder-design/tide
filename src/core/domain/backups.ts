import type { BackupStatus, MergeResult } from '../../shared/types'
import type { Db } from '../db/types'
import type { BackupKey } from '../storage/backup'
import type { Context } from './context'
import { DomainError } from './errors'

/** A reminder shows once the last backup is this old (T14). */
export const BACKUP_REMINDER_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const KEY = {
  salt: 'backup.salt',
  iterations: 'backup.iterations',
  raw: 'backup.key',
  lastAt: 'backup.last_at',
  reminder: 'backup.reminder'
} as const

/**
 * Backups in the journal (phase 4, T14, T26): the backup password's key, when the last backup was saved,
 * the weekly reminder, and merging a backup into the journal. The encryption itself is in storage/backup.ts.
 */
export class BackupService {
  constructor(private readonly ctx: Context) {}

  status(): BackupStatus {
    const lastBackupAt = this.read(KEY.lastAt)
    const reminder = this.read(KEY.reminder) !== 'off'
    const old = lastBackupAt === null || Date.parse(this.ctx.now()) - Date.parse(lastBackupAt) >= BACKUP_REMINDER_DAYS * DAY_MS
    return { passwordSet: this.key() !== null, lastBackupAt, reminder, due: reminder && old && this.hasEntries() }
  }

  key(): BackupKey | null {
    const salt = this.read(KEY.salt)
    const raw = this.read(KEY.raw)
    const iterations = Number(this.read(KEY.iterations))
    if (!salt || !raw || !Number.isSafeInteger(iterations) || iterations <= 0) return null
    return { salt: fromBase64(salt), raw: fromBase64(raw), iterations }
  }

  setKey(key: BackupKey): void {
    this.ctx.db.transaction(() => {
      this.write(KEY.salt, toBase64(key.salt))
      this.write(KEY.raw, toBase64(key.raw))
      this.write(KEY.iterations, String(key.iterations))
    })()
  }

  /** After the file was saved or shared — not when it was only prepared. */
  markDone(): BackupStatus {
    this.write(KEY.lastAt, this.ctx.now())
    return this.status()
  }

  setReminder(on: boolean): BackupStatus {
    if (typeof on !== 'boolean') throw new DomainError('VALIDATION', 'Reminder must be on or off')
    this.write(KEY.reminder, on ? 'on' : 'off')
    return this.status()
  }

  /**
   * After a restore a backup clearly exists: this phone's last-backup time and reminder choice are kept,
   * and a phone that never made a backup starts its week now, so the reminder does not nag right after a restore.
   */
  adoptLocalState(local: BackupStatus): void {
    this.ctx.db.transaction(() => {
      this.write(KEY.lastAt, local.lastBackupAt ?? this.ctx.now())
      this.write(KEY.reminder, local.reminder ? 'on' : 'off')
    })()
  }

  /** Counts what a backup holds, shown after a restore. */
  static contents(db: Db): { entries: number; days: number } {
    return {
      entries: db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
      days: db.prepare('SELECT COUNT(*) FROM daily_checkins').pluck().get() as number
    }
  }

  /**
   * Merge (docs/DATA_MODEL.md, "Merging backups"): rows are matched by id (date for check-ins); a missing row is added,
   * an existing one is replaced only when the backup's copy was changed later. Deletions are not carried over;
   * settings, the backup password and the reminder stay as they are on this phone.
   */
  merge(source: Db): MergeResult {
    const db = this.ctx.db
    let added = 0
    let updated = 0
    const count = (state: 'added' | 'updated' | 'same') => {
      if (state === 'added') added++
      if (state === 'updated') updated++
    }
    db.transaction(() => {
      for (const row of source.prepare('SELECT * FROM partners').all() as Array<Record<string, unknown> & { id: string; updated_at: string }>) {
        count(this.upsert('partners', 'id', row))
      }
      for (const row of source.prepare('SELECT * FROM events').all() as Array<Record<string, unknown> & { id: string; updated_at: string }>) {
        const state = this.upsert('events', 'id', row)
        count(state)
        if (state === 'same') continue
        db.prepare('DELETE FROM sex_details WHERE event_id = ?').run(row.id)
        const details = source.prepare('SELECT * FROM sex_details WHERE event_id = ?').get(row.id) as Record<string, unknown> | undefined
        if (details) insert(db, 'sex_details', details)
      }
      for (const row of source.prepare('SELECT * FROM daily_checkins').all() as Array<Record<string, unknown> & { date: string; updated_at: string }>) {
        count(this.upsert('daily_checkins', 'date', row))
      }
    })()
    return { added, updated, ...BackupService.contents(source) }
  }

  private upsert(table: string, keyColumn: string, row: Record<string, unknown> & { updated_at: string }): 'added' | 'updated' | 'same' {
    const db = this.ctx.db
    const current = db.prepare(`SELECT updated_at FROM ${table} WHERE ${keyColumn} = ?`).pluck().get(row[keyColumn]) as string | undefined
    if (current === undefined) {
      insert(db, table, row)
      return 'added'
    }
    if (row.updated_at <= current) return 'same'
    const columns = columnsOf(db, table, row).filter((c) => c !== keyColumn)
    db.prepare(`UPDATE ${table} SET ${columns.map((c) => `${c} = @${c}`).join(', ')} WHERE ${keyColumn} = @${keyColumn}`).run(row)
    return 'updated'
  }

  private hasEntries(): boolean {
    return Boolean(this.ctx.db.prepare('SELECT EXISTS (SELECT 1 FROM events) OR EXISTS (SELECT 1 FROM daily_checkins)').pluck().get())
  }

  private read(key: string): string | null {
    return (this.ctx.db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key) as string | undefined) ?? null
  }

  private write(key: string, value: string): void {
    this.ctx.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }
}

/** Only this journal's own columns are written, whatever the backup file holds. */
function columnsOf(db: Db, table: string, row: Record<string, unknown>): string[] {
  const known = new Set((db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name))
  return Object.keys(row).filter((c) => known.has(c))
}

function insert(db: Db, table: string, row: Record<string, unknown>): void {
  const columns = columnsOf(db, table, row)
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`).run(row)
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}
