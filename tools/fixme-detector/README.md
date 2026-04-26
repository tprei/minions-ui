# fixme-detector

Standalone host process that watches the engine's SSE stream for `#fixme` tags
in user messages, eagerly captures a minimum-viable record (MVR) the moment a
tag is seen, then asynchronously enriches the record with the full transcript,
associated DAGs, and a workspace diff.

Runs outside the engine container so `docker compose up` doesn't churn it and
captures survive `docker compose down -v`.

## Why eager capture

`registry.close()` is destructive: closing a session in the PWA cascades to a
permanent delete of `session_events`. Lazy enrichment loses the transcript the
moment a user clicks close. The detector therefore writes `record.json`
synchronously from the SSE event payload, then enriches in the background.

## Storage layout

Records are written to `.fixme/` at the repo root:

```
.fixme/
  pending/<iso>-<slug>-<shortid>/
    record.json         MVR + enrichment status
    transcript.json     full snapshot if available
    dag.json            associated DAGs (filtered by sessionId)
    diff.patch          workspace git diff if the session has a workspace
    summary.md          human-readable rendering
  in-progress/...
  done/...
  wontfix/...
  .captured.jsonl       append-only dedup log: {sessionId, seq, capturedAt}
```

Each fixme is its own directory so a `/loop` consumer can `mv pending/X
in-progress/X` atomically.

## Tag syntax

Single regex, case-insensitive: `(?:^|\s)#fixme(?:\(([^)]+)\))?(?::?\s+(.*))?`

- `#fixme` — bare tag, body = entire message
- `#fixme: dag rebase loops` — body = "dag rebase loops"
- `#fixme(ui): close button doesn't work` — scope = `ui`, body after colon

Dedup is per `(sessionId, seq)` so re-emitted SSE events don't double-capture.

## Configuration

The detector reads `MINION_API_TOKEN` from `docker/.env` at startup (or from
the environment if exported). Optional overrides:

- `MINION_API_URL` — base URL for the engine. Defaults to
  `http://localhost:${ENGINE_PORT}` (8080).
- `MINION_API_TOKEN` — bearer token. Required.

## Running

From the repo root:

```sh
npm run fixme:detector
```

Or directly:

```sh
npx tsx tools/fixme-detector/index.ts
```

Auto-restart with tmux:

```sh
tmux new-session -d -s fixme-detector 'cd /home/minions/meta-minion && npm run fixme:detector'
```

User-level systemd unit (`~/.config/systemd/user/fixme-detector.service`):

```ini
[Unit]
Description=meta-minion fixme detector
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/minions/meta-minion
ExecStart=/usr/bin/env npm run fixme:detector
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now fixme-detector
journalctl --user -u fixme-detector -f
```

## Resilience

- **MVR-first-then-enrich.** The trigger SSE payload contains everything
  required to act on the fixme. If the user closes the session 50ms after
  typing `#fixme`, the MVR is already on disk; enrichment marks
  `transcript: "missing"` (404) but the record stays actionable.
- **Reconnect gap-fill.** SSE only replays transcript events for active
  sessions. On every successful reconnect, the detector calls `/api/sessions`
  and `/api/sessions/:slug/transcript?after=<lastSeenSeq>` for each, then
  matches the regex against new events.
- **Backoff.** Full-jitter exponential:
  `delay = floor(random() * min(30000, 500 * 2 ** attempt))`.
- **Restart.** `seenSeq` is rebuilt at startup from `.captured.jsonl`. The
  initial gap-fill scan covers anything captured-but-newly-seq'd while the
  detector was down.

## Verification

1. Start the engine (`cd docker && docker compose up`).
2. Start the detector (`npm run fixme:detector`).
3. In any active session, type `#fixme test capture`.
4. Within ~1s, `.fixme/pending/` should contain a new directory with all four
   files populated and `enrichment.transcript === "ok"`.

For survives-close, type `#fixme racing close` then click close in the PWA
within 200ms. Confirm `record.json` exists with the trigger captured; expect
`enrichment.transcript === "missing"` but the MVR is intact.

## /loop consumer

Out of scope for this directory. The consumer reads `pending/`, picks the
oldest record, checks out the session's `branch`, works on the issue described
in `trigger.tagBody` (or `trigger.text` if body is empty), and on completion
moves the directory to `done/` (or `wontfix/` with `reason.md`).
