# De-Telegramification — plan

Date: 2026-04-18
Status: draft, awaiting user review
Scope: turn `@tprei/telegram-minions` into a pure engine; make Telegram and the PWA peer connectors; grow the PWA toward a Conductor-shaped product.

## Goal

Today the library is Telegram-first with the PWA bolted on as a viewer of Telegram-shaped state. We want:

- `@tprei/minions-core` — a headless **engine** that spawns, coordinates, and broadcasts sessions/DAGs. Knows nothing about chat.
- **Connectors** that plug into the engine to expose it through a channel: `TelegramConnector`, `HttpConnector` (feeds the PWA), `CliConnector`, future `SlackConnector`, etc.
- The PWA becomes a first-class client of the engine — able to create and drive sessions without any Telegram deployment.
- Telegram stays working throughout. No day in which long-time Telegram users see regressions.

Inspiration: [conductor.build](https://conductor.build) — multiple parallel Claude Code workspaces, worktree-per-session, visual parallelism, rich diff/PR UI. Same muscles as what the engine already flexes; different front end.

## Why

1. PWA shape today is *"viewer on top of Telegram state."* Every feature requires mirroring Telegram's message pipeline into `ApiSession.conversation`. That bridge is where most of the recent bugs come from (tool activity, reply-injected commands, CORS on SSE).
2. `configFromEnv` throws without `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `ALLOWED_USER_IDS`. You cannot deploy a PWA-only minion.
3. Adding a third channel (Slack, Discord, VSCode extension) requires copying the Telegram boilerplate. With a connector interface, each new channel is ~200 LoC against a stable engine contract.
4. Conductor-shaped UX (parallel agents, rich diffs, drag-and-drop tasks across repos) needs the PWA to **own** the session lifecycle. Impossible while the library assumes Telegram owns threads.

## What "engine" means

Core contract (rough shape — not final):

```ts
interface MinionEngine {
  // Lifecycle
  start(): Promise<void>
  stop(): void

  // Session CRUD
  createSession(input: { repo?: string; prompt: string; mode: SessionMode; parentId?: string }): Promise<SessionId>
  sendInput(sessionId: SessionId, text: string): Promise<void>    // reply or slash-command
  stopSession(sessionId: SessionId): Promise<void>
  closeSession(sessionId: SessionId): Promise<void>
  planAction(sessionId: SessionId, action: 'execute' | 'split' | 'stack' | 'dag'): Promise<SessionId[]>

  // Query
  getSessions(): Session[]
  getDags(): Dag[]
  getRepos(): RepoEntry[]

  // Event stream — what every connector subscribes to
  on(event: 'session_created'    | 'session_updated' | 'session_deleted'
        | 'assistant_text'       | 'assistant_activity'
        | 'dag_created'          | 'dag_updated'     | 'dag_deleted'
        | 'attention',  cb: (e: EngineEvent) => void): Unsubscribe
}

interface Connector {
  name: string
  attach(engine: MinionEngine): Promise<void>
  detach(): Promise<void>
}
```

The Dispatcher + Observer + SDKSessionHandle + DagScheduler + ShipPipeline all sit inside the engine. The engine emits *abstract* events (`assistant_text`, `assistant_activity`), and every connector decides how to surface them:

- `TelegramConnector` turns `assistant_activity` into an HTML "🔧 Activity · N tools" message and posts/edits in a forum topic.
- `HttpConnector` appends the same event to `ApiSession.conversation` as markdown, broadcasts via SSE.
- `CliConnector` renders to stdout with ANSI colors.
- Future `SlackConnector` posts to a channel/thread.

Session ids stop being `number` (Telegram forum topic ids) and become stable string UUIDs. Each connector keeps its own mapping table (Telegram: forumTopicId ↔ coreSessionId).

## Phased migration — no big-bang

### Phase 1 — carve out the engine (internal, non-breaking)

Target: 3–5 days of focused work.

- New class `MinionEngine` in `src/engine/`. Today's `Dispatcher` becomes its private wiring.
- Introduce abstract `EngineEvent` alongside the existing `SseEvent`. For now, both fire in parallel.
- Refactor Observer to emit events via a callback the engine subscribes to, instead of calling `ChatPlatform.chat.sendMessage()` directly. Telegram becomes a listener instead of the owner.
- `TelegramConnector` class wraps current Telegram logic, implements `Connector`. Identical runtime behavior.
- `HttpConnector` wraps the existing `createApiServer` + `StateBroadcaster`. Subscribes to engine events and translates them into `ApiSession.conversation` entries + SSE broadcasts. Replaces the direct `pushToConversation` + `broadcastSession` couples.
- `createMinion(config)` stays the same entry point. Under the hood it creates an engine + the configured connectors.

Acceptance:
- All existing tests green.
- Telegram users see no difference.
- PWA users see no difference.
- Engine has its own event-level unit tests that don't touch Telegram.

### Phase 2 — connectors become opt-in (first breaking release)

Target: 2–3 days.

- `configFromEnv` stops throwing without Telegram secrets. If `TELEGRAM_BOT_TOKEN` is absent, no `TelegramConnector` is attached.
- Public API switches to explicit connector registration:

  ```ts
  import { createEngine, TelegramConnector, HttpConnector } from '@tprei/telegram-minions'
  const engine = createEngine({ repos, workspace, agentDefs, ... })
  if (process.env.TELEGRAM_BOT_TOKEN) engine.use(new TelegramConnector({ ... }))
  if (process.env.API_PORT) engine.use(new HttpConnector({ port, apiToken, cors }))
  await engine.start()
  ```
- Old `createMinion(config)` stays as a thin compat wrapper for one major version, deprecated in docs.
- Bump to v2.0.0 (or cut a `next` dist-tag first).

Acceptance:
- A minion with only `API_PORT` set (no Telegram) boots and serves the PWA.
- Existing `createMinion` deployments keep working unchanged.

### Phase 3 — PWA-native session lifecycle

Target: 4–6 days.

- Session ids become UUIDs generated by the engine. `TopicSession.threadId` renamed to `TopicSession.connectorIds: Record<string, string>` (e.g. `{ telegram: '42', http: 'uuid' }`).
- `ApiSession.chatId` / `threadId` become nullable. PWA already reads only `slug` + `id`, so minimal impact there.
- `HttpConnector` creates its own session routes: `POST /api/sessions { repo, prompt, mode }` — no need to pipe through `/api/messages`.
- `/api/messages` stays for slash-command parsing + reply injection from the PWA, but no longer requires a matching `topicSession.slug`.
- Persistence migration: existing on-disk `TopicSession` entries get a synthetic `connectorIds.telegram = threadId` field on first boot after upgrade.

Acceptance:
- Running the library with zero Telegram env vars still lets the PWA spawn `/task` sessions, see activity, reply, stop, close.
- A Telegram-only minion still behaves identically.

### Phase 4 — Conductor-shaped UX in the PWA

Target: 1–2 weeks in parallel with other work.

Feature list, loose priority order:

- **Per-session worktree panel** — show the worktree path, branch, diff stats in the chat header. Already available server-side.
- **Parallel variants** — "Run this task 3 times" button spawns 3 sessions with the same prompt in isolated worktrees. DAG already handles this; just needs a one-click UI.
- **Diff viewer** — embed a monaco/codemirror diff for each session's changed files. Pull from server via new `GET /api/sessions/:id/diff`.
- **Screenshots** — the engine already captures Playwright screenshots for Telegram; surface them inline in the PWA chat.
- **Attachments** — `POST /api/messages` with `multipart/form-data`, stream to the session's workspace. For now text-only.
- **PR preview card** — when `session.prUrl` lands, show title/body/CI status inline. Would need a new `GET /api/sessions/:id/pr` endpoint that calls through the GitHub token the minion already holds.
- **Native browser notifications** — replace Telegram push. Web Push + permission prompt on first PWA install.
- **Cross-minion coordination** — PWA can already talk to N minions. Add drag-and-drop of tasks between minions (useful for "move this work from `pixwise-minion` to `meta-minion`"). Requires `POST /api/sessions/:id/handoff` on both ends.

### Phase 5 — split into separate packages

Target: 1 day of packaging once Phase 3 is stable.

- `@tprei/minions-core` — engine, types, SDK handle, DAG, scheduler.
- `@tprei/minions-telegram` — `TelegramConnector`.
- `@tprei/minions-http` — `HttpConnector`, api-server, SSE broadcaster, static asset serving.
- `@tprei/minions-cli` — CLI entrypoint, composes any set of connectors.

Consumers pull only what they use. Cloudflare-Pages-only deployments stop pulling Telegram bot SDK. Telegram-only deployments stop pulling the http server.

## Concrete work items on the way to Phase 1

The first PRs in sequence. Each one is independently reviewable and keeps all tests green:

1. **Rename Dispatcher → Engine, move to src/engine/.** Mechanical. No behavior change.
2. **Introduce `EngineEvent` union**, emit alongside current `SseEvent`. Event helpers only; no subscribers yet.
3. **Extract `BroadcasterEventBus`.** Replace ad-hoc `broadcaster.broadcast` calls with `engine.emit('...', payload)`. SSE broadcaster becomes a subscriber.
4. **Observer emits `assistant_text` / `assistant_activity`** instead of calling `platform.chat.sendMessage`. `TelegramConnector` subscribes and formats. HttpConnector subscribes and appends to conversation (replaces current `onTextCapture` + `onActivityCapture` hooks).
5. **Extract `TelegramConnector` class** owning everything in `src/telegram/`. Constructor takes config; `attach(engine)` wires up poll loop, subscriptions, commands. Existing `createMinion` instantiates it when secrets present.
6. **Extract `HttpConnector` class** owning `src/api-server.ts`. Constructor takes config; `attach(engine)` wires up routes + broadcaster.
7. **Adjust `createMinion`** to build engine + connectors under the hood. Public API unchanged.

After step 7, the engine is real internally. Phase 2 publishes it.

## Risks and open questions

- **Persistence migration on existing deployments.** `TopicSession` JSON on the fly.io volume assumes `threadId: number`. Need a one-shot migration. Can ship under a feature flag with a fallback reader.
- **Reply injection semantics.** Engine needs to understand "reply to session X" vs. "create new session." Currently coupled to Telegram's thread context. Explicit API: `engine.sendInput(sessionId, text)` vs. `engine.createSession({ prompt })`.
- **Multi-connector broadcast ordering.** If a command arrives via HTTP and a reply from Telegram simultaneously, what wins? Lean on a single in-process mutex per session, same as today's Dispatcher.
- **Test churn.** Many tests mock `TelegramPlatform`. Phase 1 keeps them green by wrapping. Phase 3 will require a rewrite pass — call it 1–2 days of test authoring.
- **Naming.** Package stays `@tprei/telegram-minions` through Phase 4. Rename to `@tprei/minions` in Phase 5 with a reexport-shim. Open question: do we want `@tprei/minions-core` or just `@tprei/minions`?
- **Conductor feature parity.** Conductor is desktop-native with OS integration (menu bar, notifications, keychain). PWA gives us ~80% at 20% of the work. The remaining 20% (file system browsing, native diffs, desktop notifications) is a larger investment. Worth revisiting after Phase 4.

## Definition of done

- A minion deployed with *only* `API_PORT` + `MINION_API_TOKEN` runs the full loop: PWA creates `/task`, sees activity, replies, stops, lands PRs, spawns parallel DAG sessions. No Telegram secret required.
- A Telegram-only minion deployed with *only* `TELEGRAM_BOT_TOKEN` etc. behaves identically to today.
- A dual-channel minion shows the same session state in both UIs, in real time, with no drift.
- All phases shipped via non-breaking releases except a single v2.0.0 bump at Phase 2.
- Core + telegram + http can be imported from separate packages after Phase 5.

## Decision points for the user

1. Do we start on Phase 1 now, or finish the current Conductor-UX polish in the PWA first? (My recommendation: Phase 1 now — every further UI feature is easier once events flow through the engine.)
2. Phase 4 feature ordering — which of `parallel variants`, `diff viewer`, `notifications` matters most for day-to-day use?
3. Naming — keep `@tprei/telegram-minions` forever, or plan the rename to `@tprei/minions` at Phase 5?
4. Package split at Phase 5 — worth the overhead, or fine to keep as one monorepo-published bundle with subpath exports?
