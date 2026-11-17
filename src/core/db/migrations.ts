import type { Db } from './types'

/**
 * Schema migrations (docs/DATA_MODEL.md); the current number is stored in PRAGMA user_version.
 * Only append new items to the end of the array; never change applied migrations.
 */
const MIGRATIONS: string[] = [
  // Phase 2 — the journal: events, partnered details, partner labels, daily check-ins, settings.
  // daily_checkins already has the flow columns (filled in phase 4 by the Health import, phase 6 by the check-in).
  `
  CREATE TABLE partners (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    emoji TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('sex', 'masturbation', 'dream', 'fantasy')),
    occurred_on TEXT NOT NULL,
    occurred_time TEXT,
    satisfaction INTEGER CHECK (satisfaction BETWEEN 1 AND 10),
    orgasm INTEGER CHECK (orgasm IN (0, 1)),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX events_day ON events(occurred_on, occurred_time);

  CREATE TABLE sex_details (
    event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    partner_id TEXT REFERENCES partners(id),
    initiator TEXT CHECK (initiator IN ('me', 'partner', 'mutual')),
    protection TEXT CHECK (protection IN ('none', 'condom', 'other'))
  );

  CREATE TABLE daily_checkins (
    date TEXT PRIMARY KEY,
    desire INTEGER CHECK (desire BETWEEN 1 AND 10),
    flow TEXT CHECK (flow IN ('none', 'spotting', 'light', 'medium', 'heavy', 'unspecified')),
    flow_source TEXT CHECK (flow_source IN ('tide', 'health')),
    note TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // T4 revised: desire is rated 1–5 instead of 1–10. Earlier ratings are halved, rounding up
  // (1–2 → 1, 3–4 → 2, … 9–10 → 5). SQLite cannot change a CHECK, so the table is rebuilt.
  `
  CREATE TABLE daily_checkins_v2 (
    date TEXT PRIMARY KEY,
    desire INTEGER CHECK (desire BETWEEN 1 AND 5),
    flow TEXT CHECK (flow IN ('none', 'spotting', 'light', 'medium', 'heavy', 'unspecified')),
    flow_source TEXT CHECK (flow_source IN ('tide', 'health')),
    note TEXT,
    updated_at TEXT NOT NULL
  );
  INSERT INTO daily_checkins_v2 (date, desire, flow, flow_source, note, updated_at)
    SELECT date, CASE WHEN desire IS NULL THEN NULL ELSE (desire + 1) / 2 END, flow, flow_source, note, updated_at
    FROM daily_checkins;
  DROP TABLE daily_checkins;
  ALTER TABLE daily_checkins_v2 RENAME TO daily_checkins;
  `
]

/** For the migration tests only. */
export const MIGRATION_SQL: readonly string[] = MIGRATIONS

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version]
    if (sql === undefined) break
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length
