# Tide

A private iPhone app for tracking libido dynamics: partnered sex, other sexual activity and daily desire. A Home Screen web app, data stays on the device. Version 0.7.0 (phase 6 — cycle and medications: Cycle and Libido tabs, cycle report).

Plan: [PLAN.md](PLAN.md). Data model: [docs/DATA_MODEL.md](docs/DATA_MODEL.md). Notes for AI agents: [AGENTS.md](AGENTS.md).

## Install on iPhone

The app is published at https://k-coder-design.github.io/tide/ on every push to `main` (`.github/workflows/pages.yml`). Only the app's code is there; the journal stays on the phone.

1. Open the link in **Safari** on the iPhone.
2. Share → **Add to Home Screen** → Add.
3. Open Tide from the Home Screen icon and use it only from there: Safari and the Home Screen app keep separate data.

Updates arrive by themselves: Tide checks for a new version when opened, when brought back to the screen and every 10 minutes, and switches to it when no form is open (with App lock on, when Tide is off screen). App lock (Settings → Privacy) asks for a 4-digit PIN. A forgotten PIN cannot be reset. Removing the icon deletes the journal: keep backups (Settings → Backup → Back up now, saved through the Share sheet, encrypted with a backup password that cannot be recovered — or, if you turn Password protection off, unencrypted), and now and then a copy on the Mac or in iCloud Drive. On a new iPhone: install Tide, then Settings → Restore from backup… → Replace.

## Running

Needs Node.js 22+.

```bash
npm install
```

```bash
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Static files in `dist/` |
| `npm run preview` | Serve the built app |
| `npm run typecheck` | Type-check |
| `npm test` | Tests (Vitest): the core on the same SQLite WebAssembly as the phone, and the encrypted storage |
| `npm run health-import -- ~/Downloads/export.zip` | One-time Apple Health import: turns a Health export into an encrypted `.tidehealth` file for Settings → Import from Apple Health… (prints only counts) |
| `swift scripts/render-icons.swift` | Home Screen icons from `build/icon.svg` |

## Layout

- `src/core` — the domain layer and the database (runs in a Web Worker); `src/core/storage` — encryption.
- `src/worker` — the Worker entry and its browser storage (OPFS, IndexedDB).
- `src/shared` — types and the API contract between the interface and the core.
- `src/ui` — React screens; they call the core only through `src/ui/lib/client.ts`.
