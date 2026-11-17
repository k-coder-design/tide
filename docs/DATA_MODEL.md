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

**Bleeding episodes** are computed, not stored: consecutive days with flow `spotting` or heavier, where gaps of up to 2 days (`none` or not recorded) do not break the episode. An episode has a start, a length and its strongest flow.

**Health import (phase 4, T12)** fills `flow` with `flow_source = 'health'`: `HKCategoryTypeIdentifierMenstrualFlow` light / medium / heavy / unspecified → the same value, `HKCategoryTypeIdentifierIntermenstrualBleeding` → `spotting` (the stronger value wins when a day has both). Health days marked "no flow" are skipped. A day already recorded in Tide is never overwritten; re-importing the same export changes nothing.

### `day_symptoms` — symptom tags by day (phase 6)

| Column | Type | Notes |
| --- | --- | --- |
| `date` | TEXT NOT NULL | local date |
| `tag` | TEXT NOT NULL | from a fixed list in code: `cramps` · `headache` · `bloating` · `breast_tenderness` · `acne` · `low_mood` · `irritability` · `fatigue` |
| | | PRIMARY KEY (`date`, `tag`) |

### `pill_log` — one row per medication per day (phase 6)

| Column | Type | Notes |
| --- | --- | --- |
| `medication_id` | TEXT NOT NULL → `medications.id` | |
| `date` | TEXT NOT NULL | local date |
| `status` | TEXT NOT NULL | `taken` · `missed` |
| `taken_at` | TEXT NULL | local time `HH:MM` when taken |
| `updated_at` | TEXT NOT NULL | |
| | | PRIMARY KEY (`medication_id`, `date`) |

A pill is **late** when `taken_at` is later than `medications.scheduled_time` plus `medications.delay_window_hours`. Computed, not stored; Tide only flags it and gives no medical advice.

### `medications` — phase 6

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | UUID |
| `name` | TEXT NOT NULL | e.g. a contraceptive or an antidepressant |
| `is_contraceptive` | INTEGER NOT NULL DEFAULT 0 | 1 — shown automatically on sex events within the course (see `sex_details`) |
| `regimen` | TEXT NULL | `continuous` · `21/7` · `24/4` · `other` — for contraceptives |
| `scheduled_time` | TEXT NULL | usual time `HH:MM`; with it the pill appears in the daily check-in |
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
3. The data key is random (256 bits) and is never stored in the clear. It is wrapped by:
   - a PIN → PBKDF2-SHA256 key — always available;
   - a passkey with the WebAuthn PRF extension → Face ID unlocks the app (iOS 18+); the passkey never leaves the device.
4. A backup file (phase 4) is the same database encrypted with a key from a separate **backup password**, because the device keys do not move to a new iPhone.

## Merging backups (phase 4)

- *Replace* — the backup becomes the whole database.
- *Merge* — rows are matched by `id` (`date` for `daily_checkins`, (`medication_id`, `date`) for `pill_log`, (`date`, `tag`) for `day_symptoms`); a missing row is added, an existing one is replaced only if the backup's `updated_at` is newer. Deletions are not carried over by a merge (a deleted event may come back from an older backup) — acceptable for moving to a new phone, where *Replace* is the usual choice.
