# minions-ui — Claude guidance

Standalone PWA frontend for the minions engine (see `server/`). Works in any browser; installs as a PWA on phone and desktop; connects to N minion deployments via bearer-token auth.

## Stack

- Preact 10 + `@preact/signals`
- Vite 6
- Tailwind v4 (CSS-first config)
- `@reactflow/*` (split chunks) + `dagre` for DAG layout
- `idb-keyval` for per-connection snapshot cache
- vitest + jsdom + `@testing-library/preact` for unit / component
- Playwright for E2E (mobile-chromium, desktop-chromium, desktop-firefox)

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server. Proxies `/api` to `http://localhost:8080` for local minion development. |
| `npm run build` | `tsc -b` + `vite build`. Emits `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint across `src/` and `test/`. |
| `npm run test` | Unit + component tests (vitest). |
| `npm run test:watch` | Same, watch mode. |
| `npm run test:e2e` | Playwright E2E suite. **Do not run locally unless the user explicitly asks** — prefer pushing and letting CI cover it. |
| `npm run format` | Prettier. |

Always run `npm run typecheck && npm run lint && npm run test` before committing.

**Do not run `npm run test:e2e` / `npx playwright test` locally as part of routine validation.** Playwright runs are slow, flaky against sandboxed environments, and already covered by the `e2e` matrix in `.github/workflows/ci.yml` on every push and PR. Push the branch and rely on CI; only run Playwright locally when the user explicitly asks or when iterating on an E2E-specific failure they've pointed to.

## Directory map

```
src/
  main.tsx          — Preact entry point
  App.tsx           — root component, routes empty-state / active-connection UI
  index.css         — Tailwind import + global CSS vars (--accent)
  api/
    client.ts       — createApiClient({ baseUrl, token })
    sse.ts          — openEventStream with full-jitter backoff
    types.ts        — mirrors server/src/api-server.ts SseEvent/ApiSession/etc
  state/
    store.ts        — createConnectionStore(client) → signals + SSE wiring
    persist.ts      — IDB snapshot cache via idb-keyval
    types.ts
  connections/
    store.ts        — Map<id, ConnectionStore>, activeId signal, localStorage persist
    types.ts        — Connection { id, label, baseUrl, token, color }
    ConnectionPicker.tsx
    ConnectionsDrawer.tsx
    ConnectionSettings.tsx
  components/
    UniverseCanvas.tsx      — ReactFlow canvas for sessions + DAGs
    universe-layout.ts      — dagre layout (no UI)
    NodeDetailPopup.tsx
    ContextMenu.tsx
    ConfirmDialog.tsx
    ErrorBoundary.tsx
    PrLink.tsx
    shared.tsx
    types.ts
  chat/
    ChatPanel.tsx           — bottom sheet (mobile) / side panel (desktop)
    ConversationView.tsx
    MessageInput.tsx
    QuickActionsBar.tsx
  hooks/
    useTheme.ts             — light/dark/system, localStorage override
    useConfirm.tsx          — portal-based confirm/alert
    useMediaQuery.ts
  theme/colors.ts           — connection accent palette
  pwa/
    InstallPrompt.tsx
    useOnlineStatus.ts
  sw.ts                     — Workbox injectManifest entry
test/                       — vitest unit + component
e2e/
  fixtures/mock-minion.ts   — ephemeral HTTP + SSE server
  tests/*.spec.ts
public/
  manifest.webmanifest
  icons/
  favicon.svg
```

## Strict rules

- **No speculative methods / fallbacks / backwards-compat shims.** Change all call sites directly. If you can't find the right fix, say so — don't ship a workaround.
- **No code comments** except rare WHY lines (hidden constraint, subtle invariant, workaround for a named bug).
- **Never** use `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `_unused` prefix workarounds. Fix the underlying code.
- **No** "Generated with Claude Code" / co-author tags / "committed by agent" verbiage in PRs or commits.
- **Never** pass PR markdown via inline `gh pr create --body "..."`; shell expansion can break backticks/code fences.
- **Always** use `bash scripts/create-pr.sh "<title>" <<'PR_BODY' ... PR_BODY` (or `gh pr create --body-file -` with a quoted heredoc).
- Prefer the `Grep` tool (ripgrep) over raw `grep`.
- Preact 10 + `@preact/signals` only. No React hooks for global state.

## Library compatibility

This UI must stay wire-compatible with the engine. The API surface we depend on:

- `GET /api/sessions` → `{ data: ApiSession[] }`
- `GET /api/dags` → `{ data: ApiDagGraph[] }`
- `GET /api/events` → SSE stream of `SseEvent`s
- `POST /api/commands` → `{ data: CommandResult }`
- `POST /api/messages` → `{ data: { ok: true, sessionId } }` *(added in library v1.110.x)*
- `GET /api/version` → `{ data: { apiVersion, libraryVersion, features: string[] } }` *(added in library v1.110.x)*

Types mirror `server/src/api-server.ts`. When they diverge, **read that file first** before touching our `src/api/types.ts`.

When `/api/version.features` is missing a capability (e.g. `messages`), gate the UI and display "needs library ≥ X.Y" rather than calling a non-existent endpoint.

## Legacy port source

The original Telegram Mini App source is no longer maintained. All components have been ported and updated for standalone PWA use.

## SSE transport

- Full-jitter exponential backoff: `delay = Math.floor(Math.random() * Math.min(30000, 500 * 2 ** attempt))`.
- Every successful `open` triggers `onReconnect()` which refetches `/api/sessions` + `/api/dags` and replaces state. Events carry full snapshots — no merge logic.
- Auth: `Authorization: Bearer <token>` on HTTP; `?token=<token>` on SSE (EventSource can't set headers). Rotate `MINION_API_TOKEN` by updating `docker/.env` and restarting the engine (`docker compose up -d`).

## Deployment

Cloudflare Pages via git integration. No deploy job in GitHub Actions — Pages picks up every push automatically. Engine runs via Docker Compose — see `docker/README.md`.

Required env vars for the engine (set in `docker/.env`):

```
MINION_API_TOKEN=<rotate-me>
CORS_ALLOWED_ORIGINS=https://<your>.pages.dev,http://localhost:5173
```

To start the engine locally:

```sh
cd docker && docker compose up --build
```

## Monorepo structure

The engine lives in `server/`, the UI in `src/`. Changes spanning both go in a single PR — there is no separate `telegram-minions` repo to coordinate with.
