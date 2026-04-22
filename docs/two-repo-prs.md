# Monorepo workflow (legacy: two-repo PRs)

**Note:** This doc describes the legacy workflow when the engine and UI were in separate repos. As of April 2026, this is a monorepo — the engine lives in `server/`, the UI in `src/`. Changes spanning both should be done in a single PR.

The sections below are kept for historical context and may be useful if you need to understand the versioning and feature-flag patterns that remain in the codebase.

## Axioms

- `minions-ui` is hosted on Cloudflare Pages at a single origin; it talks to N different engine deployments, each of which may run a **different version**.
- Library deployments update on the user's schedule, not ours. Expect version skew in the wild.
- The UI cannot detect a missing server feature by catching 404s after the fact — that's a bad UX. It must know in advance. Hence `GET /api/version` returning a `features: string[]`.

## The order of operations

Land changes in this order, one PR at a time:

1. **Engine changes** in `server/`.
   - Add the new endpoint, SSE event variant, or capability.
   - Advertise it in `GET /api/version` `features` — e.g. `"messages"`, `"auth"`, `"cors-allowlist"`, `"file-upload"`.
   - Tests required.
2. **UI changes** in `src/`.
   - Gate the new capability behind `store.version.value?.features.includes('<feature>')`.
   - If the feature is missing, show "Needs engine ≥ X.Y — your minion reports version {libraryVersion}" near the affected UI.
   - Tests required, including a test that asserts the gated-off path when `features` doesn't include the flag.
3. **Remove the gate** in a follow-up PR once all active deployments have upgraded (track via `GET /api/version` across your fleet).

## Never do

- **Don't** ship UI code referencing a server feature that hasn't shipped. Even with a gate, having untested paths in the UI is a landmine.
- **Don't** change the `/api/version` `apiVersion` string for additive changes. Bump `libraryVersion` (natural from npm), extend `features`. Only bump `apiVersion` for **breaking** protocol changes (an SSE event variant that has a semantic rename, a commands envelope reshape).
- **Don't** branch off `/api/version.libraryVersion` as a proxy for feature support. Two deployments at the same library version can have different `features` if env-gated.
- **Don't** add feature flags in `minions-ui` that have no server counterpart. The `features` array is the single source of truth.

## Capability flag naming

- Use kebab-case: `cors-allowlist`, `file-upload`, `sse-ticket`, `read-only-token`.
- Add the flag in the same PR as the feature. Never advertise a flag without implementing the behavior.
- Remove deprecated flags only in a new `apiVersion` bump.

## Current `features` advertised by the server

The minions-ui server advertises these features via `GET /api/version`:

- `sessions-create` — `POST /api/sessions` for creating sessions
- `messages` — `POST /api/messages` with slash-command parsing
- `transcript` — `GET /api/sessions/:slug/transcript` for paginated transcript events
- `auth` — `Authorization: Bearer` + `?token=` query param
- `cors-allowlist` — `CORS_ALLOWED_ORIGINS` env var echoes allowlisted origins
- `dag` — DAG endpoints and SSE events
- `ship-pipeline` — `/ship` mode with judge/verify stages
- `variants` — `POST /api/sessions/variants` for parallel session creation
- `push` — Web Push notifications via VAPID
- `screenshots` — Playwright screenshot capture and retrieval
- `diff` — `GET /api/sessions/:slug/diff` for workspace diffs
- `pr-preview` — `GET /api/sessions/:slug/pr` for PR metadata
- `resource-tracking` — CPU/memory/disk metrics via SSE
- `runtime-config` — `GET/PATCH /api/config/runtime` for runtime overrides

## Version bumps (legacy)

In the legacy split-repo setup, the engine was published as a library. In the monorepo, version tracking happens via `package.json` in the root.

## Rollback

If an engine release breaks the UI:

1. Revert the commit and redeploy.
2. Fix forward in a new PR.

The UI is idempotent to engine downgrades as long as `apiVersion` stays the same — stale `features` entries just gate off newer capabilities and the UI falls back to an older path or a "needs engine ≥ X.Y" message.

## PR conventions (monorepo)

For changes spanning `server/` and `src/`, ensure both sides are tested together in the same PR. No need for cross-linking — it's all in one commit.
