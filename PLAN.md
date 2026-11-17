# Tide — plan

A private iPhone app for tracking libido dynamics: partnered sex, other sexual activity (masturbation, sexual dreams, fantasies) and daily desire (1–10). For personal use only, data stays on the device.

## Decisions

| # | Decision | Date |
| --- | --- | --- |
| T1 | **Stack as Recallo: Mobile** — a Home Screen web app (React 19, Vite, TypeScript, SQLite WebAssembly in a Worker), not native Swift: with a free Apple ID an Xcode app stops opening after 7 days (Recallo D57). Design is Tide's own. | 17.11.2026 |
| T2 | **For personal use only**: no onboarding, no App Store. | 17.11.2026 |
| T3 | **Data only on the device**, encrypted; moving to a new phone — by an encrypted backup file. No server, no MCP. | 17.11.2026 |
| T4 | **Desire = daily rating 1–10**; notable fantasies can be logged as separate events. | 17.11.2026 |
| T5 | Sex details (all optional): partner label, satisfaction 1–10 (also for masturbation), orgasm, initiator, protection (none / condom / other). | 17.11.2026 |
| T6 | Factors: menstrual cycle and medications. A medication marked as a contraceptive is shown automatically on sex events within its course — computed, not stored per event. | 17.11.2026 |
| T7 | Privacy: PIN / Face ID lock, neutral icon and name, neutral reminders, encrypted database. | 17.11.2026 |
| T8 | Interface language — English. | 17.11.2026 |
| T9 | **Public GitHub repository** `k-coder-design/tide`, as Recallo — free GitHub Pages hosting later. Code and specs are public; user data never leaves the device. Specs are kept in English in the repository. | 17.11.2026 |

## Web app limits on iPhone (affect phases 3 and 7)

- **Face ID**: no direct API; done through a passkey (WebAuthn), which iOS confirms with Face ID. PIN as the fallback.
- **Reminders**: a web app cannot schedule a local notification; Web Push needs a server. Server-free option: an iOS Shortcuts personal automation that shows a neutral notification every evening and opens Tide.
- **Widget**: not possible for a web app. Option: a Shortcut on the Home Screen or Lock Screen that opens Tide straight on "quick add".
- **Removing the Home Screen icon deletes the data** — backups (phase 4) are essential.

## Phases

0. **Setup** ✅ — Recallo studied, project created (builds, runs at iPhone size), data model approved ([docs/DATA_MODEL.md](docs/DATA_MODEL.md)).
1. **Design** — style options, design system (colors, type, components, light/dark), mockups of all key screens, a clickable prototype, a neutral icon. ✅ when the mockups are approved.
2. **Core: the journal** — encrypted local database, quick logging, daily desire, timeline and calendar, partner labels, offline mode.
3. **Privacy** — PIN / Face ID, auto-lock, blur in the app switcher, neutral icon and name.
4. **Backups and moving** — encrypted backup file with a password, Share sheet, restore (replace / merge), backup reminder, delete all data. ✅ when a backup from the old phone fully restores on a new one.
5. **Analytics** — frequency by week / month for both streams, desire with a moving average, heat-map calendar, period comparison.
6. **Cycle and medications** — period starts, computed phases, medication courses, contraceptives shown on sex events automatically, overlays on charts and simple findings.
7. **Habit** — reminders and a quick-add shortcut (see the limits above).

Phases 1–5 give the first useful version.
