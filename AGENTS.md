# Tide — notes for AI agents

A private iPhone Home Screen web app (React + Vite + TypeScript) for tracking libido dynamics. Same stack and architecture as Recallo: Mobile (`~/Documents/Recallo`, decision D57 there). Plan and decisions — [PLAN.md](PLAN.md), data model — [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

## Commands

- `npm install` — dependencies.
- `npm run dev` — development server; `npm run build` — static files in `dist/`.
- `npm run typecheck`, `npm test` — checks.

## Rules

- The data is highly sensitive: it stays on the device and is stored encrypted. Never add analytics, telemetry, external fonts or any network requests with user data.
- Everything in the repository is in English: code, comments, docs, test names.
- Business rules live only in the domain layer; the interface calls it, never the database directly (as in Recallo).
- After user-visible changes, update PLAN.md (phase result, decision Tn).
