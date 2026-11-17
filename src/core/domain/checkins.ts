import type { Context } from './context'
import { checkDate, checkRating, DESIRE_MAX } from './validation'

/**
 * The daily check-in (T4): at most one row per day; desire is rated 1–5. Phase 2 records desire; flow and symptoms
 * join it in phase 6. A row with nothing left in it is removed.
 */
export class CheckinService {
  constructor(private readonly ctx: Context) {}

  desire(date: string): number | null {
    const value = this.ctx.db.prepare('SELECT desire FROM daily_checkins WHERE date = ?').pluck().get(checkDate(date))
    return (value as number | null | undefined) ?? null
  }

  setDesire(date: string, desire: number | null): void {
    const day = checkDate(date)
    const value = checkRating(desire, 'Desire', DESIRE_MAX)
    this.ctx.db.transaction(() => {
      this.ctx.db
        .prepare(
          `INSERT INTO daily_checkins (date, desire, updated_at) VALUES (@day, @value, @now)
           ON CONFLICT(date) DO UPDATE SET desire = excluded.desire, updated_at = excluded.updated_at`
        )
        .run({ day, value, now: this.ctx.now() })
      this.ctx.db
        .prepare('DELETE FROM daily_checkins WHERE date = ? AND desire IS NULL AND flow IS NULL AND note IS NULL')
        .run(day)
    })()
  }
}
