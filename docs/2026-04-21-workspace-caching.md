# Workspace caching — old engine → new engine preservation plan

Source: `server/src/session/session-manager.ts`, `server/src/session/session.ts`, `Dockerfile`, `docker-compose.yml`, meta/pixwise minion `Dockerfile` + `entrypoint.sh` + `fly.toml`.

## 0. SECURITY — rotate immediately

`meta-minion/.npmrc` and `pixwise-minion/.npmrc` commit a plaintext `gho_...` GitHub token on line 2 of each. The files are byte-identical. `pixwise-minion/entrypoint.sh:13-16` already writes `.npmrc` at runtime from `$GITHUB_TOKEN`, so the committed copy is redundant. **Action**: rotate the token on GitHub, `.gitignore` both `.npmrc` files, ensure both minions' `entrypoint.sh` writes it from env.

## 1. Workspace root and per-session layout

- `WORKSPACE_ROOT` env. Default `/workspace` in-image (`config/config-env.ts:82`), `./.minion-data` local (`config/local-defaults.ts:86-89`). Fly/compose set `/workspace` explicitly.
- Per-session dir: `${WORKSPACE_ROOT}/<slug>` (`session-manager.ts:202`).
- **Bare cache**: `${WORKSPACE_ROOT}/.repos/<repoName>.git` (`session-manager.ts:206-210`).
  - First session: `git clone --bare` (line 222, 120s timeout).
  - Subsequent: `git fetch --prune origin +refs/heads/*:refs/heads/*` excluding refs held by live worktrees (`fetchBareRepo`, lines 174-189).
- **Each session is a `git worktree`** (not a full clone). Branch `minion/<slug>` (line 235). `git worktree add <workDir> -b <branch> <startRef>` (lines 255-258). Origin reset to the real `repoUrl` after add (line 260).
- **Teardown** (`removeWorkspace`, lines 281-324): `restoreWritePermissions` → `git worktree remove --force` → `git branch -D`. Falls back to `fs.rmSync`.
- **Stale collisions** force-removed + `git worktree prune` + `git branch -D` before re-add (lines 240-252).

## 2. Dependency caches (current)

| Cache | Location | Population | Scope |
|---|---|---|---|
| node_modules | `${WORKSPACE_ROOT}/.repos/v2-<repoName>-node_modules/` hardlinked to `<workDir>/node_modules` via `cp -al` | `npm ci --prefer-offline` or `npm install` (600s), then `cp -al`, then `chmod -R a-w`. Keyed on SHA-256(package-lock.json). `CACHE_VERSION = "v2"` prefix = manual bust knob. | Shared per-repo, hardlinked per-session. |
| Devtools fallback node_modules | `/opt/devtools/node_modules` (in image, `vitest typescript happy-dom jsdom`) → hardlinked to `${WORKSPACE_ROOT}/node_modules` via `ensureDevtoolsFallback` | Image build. `.devtools-version` sha gates re-copy. | Shared across workspace. |
| Python venv | `${WORKSPACE_ROOT}/.repos/<cacheKey>-venv` hardlinked to `<workDir>/.venv` | `uv sync` or `uv venv && uv pip install -r requirements.txt`. Keyed on SHA-256(uv.lock) or SHA-256(requirements.txt). **No CACHE_VERSION prefix — bug.** | Shared per-repo. |
| UV wheel cache | `UV_CACHE_DIR=<sessionHome>/.cache/uv` | Per session, `UV_LINK_MODE=copy`. | **Per-session — missed optimization. Should be shared.** |
| Managed Python | `UV_PYTHON_INSTALL_DIR=/opt/uv-python` (3.13 at build). `UV_PYTHON_PREFERENCE=only-managed`. | Image only. | Shared read-only. |
| UV tools (pytest/ruff/mypy) | `/opt/uv-tools/bin` on PATH | Image only. | Shared read-only. |
| Playwright browsers | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` | `npx playwright install --with-deps chromium` at image build. chown'd to `minion`. | Shared read-only. |
| Claude CLI auth | Host `~/.claude` → `/workspace/home/.claude` (compose bind-mount / fly persistent volume `HOME=/workspace/home`). `CLAUDE_CONFIG_DIR=<parentHome>/.claude`. Session copies `settings.json` into per-session `.home/.claude/`. | Manual `claude auth login` once on first container boot. | Shared. |
| `~/.cache`, `~/.config`, `~/.local/share` | Per-session `<workDir>/.home/...` via `XDG_*` env. | Fresh each session. | Per-session (isolated). |
| Git credentials | Container: `/app/scripts/setup-git.sh` sets `credential.helper`. Per-session `/tmp/minion-git-askpass.sh` generated from `$GITHUB_TOKEN_FILE` or `$GITHUB_TOKEN`. | Once per container boot. | Shared (per-container). |

## 3. Bootstrap sequence (new session on meta-minion)

`prepareWorkspace(slug, workspaceRoot, repoUrl)` (`session-manager.ts:196`):

1. `mkdir -p ${WORKSPACE_ROOT}/.repos`.
2. `git clone --bare <repoUrl> <bareDir>` if absent (120s).
3. `git fetch --prune` excluding refs held by live worktrees.
4. Clean stale worktree + `minion/<slug>` branch.
5. `git worktree add <workDir> -b minion/<slug> <startRef>`.
6. `git remote set-url origin <repoUrl>` in worktree.
7. `ensureDevtoolsFallback(workspaceRoot)`.
8. `bootstrapDependencies(workDir, reposDir, repoName)`:
   - If `package.json`: `bootstrapOnePackage` — hash check → `cp -al <cache> <workDir>/node_modules` (300s) or `npm ci --prefer-offline` (600s ×2 attempts), then `cp -al` to cache, then `chmod -R a-w`.
   - `bootstrapPythonDependencies` — `uv sync` or `uv venv + uv pip install`, hash-gated hardlink.
   - Walks immediate child dirs (monorepo packages).
9. Session spawn — isolated env, `injectAgentFiles`, `spawn("claude" | "goose", ...)` with cwd `<workDir>`.
10. On reply/resume: `rebootstrapDependencies` runs only if `node_modules` / `.venv` are missing.

Cold path: up to ~10 min of installs. Warm (hardlink): seconds.

## 4. What each minion expects

### meta-minion
- Dockerfile installs `@anthropic-ai/claude-code`, `@zed-industries/claude-agent-acp`, `@playwright/mcp`, `@upstash/context7-mcp`, `github-mcp-server`, `vitest`, `typescript`. Playwright at `/opt/pw-browsers`.
- Legacy: depended on engine as `@tprei/telegram-minions ^1.118.8`. Now uses monorepo `server/`.
- `entrypoint.sh` copies `/app/agents`, `/app/.claude/settings.json`, `/app/.claude/CLAUDE.md` into `/workspace/home/.claude/`. Runs as `minion`.
- Has `.npmrc` (committed, LEAKS TOKEN), `package-lock.json`. No `.nvmrc`, `.tool-versions`, `pyproject.toml`, `poetry.lock`, `uv.lock`, `bun.lock`.
- Fly: `workspace_data` 10GB at `/workspace`, `HOME=/workspace/home`.

### pixwise-minion
- Same Dockerfile shape minus `github-mcp-server` npm install (uses Go binary instead).
- Legacy: depended on engine as `@tprei/telegram-minions ^1.113.0`. Now uses monorepo `server/`.
- `entrypoint.sh` additionally writes `/workspace/home/.npmrc` and `/workspace/home/.git-credentials` at runtime from env. **This is the right pattern.**
- Same version pin gaps.

Neither minion ships Python / playwright / uv locks of its own; those caches exist to serve *target repos the minion operates on*.

## 5. Preservation plan for the new Bun+Docker engine

### Docker volume layout
- **One volume at `/workspace`.** Don't split — `cp -al` hardlinks require same filesystem.
- Baked image paths (read-only, no volume): `/opt/pw-browsers`, `/opt/uv-python`, `/opt/uv-tools`, `/opt/devtools`. All chown'd to `minion`.
- `HOME=/workspace/home` for Claude auth persistence.

### Per-session
- `${WORKSPACE_ROOT}/<slug>` as `git worktree` off `${WORKSPACE_ROOT}/.repos/<repo>.git` bare.
- Branch `minion/<slug>` (preserve naming — downstream heuristics grep for it).

### node_modules
- Preserve SHA-256(lock)-keyed `cp -al` hardlink cache exactly.
- Preserve `chmod -R a-w` on cached copy, `restoreWritePermissions` before teardown.
- **Add `bun.lock` / `pnpm-lock.yaml` detection** to the install dispatcher. Current code only keys off `package-lock.json` (line 412).
- Do NOT transparently swap `npm` for `bun install` in target repos — would desync locks.

### Playwright
- Pre-warm in image with `npx playwright install --with-deps chromium` at build time.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` propagated into every session env.
- Don't try to cache per-volume — `--with-deps` installs apt packages that belong in the image.

### Python / uv
- **Move `UV_CACHE_DIR` from per-session to shared** `/workspace/.uv-cache`. Switch `UV_LINK_MODE=copy` → `hardlink`.
- Keep `.venv` hardlink-from-cache flow.
- **Add `CACHE_VERSION` prefix** to Python venv cache (currently missing — bug).
- Keep `UV_PYTHON_INSTALL_DIR=/opt/uv-python` and `UV_PYTHON_PREFERENCE=only-managed` baked in.

### Claude auth
- Keep `HOME=/workspace/home` + `CLAUDE_CONFIG_DIR=$HOME/.claude`.
- Session inherits via copy of `settings.json` into per-session `.home/.claude/`.
- Dev: keep `~/.claude` bind mount in compose.

### Git credentials
- Runtime-write pattern from pixwise's `entrypoint.sh:13-24` is canonical. Adopt everywhere.
- Keep per-session askpass (`session-manager.ts:140-162`) with `GITHUB_TOKEN_FILE` polling for token rotation.
- **Revoke & gitignore the committed `.npmrc` in both minion repos.**

### Non-root
- `claude-agent-acp` SIGKILLs under root. Keep the `minion` user (uid 10001) and chown shim.

### CACHE_VERSION
- Bump to `v3` on cutover to force a clean bootstrap (safety against any subtle behavior change in `cp -al` semantics under Bun).

## 6. UNCLEAR / follow-ups

- **Bun `spawn` process-group behavior**. Old engine relies on `process.kill(-pid, signal)` against detached children (`session-manager.ts:653`). Verify Bun's `Bun.spawn` with `detached: true` or `node:child_process.spawn` under Bun produces PGIDs the same way, and that `process.kill(-pid, ...)` works. Test before finalizing.
- **`claude-agent-acp` refuses root** — carry the shim forward.
- **Hardlink + chmod a-w interaction** — hardlinks share inodes, so `chmod` on one copy affects all. `restoreWritePermissions` before teardown is load-bearing. Test under Bun.
- **`.nvmrc` / `.tool-versions` missing** in client minions — rely on image `FROM node:22-slim`. Match Node ABI.
- **`cleanBuildArtifacts`** (line 794) gets called on some paths. New engine must invoke before `/close` so shared cache isn't polluted by per-session escapes.
