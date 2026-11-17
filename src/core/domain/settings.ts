import type { Settings, Theme } from '../../shared/types'
import type { Context } from './context'
import { checkOneOf } from './validation'

const THEMES: readonly Theme[] = ['system', 'light', 'dark']

/** App settings, key — value. */
export class SettingsService {
  constructor(private readonly ctx: Context) {}

  get(): Settings {
    const theme = this.ctx.db.prepare("SELECT value FROM settings WHERE key = 'theme'").pluck().get() as string | undefined
    return { theme: (THEMES as readonly string[]).includes(theme ?? '') ? (theme as Theme) : 'system' }
  }

  setTheme(theme: Theme): Settings {
    const value = checkOneOf(theme, THEMES, 'Appearance') ?? 'system'
    this.ctx.db
      .prepare("INSERT INTO settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(value)
    return this.get()
  }
}
