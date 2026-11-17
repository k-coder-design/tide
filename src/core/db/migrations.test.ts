import { describe, expect, it } from 'vitest'
import { loadSqlite } from '../testing'
import { MIGRATION_SQL, migrate, SCHEMA_VERSION } from './migrations'
import { openMemoryDatabase, wrapWasmDatabase } from './wasm'

describe('migrations', () => {
  it('desire 1–10 becomes 1–5, rounding up; other days are kept as they were', async () => {
    const sqlite3 = await loadSqlite()
    const db = wrapWasmDatabase(sqlite3, new sqlite3.oo1.DB(':memory:'))
    db.exec(MIGRATION_SQL[0]!)
    db.pragma('user_version = 1')
    const insert = db.prepare('INSERT INTO daily_checkins (date, desire, updated_at) VALUES (?, ?, ?)')
    ;[1, 2, 3, 6, 9, 10].forEach((desire, i) => insert.run(`2026-11-0${i + 1}`, desire, 'then'))
    db.prepare("INSERT INTO daily_checkins (date, desire, flow, updated_at) VALUES ('2026-11-07', NULL, 'light', 'then')").run()

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(db.prepare('SELECT desire FROM daily_checkins ORDER BY date').pluck().all()).toEqual([1, 1, 2, 3, 5, 5, null])
    expect(db.prepare("SELECT flow FROM daily_checkins WHERE date = '2026-11-07'").pluck().get()).toBe('light')
    expect(() => db.prepare("INSERT INTO daily_checkins (date, desire, updated_at) VALUES ('2026-11-08', 6, 'now')").run()).toThrow(/CHECK/)
  })
  it('a saved version 1 image opens, migrates and can be saved again', async () => {
    const sqlite3 = await loadSqlite()
    const raw = new sqlite3.oo1.DB(':memory:')
    const old = wrapWasmDatabase(sqlite3, raw)
    old.exec(MIGRATION_SQL[0]!)
    old.pragma('user_version = 1')
    old.prepare("INSERT INTO daily_checkins (date, desire, updated_at) VALUES ('2026-11-17', 8, 'then')").run()
    const image = sqlite3.capi.sqlite3_js_db_export(raw)

    const memory = openMemoryDatabase(sqlite3, image)
    expect(memory.db.prepare('SELECT desire FROM daily_checkins').pluck().get()).toBe(4)
    const saved = memory.serialize()
    const again = openMemoryDatabase(sqlite3, saved)
    expect(again.db.prepare('SELECT desire FROM daily_checkins').pluck().get()).toBe(4)
  })
})
