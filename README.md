# minions-ui

Standalone PWA that replaces the Telegram Mini App frontend for [`@tprei/telegram-minions`](https://github.com/prei/telegram-minions). Built with Preact, Vite, and Tailwind v4. Works as a regular browser app — no Telegram client required.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server at http://localhost:3000 |
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Run ESLint across the project |
| `npm run test` | Run unit tests with Vitest (jsdom) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run format` | Format all files with Prettier |

## Dev proxy

In development, requests to `/api/*` are proxied to `http://localhost:8080` — the default port for `telegram-minions`.

## Architecture

```
src/
  main.tsx      — entry point, renders <App /> into #app
  App.tsx       — root component
  index.css     — Tailwind base + global resets
test/
  setup.ts      — @testing-library/preact cleanup
  App.test.tsx  — smoke tests
public/
  favicon.svg
  icons/        — see icons/README.md (populated in M6)
```

## Milestones

See `docs/` for milestone plans. M0 is this scaffold. Subsequent milestones add:

- **M1** — API client (`/api` fetch wrapper, SSE stream)
- **M2** — Connection manager UI (add/remove minion endpoints)
- **M3** — Session list and status display
- **M4** — DAG visualization (ReactFlow + dagre)
- **M5** — Chat panel and reply UI
- **M6** — PWA assets, manifest, service worker
- **M7** — Playwright e2e tests
- **M8** — Docs, CLAUDE.md, AGENTS.md
