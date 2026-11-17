# Tide — data model (draft for review)

Status: **approved, phase 0** (17.11.2026). Nothing is implemented yet; the tables appear in phase 2 (core), `cycle_starts` and `medications` in phase 6 — together with the automatic contraceptive display on sex events.

## What the app measures

Libido dynamics as three streams:

| Stream | Source | Typical chart |
| --- | --- | --- |
| Partnered activity | `events` with `kind = 'sex'` | count per week / month |
| Other activity | `events` with `kind` in `masturbation`, `dream`, `fantasy` | count per week / month, split by kind |
| Desire | `daily_checkins.desire` (1–10, once a day) | line with a moving average |

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

### `daily_checkins` — desire, at most one per day

| Column | Type | Notes |
| --- | --- | --- |
| `date` | TEXT PK | local date `YYYY-MM-DD` |
| `desire` | INTEGER NOT NULL | 1–10 |
| `note` | TEXT NULL | |
| `updated_at` | TEXT NOT NULL | |

### `cycle_starts` — phase 6

| Column | Type | Notes |
| --- | --- | --- |
| `date` | TEXT PK | first day of a period; phases are computed, not stored |

### `medications` — phase 6

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | UUID |
| `name` | TEXT NOT NULL | e.g. a contraceptive or an antidepressant |
| `is_contraceptive` | INTEGER NOT NULL DEFAULT 0 | 1 — shown automatically on sex events within the course (see `sex_details`) |
| `started_on` | TEXT NOT NULL | `YYYY-MM-DD` |
| `ended_on` | TEXT NULL | still taking — NULL |
| `note` | TEXT NULL | dose changes and so on |

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
- *Merge* — rows are matched by `id` (`date` for `daily_checkins`); a missing row is added, an existing one is replaced only if the backup's `updated_at` is newer. Deletions are not carried over by a merge (a deleted event may come back from an older backup) — acceptable for moving to a new phone, where *Replace* is the usual choice.
