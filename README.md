# minions-ui

Standalone PWA frontend for the minions engine. Built with Preact, Vite, and Tailwind v4. Works as a regular browser app — no Telegram client required. Connects to N minion deployments via bearer-token auth.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (UI + server) at http://localhost:3000 |
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Run ESLint across the project |
| `npm run test` | Run unit tests with Vitest (jsdom) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run format` | Format all files with Prettier |

## Dev proxy

In development, the `npm run dev` command starts both the Vite dev server (UI on port 3000) and the backend server (API on port 8080). The Vite dev server proxies `/api/*` requests to `http://localhost:8080`.

## Architecture

See [`CLAUDE.md`](./CLAUDE.md) for the full directory map and working rules, [`AGENTS.md`](./AGENTS.md) for agent routing. The engine lives in `server/`, the UI in `src/`.

## Milestones

- **M0** — Scaffold (Vite + Preact + Tailwind v4, vitest, ESLint, husky, CI).
- **M1** — Engine-side contract in `server/`: bearer auth, CORS allowlist, `POST /api/messages`, `GET /api/version`, `Dispatcher.handleIncomingText`.
- **M2** — API client, SSE stream with full-jitter backoff, per-connection store, connection settings form.
- **M3** — Port DAG canvas (UniverseCanvas + dagre layout + node popup + context menu + confirm dialog) — Telegram SDK stripped.
- **M4** — Chat panel (bottom sheet on mobile, side panel on desktop) with conversation view, message input, quick actions bar.
- **M5** — Multi-connection UX: picker dropdown, drawer, color accents, staggered initial SSE.
- **M6** — PWA: `vite-plugin-pwa` (Workbox injectManifest), manifest, icons, offline last-snapshot render.
- **M7** — Playwright E2E against a mock-SSE fixture, matrix `mobile-chromium` / `desktop-chromium` / `desktop-firefox`.
- **M8** — `meta-minion` registration + this repo's `CLAUDE.md` and `AGENTS.md`.
