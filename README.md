# Tide

A private iPhone app for tracking libido dynamics: partnered sex, other sexual activity and daily desire. A Home Screen web app, data stays on the device. Version 0.2.0 (phase 2 — the journal).

Plan: [PLAN.md](PLAN.md). Data model: [docs/DATA_MODEL.md](docs/DATA_MODEL.md). Notes for AI agents: [AGENTS.md](AGENTS.md).

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
| `swift scripts/render-icons.swift` | Home Screen icons from `build/icon.svg` |

## Layout

- `src/core` — the domain layer and the database (runs in a Web Worker); `src/core/storage` — encryption.
- `src/worker` — the Worker entry and its browser storage (OPFS, IndexedDB).
- `src/shared` — types and the API contract between the interface and the core.
- `src/ui` — React screens; they call the core only through `src/ui/lib/client.ts`.
