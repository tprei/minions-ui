# Minions engine — local Docker

## Run against this repo with a local PWA

This flow builds the engine image once, mounts your minions-ui checkout read-only at `/hostrepo`, mounts your host `~/.claude` for claude-CLI auth, and runs a local PWA via vite that proxies `/api` to the engine on `:8080`.

### 1. Build the image (one-time, ~5 min cold)

From the worktree root:

```sh
docker build -f docker/engine.Dockerfile -t minions-engine:test .
```

### 2. Create `docker/.env`

```sh
cd docker
cp .env.example .env
# then edit .env:
#   MINION_API_TOKEN=<any random string, e.g. openssl rand -hex 16>
#   ANTHROPIC_API_KEY=<your key>   # optional if ~/.claude is authenticated
```

`DEFAULT_REPO` is set to `file:///hostrepo` by `compose.dev.yaml` — leave it blank in `.env`.

### 3. Boot the engine

```sh
# from the worktree root
docker compose -f docker/compose.yaml -f docker/compose.dev.yaml up
```

The `compose.dev.yaml` override:
- pins the image to `minions-engine:test` (no rebuild unless you delete the tag)
- mounts `/home/prei/minions/minions-ui:/hostrepo:ro`
- mounts `~/.claude` into `/workspace/home/.claude` so the container reuses your claude login

Look for `[minion] engine on :8080, 0 sessions resumed` in the logs.

### 4. Sanity check (in another terminal)

```sh
TOKEN=$(grep MINION_API_TOKEN docker/.env | cut -d= -f2)
curl -s http://localhost:8080/api/version | jq
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/sessions | jq
```

### 5. Start the PWA

```sh
# from the worktree root, second terminal
npm run dev
```

Vite comes up on `http://localhost:3000`. Its `/api` proxy points at `http://localhost:8080`.

### 6. Connect the PWA

Open `http://localhost:3000`. In the connections drawer:
- **Label**: `local`
- **Base URL**: `http://localhost:8080`
- **Token**: the `MINION_API_TOKEN` from step 2

### 7. Run a task

In the chat input:

```
/task read the top-level README and summarize the repo in three bullets
```

The engine will:
1. Bare-clone `file:///hostrepo` into `/workspace/.repos/minions-ui.git` (first time, ~minutes for a large repo)
2. Add a git worktree at `/workspace/<slug>`
3. Bootstrap `node_modules` via hardlinked cache
4. Spawn `claude --print --output-format stream-json …` in the worktree
5. Stream `session.stream` events over SSE
6. Persist transcripts to `/workspace/engine.db`

The PWA renders the transcript as it arrives.

## Run with Codex

Prereq: run `codex login` on the host once. This stores credentials in `~/.codex`.

```sh
docker compose -f docker/compose.yaml -f docker/compose.codex.yaml up
```

The override sets `AGENT_PROVIDER=codex` and mounts `~/.codex` into the container. Same PWA, same API — no other changes. No API key required; Codex authenticates via your ChatGPT coding plan.

Build the image first if you haven't:

```sh
docker build -f docker/engine.Dockerfile -t minions-engine:local .
```

## Run with cloudflared tunnel

Add a `CLOUDFLARE_TUNNEL_TOKEN` to `.env`, then:

```sh
docker compose --profile tunnel up
```

## Agent auth in the container

### Claude

- **Preferred (dev)**: mount `~/.claude` — `compose.dev.yaml` already does this. Requires you've done `claude auth login` on the host.
- **Headless**: set `ANTHROPIC_API_KEY` in `docker/.env`. The CLI picks it up without a login.

Remove the `~/.claude` mount in `compose.dev.yaml` if you want full isolation per container.

### Codex

- **Only option**: mount `~/.codex` — `compose.dev.yaml` and `compose.codex.yaml` both do this. Requires you've run `codex login` on the host. There is no API key fallback; Codex auth is tied to your ChatGPT coding plan.

## Shared agent assets (`.agent-assets`)

The engine now injects shared agent config into each session worktree on both create and resume.

Resolution order:
- `MINION_AGENT_ASSETS_DIR` (explicit override)
- `<WORKSPACE_ROOT>/.agent-assets` (preferred shared location)
- `<WORKSPACE_ROOT>/.claude-assets` (legacy fallback)

Copy behavior:
- Recursively copies all files and directories into the worktree
- Never overwrites existing files in the worktree
- Works for both provider trees (for example `.claude/*`, `.codex/*`, hooks, agents, skills)

Instruction aliasing:
- If `AGENT.md` exists in assets, it is copied to both `AGENTS.md` and `CLAUDE.md` when missing
- If only one of `AGENTS.md` or `CLAUDE.md` exists in assets, it is mirrored to the other filename when missing

## Persistence

Everything the engine persists (sessions, transcripts, DAGs, bare clones, node_modules caches) lives inside the `workspace` volume:

- `/workspace/engine.db` — SQLite
- `/workspace/.repos/<repo>.git` — bare clones
- `/workspace/.repos/v3-<repo>-node_modules` — hardlink cache
- `/workspace/home/.claude` — claude auth
- `/workspace/<slug>` — per-session worktree

Kill and re-up the container: sessions with `running` or `waiting_input` status are restarted with `claude --resume <id>` on boot.

## Nuke and restart

```sh
docker compose -f docker/compose.yaml -f docker/compose.dev.yaml down -v
```

The `-v` flag drops the workspace volume — all sessions and caches gone. Skip it to preserve.
