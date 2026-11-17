# Tide — data model (draft for review)

Status: **approved, phase 0** (17.11.2026); cycle section added the same day (T11–T13). Nothing is implemented yet; the tables appear in phase 2 (core); the flow import in phase 4; `medications`, `pill_log` and `day_symptoms` in phase 6. The cycle parts are removed if the Health import fails (T11).

## What the app measures

Libido dynamics as three streams, plus the cycle:

| Stream | Source | Typical chart |
| --- | --- | --- |
| Partnered activity | `events` with `kind = 'sex'` | count per week / month |
| Other activity | `events` with `kind` in `masturbation`, `dream`, `fantasy` | count per week / month, split by kind |
| Desire | `daily_checkins.desire` (1–10, once a day) | line with a moving average |
| Bleeding | `daily_checkins.flow` | bleeding days per month, episodes, heat map |
| Pills | `pill_log` | taken / late / missed |

`fantasy` is an optional event for a notable sexual thought or fantasy; everyday background desire is the daily check-in, not events.

## Tables

### `events` — one row per sexual event

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | UUID v4 — stable across devices, so importing a backup can merge without duplicates |
| `kind` | TEXT NOT NULL | `sex` · `masturbation` · `dream` · `fantasy` |
| `occurred_on` | TEXT NOT NULL | local date `YYYY-MM-DD` — what charts group by |
| `occurred_time` | TEXT NULL | local time `HH:MM`; optional, quick logging skips it |
| `satisfaction` | INTEGER NULL | 1–10; for `sex` and `masturbation` |
| `orgasm` | INTEGER NULL | 1 yes · 0 no; for `sex` and `masturbation` |
| `note` | TEXT NULL | free text |
| `created_at` | TEXT NOT NULL | ISO timestamp |
| `updated_at` | TEXT NOT NULL | ISO timestamp — the newer row wins when merging backups |

### `sex_details` — extra fields for `kind = 'sex'` (one-to-one, all optional)

| Column | Type | Notes |
| --- | --- | --- |
| `event_id` | TEXT PK → `events.id` | ON DELETE CASCADE |
| `partner_id` | TEXT NULL → `partners.id` | |
| `initiator` | TEXT NULL | `me` · `partner` · `mutual` |
| `protection` | TEXT NULL | `none` · `condom` · `other` — barrier protection used this time |

Hormonal contraception is **not** stored per event: it comes from `medications`. When a contraceptive course (`medications.is_contraceptive = 1`) covers the event's date, the sex form and the event view show it automatically (for example "💊 Yaz"). It is computed at read time, so correcting a course's dates updates past events too.

### `partners` — labels, never real names required

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | UUID |
| `label` | TEXT NOT NULL | any nickname or initial |
| `emoji` | TEXT NULL | quick visual marker |
| `archived` | INTEGER NOT NULL DEFAULT 0 | hidden from the picker, kept in history |
| `created_at`, `updated_at` | TEXT NOT NULL | |

### `daily_checkins` — the day's check-in, at most one per day

Each part is optional: a day may have only desire, only flow, or both.

| Column | Type | Notes |
| --- | --- | --- |
| `date` | TEXT PK | local date `YYYY-MM-DD` |
| `desire` | INTEGER NULL | 1–10 |
| `flow` | TEXT NULL | `none` · `spotting` · `light` · `medium` · `heavy` · `unspecified` (only from the Health import); NULL — not recorded, which is different from `none` |
| `flow_source` | TEXT NULL | `tide` · `health` — where the flow came from |
| `note` | TEXT NULL | |
| `updated_at` | TEXT NOT NULL | |

**Bleeding episodes** are computed, not stored: consecutive days with flow `spotting` or heavier, where gaps of up to 2 days (`none` or not recorded) do not break the episode. An episode has a start, an end (none while it is ongoing), a length in days and its strongest flow; its **cycle** is the number of days from its start to the next episode's start (none for the latest). Imported and Tide-recorded days form episodes the same way.

**Health import (phase 4, T12)** fills `flow` with `flow_source = 'health'`. Format checked on a real export (17.11.2026): `export.xml` (hundreds of MB) holds day records `<Record type="…" startDate="YYYY-MM-DD 12:00:00 +HHMM" …>` — one per day, at local noon, so the date part of `startDate` is the local day.

| Health record | Value | Tide `flow` |
| --- | --- | --- |
| `HKCategoryTypeIdentifierMenstrualFlow` | `HKCategoryValueVaginalBleedingLight` / `Medium` / `Heavy` (older exports: `HKCategoryValueMenstrualFlow…`) | `light` / `medium` / `heavy` |
| same | `…Unspecified` | `unspecified` |
| same | `…None` | skipped |
| `HKCategoryTypeIdentifierIntermenstrualBleeding` | `HKCategoryValueNotApplicable` | `spotting` |

When a day has several records the stronger flow wins. A day already recorded in Tide is never overwritten; re-importing the same export changes nothing.

**Contraceptive courses** are imported too: each `HKCategoryTypeIdentifierContraceptive` record (`HKCategoryValueContraceptiveOral` and so on) becomes a `medications` row with `is_contraceptive = 1`, `source = 'health'`, `started_on` / `ended_on` from its dates (an end date in the year 4001 means "still taking" → NULL) and a placeholder name the user renames. Health keeps courses, **not individual doses**, so no `pill_log` rows are created for the past — that would claim every pill was taken. Instead the user sets the course's approximate usual time (`usual_time_from` / `usual_time_to`, for example 07:00–09:00); past days of the course show "usual time 07:00–09:00 · no dose log", or "time unknown" when it is not set, and are left out of interval and lateness analytics. The dose log starts on the first dose logged in Tide.

`HKCategoryTypeIdentifierSexualActivity` records are not imported.

### `day_symptoms` — symptom tags by day (phase 6)

| Column | Type | Notes |
| --- | --- | --- |
| `date` | TEXT NOT NULL | local date |
| `tag` | TEXT NOT NULL | from a fixed list in code: `cramps` · `headache` · `bloating` · `breast_tenderness` · `acne` · `low_mood` · `irritability` · `fatigue` |
| | | PRIMARY KEY (`date`, `tag`) |

### `pill_log` — one row per dose (phase 6)

Built for changing time zones (T15): what matters is the **real time between doses**, not the clock on the wall. A dose is stored as an absolute moment, so a flight never makes an interval look longer or shorter than it was.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | UUID — not (medication, date): after a flight two doses can fall on one local date, or none |
| `medication_id` | TEXT NOT NULL → `medications.id` | |
| `status` | TEXT NOT NULL | `taken` · `missed` |
| `taken_at` | TEXT NULL | absolute moment in UTC, ISO 8601 (`2026-11-17T20:05:00Z`); NULL for `missed` |
| `time_zone` | TEXT NOT NULL | IANA zone of the phone when logged (`Europe/Madrid`) — to show the local time it was taken |
| `local_date` | TEXT NOT NULL | local date in that zone — for the calendar; for `missed`, the day the dose was missed |
| `note` | TEXT NULL | |
| `updated_at` | TEXT NOT NULL | |

Computed, not stored (Tide only shows numbers and flags, gives no medical advice):

- **Interval** — time since the previous `taken` dose of the same medication, in hours and minutes ("25 h 10 min").
- **Late** — interval longer than `medications.interval_hours` + `medications.delay_window_hours`.
- **Next dose** — previous dose + `interval_hours`, with the latest time + `delay_window_hours`, shown in the phone's **current** zone ("Next pill 21:00 · latest 00:00"). After a flight it is already converted to the new local time.
- **Zone change** — a dose logged in a different zone from the previous one shows both local times ("taken 08:05 Bangkok · 20:05 previous dose in Madrid").

### `medications` — phase 6

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | UUID |
| `name` | TEXT NOT NULL | e.g. a contraceptive or an antidepressant |
| `is_contraceptive` | INTEGER NOT NULL DEFAULT 0 | 1 — shown automatically on sex events within the course (see `sex_details`) |
| `regimen` | TEXT NULL | `continuous` · `21/7` · `24/4` · `other` — for contraceptives |
| `source` | TEXT NOT NULL DEFAULT 'tide' | `tide` · `health` (imported course) |
| `usual_time_from`, `usual_time_to` | TEXT NULL | approximate usual local time `HH:MM` for days without a dose log (imported history); both NULL — "time unknown" |
| `interval_hours` | REAL NULL | time between doses, usually 24; with it the pill appears in the daily check-in and the pill log |
| `delay_window_hours` | REAL NULL | allowed delay from the leaflet, set by the user |
| `started_on` | TEXT NOT NULL | `YYYY-MM-DD` |
| `ended_on` | TEXT NULL | still taking — NULL |
| `note` | TEXT NULL | dose changes and so on |
| `updated_at` | TEXT NOT NULL | |

### `settings` — key/value

Reminder time, theme, lock timeout and similar. Schema version lives in `PRAGMA user_version` (migrations as in Recallo).

## Storage and encryption (proposal)

Same stack as Recallo: Mobile — SQLite WebAssembly in a Web Worker, the core reaches the database only through a `Db` interface. The difference is encryption: the official SQLite WebAssembly build cannot encrypt its file, so Tide keeps the database in memory and stores it encrypted.

1. On start the encrypted file is read from OPFS, decrypted with WebCrypto (AES-GCM) and loaded into an in-memory SQLite database.
2. After each write the database is exported (a few hundred KB even after years of use), encrypted and written back to OPFS.
3. The data key is random (256 bits) and is never stored in the clear. How it is kept depends on the optional app lock (T7):
   - **Lock off** (the default): the key is a non-extractable WebCrypto key kept in IndexedDB. The file in OPFS is still encrypted, but anyone who opens Tide on the unlocked phone sees the data.
   - **Lock on**: the key is wrapped by a PIN → PBKDF2-SHA256 key, and optionally also by a passkey with the WebAuthn PRF extension, so Face ID unlocks the app (iOS 18+); the passkey never leaves the device. Turning the lock on re-wraps the key; turning it off asks for the PIN or Face ID, then goes back to the stored key.
4. A backup file (phase 4) is the same database encrypted with a key from a separate **backup password**, because the device keys do not move to a new iPhone.

## Merging backups (phase 4)

- *Replace* — the backup becomes the whole database.
- *Merge* — rows are matched by `id` (`date` for `daily_checkins`, (`date`, `tag`) for `day_symptoms`); a missing row is added, an existing one is replaced only if the backup's `updated_at` is newer. Deletions are not carried over by a merge (a deleted event may come back from an older backup) — acceptable for moving to a new phone, where *Replace* is the usual choice.
