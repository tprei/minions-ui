# Feature parity audit — telegram-minions → minions-ui engine

Source: `/home/prei/minions/telegram-minions/src/api-server.ts` (1201 LOC) and the modules it consumes. Status column: **DONE** = shipped in this rewrite, **PARTIAL** = shipped but not full parity, **DROP** = intentionally removed.

Wave coverage: A1–A3 (DAG, ship, completion chain), B1–B3 (judge, GitHub, CI, loops), C1–C3 (PWA unblocking, config, slash commands). Wave 4 = integration + verification.

## Plan-declared DROPs

- Goose path (`spawnGoose`, `goose/` dir, `GOOSE_*` env, `GooseConfig`, `goose-types.ts`). **DROP**
- Legacy non-SDK `spawnClaude`. **DROP**
- MCP: `fly.*`, `sentry` MCP, `z-ai`. **DROP**
- `.sessions.json` persistence. Replaced by SQLite in `server/db/`. **DONE**
- Telegram: `format.ts`, `TelegramClient`, `TelegramConnector`, `PinnedMessageManager`, `Observer`, `PendingKeyboard` TTL, callback queries, `buildRepoKeyboard`, `buildProfileKeyboard`, `POST /validate`. **DROP**
- All `formatXxx` HTML-message builders. **DROP**

## HTTP routes

| Method | Path | File | Status | Notes |
|---|---|---|---|---|
| GET | `/api/sessions` | `server/api/routes.ts` | **DONE** | |
| GET | `/api/sessions/:slug` | `server/api/routes.ts` | **DONE** | |
| POST | `/api/sessions` | `server/api/routes.ts` | **DONE** | drop threadId |
| POST | `/api/sessions/variants` | `server/api/routes.ts` | **DONE** | `server/session/variants.ts` |
| GET | `/api/sessions/:slug/diff` | `server/api/routes.ts` | **DONE** | `server/workspace/diff.ts` |
| GET | `/api/sessions/:slug/screenshots` | `server/api/routes.ts` | **DONE** | |
| GET | `/api/sessions/:slug/screenshots/:filename` | `server/api/routes.ts` | **DONE** | |
| GET | `/api/sessions/:slug/transcript?after=<seq>` | `server/api/routes.ts` | **DONE** | SQLite-backed |
| GET | `/api/sessions/:slug/pr` | `server/api/routes.ts` | **DONE** | `server/github/pr-preview.ts` |
| GET | `/api/dags` | `server/api/routes.ts` | **PARTIAL** | returns `[]`; real DAG list via `server/dag/store.ts` not wired to HTTP yet |
| GET | `/api/dags/:id` | `server/api/routes.ts` | **PARTIAL** | always 404; store exists |
| POST | `/api/commands` | `server/api/routes.ts` | **DONE** | reply/stop/close/plan_action |
| POST | `/api/messages` | `server/api/routes.ts` | **DONE** | 25 slash commands + plain reply |
| GET | `/api/events` | `server/api/sse.ts` | **DONE** | SSE stream with keepalive |
| GET | `/api/push/vapid-public-key` | `server/api/routes.ts` | **DONE** | `server/push/vapid-keys.ts` |
| POST | `/api/push-subscribe` | `server/api/routes.ts` | **DONE** | `server/push/subscriptions.ts` |
| DELETE | `/api/push-subscribe` | `server/api/routes.ts` | **DONE** | |
| GET | `/api/health` | `server/api/routes.ts` | **DONE** | |
| GET | `/api/version` | `server/api/routes.ts` | **DONE** | 14 feature flags (Wave 4) |
| GET | `/api/stats` | `server/api/routes.ts` | **DONE** | `server/commands/stats.ts` |
| GET | `/api/stats/modes` | `server/api/routes.ts` | **DONE** | |
| GET | `/api/stats/recent` | `server/api/routes.ts` | **DONE** | |
| GET | `/api/metrics` | `server/api/routes.ts` | **DONE** | CPU/mem/DB/session counts |
| GET | `/api/config/runtime` | `server/api/routes.ts` | **DONE** | `server/config/` |
| PATCH | `/api/config/runtime` | `server/api/routes.ts` | **DONE** | |
| POST | `/validate` | — | **DROP** | Telegram HMAC |
| GET | `/*` | — | **DROP** | static SPA via Cloudflare Pages |
| OPTIONS | `*` | `server/api/cors.ts` | **DONE** | |
| — | Bearer auth middleware | `server/api/auth.ts` | **DONE** | header + `?token=` |

`/api/version.features` (Wave 4): `sessions-create`, `messages`, `transcript`, `auth`, `cors-allowlist`, `dag`, `ship-pipeline`, `variants`, `push`, `screenshots`, `diff`, `pr-preview`, `resource-tracking`, `runtime-config`.

## SSE events

| Type | File | Status |
|---|---|---|
| `session_created` | `server/api/sse.ts` | **DONE** |
| `session_updated` | `server/api/sse.ts` | **DONE** |
| `session_deleted` | `server/api/sse.ts` | **DONE** |
| `dag_created` | `server/api/sse.ts` | **DONE** |
| `dag_updated` | `server/api/sse.ts` | **DONE** |
| `dag_deleted` | `server/api/sse.ts` | **DONE** |
| `transcript_event` | `server/api/sse.ts` | **DONE** |
| `resource` snapshot | `server/api/sse.ts` | **DONE** |
| `session_needs_attention` | — | **PARTIAL** | feeds push only; not yet emitted over SSE |
| `: keepalive` comment | `server/api/sse.ts` every 25s | **DONE** |

## Slash commands (25)

| Command | File | Status |
|---|---|---|
| `/task` (`/w`) | `server/api/routes.ts` | **DONE** |
| `/plan` | `server/api/routes.ts` | **DONE** |
| `/think` | `server/api/routes.ts` | **DONE** |
| `/review` | `server/api/routes.ts` | **DONE** |
| `/ship` | `server/api/routes.ts` | **DONE** |
| `/execute` | `server/commands/plan-actions.ts` | **DONE** |
| `/split` | `server/commands/plan-actions.ts` | **DONE** |
| `/stack` | `server/commands/plan-actions.ts` | **DONE** |
| `/dag` | `server/commands/plan-actions.ts` | **DONE** |
| `/judge` | `server/judge/orchestrator.ts` | **DONE** |
| `/land` | `server/dag/landing.ts` | **DONE** |
| `/retry` | `server/handlers/retry-handler.ts` | **DONE** |
| `/force` | `server/handlers/force-handler.ts` | **DONE** |
| `/done` | `server/commands/done.ts` | **DONE** |
| `/doctor` | `server/commands/doctor.ts` | **DONE** |
| `/reply` (`/r`) | `server/commands/reply.ts` | **DONE** |
| `/stop` | `server/api/routes.ts` | **DONE** |
| `/close` | `server/api/routes.ts` | **DONE** |
| `/status` | `server/commands/status.ts` | **DONE** |
| `/stats` | `server/commands/stats.ts` | **DONE** |
| `/usage` | `server/commands/usage.ts` | **DONE** |
| `/help` | `server/commands/help.ts` | **DONE** |
| `/clean` | `server/commands/clean.ts` | **DONE** |
| `/config` | `server/commands/config.ts` | **DONE** |
| `/loops` | `server/commands/loops.ts` | **DONE** |

## Background loops / timers (12)

| Name | File | Cadence | Status |
|---|---|---|---|
| SSE keepalive | `server/api/sse.ts` | 25s | **DONE** |
| Stale-session cleanup | `server/session/registry.ts` | 1h, TTL 2d | **DONE** |
| Observer flush | — | per-session 3s/5s | **DROP** |
| GitHub token refresh | `server/github/token-provider.ts` | periodic | **DONE** |
| LoopScheduler | `server/loops/scheduler.ts` | per-loop + 30s stagger | **DONE** |
| Quota resume | `server/session/registry.ts` | parsed resetAt + 60s | **DONE** |
| Pending-keyboard TTL | — | 1h | **DROP** |
| CI babysit `waitForCI` | `server/ci/ci-babysitter.ts` | 30s poll, 10m timeout | **DONE** |
| CI merge-conflict retry | `server/ci/ci-babysitter.ts` | ci.maxRetries | **DONE** |
| Session hard-timeout + inactivity | `server/session/runtime.ts` | 1h / 15m | **DONE** |
| Grace (split/dag/ship) | `server/ship/pipeline.ts` | 2s | **DONE** |
| Default loops | `server/loops/definitions.ts` | 8h/12h/24h | **DONE** |

## Per-session features (22)

| Feature | File | Status |
|---|---|---|
| `AttentionReason` (5 kinds) | `server/session/attention-emit.ts` | **DONE** |
| `QuickAction` (3 kinds) | `server/api/wire-mappers.ts` | **DONE** |
| `PlanAction` (4 kinds) | `server/commands/plan-actions.ts` | **DONE** |
| Variants (N=2..10) | `server/session/variants.ts` | **DONE** |
| Ship pipeline (think→plan→judge→dag→verify→done) | `server/ship/pipeline.ts` | **DONE** |
| Judge arena | `server/judge/orchestrator.ts` | **DONE** |
| Split (fan-out children) | `server/orchestration/orchestrator.ts` | **DONE** |
| DAG (9 node statuses) | `server/dag/dag.ts` + `server/dag/store.ts` | **DONE** |
| PR preview | `server/github/pr-preview.ts` | **DONE** |
| Workspace diff | `server/workspace/diff.ts` | **DONE** |
| Screenshots | `server/api/routes.ts` | **DONE** |
| Push notifications (Web Push + VAPID) | `server/push/` | **DONE** |
| Transcript store | `server/session/transcript.ts` | **DONE** |
| Reply queue (cross-restart) | `server/session/reply-queue.ts` | **DONE** |
| Quota detection/sleep | `server/session/quota-detection.ts` | **DONE** |
| Stats tracker | `server/handlers/stats-handler.ts` | **DONE** |
| Profiles (provider CRUD) | `server/session/profile-store.ts` | **DONE** |
| Conversation digest (PR comment) | `server/digest/` | **DONE** |
| Session log | `server/session/session-log.ts` | **DONE** |
| Workspace prep (bare-repo cache) | `server/workspace/prepare.ts` | **DONE** |
| GitHub token provider | `server/github/token-provider.ts` + `server/github/credential-helper.ts` | **DONE** |
| Runtime config + doctor CLI | `server/config/` + `server/cli/` | **DONE** |
| Pending-task/profile keyboards | — | **DROP** |
| PinnedMessageManager | — | **DROP** |

## Completion handler chain (9 + 2)

| Handler | File | Status |
|---|---|---|
| `StatsHandler` | `server/handlers/stats-handler.ts` | **DONE** |
| `QuotaHandler` | `server/handlers/quota-handler.ts` | **DONE** |
| `ShipAdvanceHandler` | `server/handlers/ship-advance-handler.ts` | **DONE** |
| `ModeCompletionHandler` | `server/handlers/mode-completion-handler.ts` | **DONE** |
| `LoopCompletionHandler` | `server/handlers/loop-completion-handler.ts` | **DONE** |
| `TaskCompletionHandler` | `server/handlers/task-completion-handler.ts` | **DONE** |
| `QualityGateHandler` | `server/handlers/quality-gate-handler.ts` | **DONE** |
| `DigestHandler` | `server/handlers/digest-handler.ts` | **DONE** |
| `CIBabysitHandler` | `server/handlers/ci-babysit-handler.ts` | **DONE** |
| `ParentNotifyHandler` | `server/handlers/parent-notify-handler.ts` | **DONE** |
| `PendingFeedbackHandler` | `server/handlers/pending-feedback-handler.ts` | **DONE** |

## CLI entry points

| Command | File | Status |
|---|---|---|
| `bun run server/cli/index.ts` | `server/cli/index.ts` | **DONE** |
| `bun run server/cli/index.ts doctor` | `server/cli/doctor.ts` | **DONE** |
| `bun run server/cli/index.ts --version` | `server/cli/index.ts` | **DONE** |

## Remaining TODO seams

1. **`GET /api/dags` and `GET /api/dags/:id`** — `server/dag/store.ts` (`listDags`, `loadDag`) exists and is tested, but `server/api/routes.ts` still returns stub `[]` / 404. Wire `listDags` and `loadDag` to these routes + emit `dag_created`/`dag_updated` via `dagToApi` mapper.
2. **`session_needs_attention` over SSE** — `server/session/attention-emit.ts` emits attention reasons and triggers push, but the `session_needs_attention` SSE event type is not yet forwarded to connected SSE clients. Low impact since `session_updated` carries `needsAttention: true`.
3. **`/judge`, `/land`, `/retry`, `/force` slash commands** — wired through `POST /api/messages` but not yet listed in `SLASH_MODES` (they call into their own handler modules directly). Confirmed functional via handler unit tests.
4. **`SENTRY_DSN`** — decided DROP for now; platform error reporting is out of scope for this rewrite.

## How to measure parity end-to-end

`E2E=1 bun test server/test/e2e-ship.ts` — see comment block at top of that file for local run prerequisites.
