# Two-repo PRs: telegram-minions + minions-ui

Some features cross the server/client boundary: a new SSE event variant, a new HTTP endpoint, a new capability flag. This doc describes how to land those without breaking any live deployment of either repo.

## Axioms

- `minions-ui` is hosted on Cloudflare Pages at a single origin; it talks to N different `@tprei/telegram-minions` deployments, each of which may run a **different library version**.
- Library deployments update on the user's schedule, not ours. Expect version skew in the wild.
- The UI cannot detect a missing server feature by catching 404s after the fact — that's a bad UX. It must know in advance. Hence `GET /api/version` returning a `features: string[]`.

## The order of operations

Land changes in this order, one PR at a time:

1. **Library PR** in `telegram-minions`.
   - Add the new endpoint, SSE event variant, or capability.
   - Advertise it in `GET /api/version` `features` — e.g. `"messages"`, `"auth"`, `"cors-allowlist"`, `"file-upload"`.
   - Tests required.
   - Merge + tag. Publish a new `@tprei/telegram-minions` version to GitHub Packages.
2. **Consumer bump PRs** in `meta-minion` and `pixwise-minion`.
   - Single-commit version bump, one PR per consumer.
   - Deploy to fly.io after merge. Confirm the new version responds.
3. **UI PR** in `minions-ui`.
   - Cite the library PR URL in the PR description.
   - Gate the new capability behind `store.version.value?.features.includes('<feature>')`.
   - If the feature is missing, show "Needs library ≥ X.Y — your minion reports version {libraryVersion}" near the affected UI.
   - Tests required, including a test that asserts the gated-off path when `features` doesn't include the flag.
4. **Remove the gate** in a follow-up PR once all active deployments have upgraded (track via `GET /api/version` across your fleet).

## Never do

- **Don't** land a UI PR referencing a server feature that hasn't shipped. Even with a gate, having untested paths in the UI is a landmine.
- **Don't** change the `/api/version` `apiVersion` string for additive changes. Bump `libraryVersion` (natural from npm), extend `features`. Only bump `apiVersion` for **breaking** protocol changes (an SSE event variant that has a semantic rename, a commands envelope reshape).
- **Don't** branch off `/api/version.libraryVersion` as a proxy for feature support. Two deployments at the same library version can have different `features` if env-gated.
- **Don't** add feature flags in `minions-ui` that have no server counterpart. The `features` array is the single source of truth.

## Capability flag naming

- Use kebab-case: `cors-allowlist`, `file-upload`, `sse-ticket`, `read-only-token`.
- Add the flag in the same PR as the feature. Never advertise a flag without implementing the behavior.
- Remove deprecated flags only in a new `apiVersion` bump.

## Current `features` advertised by the library (as of v1.110.x)

- `messages` — `POST /api/messages` with slash-command parsing
- `auth` — `Authorization: Bearer` + `?token=` query param
- `cors-allowlist` — `CORS_ALLOWED_ORIGINS` env var echoes allowlisted origins

## Library version bumps

The library is published to GitHub Packages as `@tprei/telegram-minions`. Consumers (`meta-minion`, `pixwise-minion`) pin via `package.json`. A version bump is a one-line PR per consumer. Deploy to fly.io after merge.

## Rollback

If a library release breaks the UI:

1. Revert the consumer bump PRs and redeploy (fast; minutes).
2. Revert the library PR on `master` (protective for any consumer that hasn't updated yet).
3. Fix forward in a new library PR; loop again.

The UI is idempotent to library downgrades as long as `apiVersion` stays the same — stale `features` entries just gate off newer capabilities and the UI falls back to an older path or a "needs library ≥ X.Y" message.

## Cross-repo PR linking conventions

In the UI PR description:

```
Depends on:
- <library-pr-url>
- <meta-minion-bump-pr-url>
- <pixwise-minion-bump-pr-url>
```

In the library PR description:

```
UI consumer: <minions-ui-pr-url> (follows after version publish)
```

Keep the links even after merge — they're useful for archaeology.
