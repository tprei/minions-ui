# minions-ui — agent guidance

## Model routing

| Role | Model | Typical agents |
|---|---|---|
| Planning, architecture, research | `opus` | `planner`, `explorer`, `technical-architect` |
| Implementation | `sonnet` | `general-purpose` for feature work, `ci-fix` for CI |
| Commits, mechanical chores | `haiku` | `git-commit-specialist` |

Always set the `model` parameter explicitly when spawning via the `Agent` tool.

If an implementation agent encounters ambiguity, unresolved design questions, or an architectural decision — **stop implementing** and return to the planning loop with an opus-tier agent. Do not guess inline.

## Branch and PR workflow

- Branch naming: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `docs/<scope>`. Examples: `feat/install-prompt`, `fix/sse-reconnect-backoff`.
- One feature per branch. Open a PR; land via squash-merge.
- Commit messages follow conventional commits: `feat(ui): ...`, `fix(api): ...`.
- Never add "Generated with Claude Code" / co-author tags / "committed by agent" verbiage.
- PR description: what changed, why, how to validate. Link to any cross-repo PR (see `docs/two-repo-prs.md`).

## Worktree hygiene

If multiple agents may run concurrently in this repo, each should work in its own git worktree + branch to avoid conflicts:

```sh
git worktree add ../minions-ui-<branch> <branch>
```

Delete the worktree after the PR merges.

## Coordinated PR workflow

When a feature spans `telegram-minions` + `minions-ui`:

1. Library PR in `telegram-minions` lands first.
2. Publish a new `@tprei/telegram-minions` version.
3. Chain version-bump PRs through `meta-minion` and `pixwise-minion`.
4. UI PR in `minions-ui` cites the library PR URL in its description.
5. While mixed library versions are in the wild, gate the UI feature on `/api/version.features` rather than library version numbers.

Full rules: `docs/two-repo-prs.md`.

## Available agents (global)

Configured in your `~/.claude/CLAUDE.md`:

| Agent | Purpose |
|---|---|
| `planner` (opus) | Break down ambiguous features into ordered implementation steps |
| `explorer` (opus) | Read-only codebase exploration, call chains, data flow |
| `technical-architect` (opus) | Cross-cutting system design, performance, refactors |
| `general-purpose` (sonnet) | Feature implementation, bug fixes |
| `ci-fix` (sonnet) | Fix CI failures on an existing PR branch |
| `git-commit-specialist` (haiku) | Commits, pushes, PRs |
| `Explore` (built-in) | Fast codebase exploration |
| `claude-code-guide` | Questions about the Claude Code CLI, Agent SDK, or Anthropic API |

## Skills (global)

- `/prepare` — pack relevant code context via repomix before planning or exploring.
- `/commit` — run quality checks, generate summary, route to git specialist.
- `/review` — review a PR for bugs, security, correctness.
- `/explore` — deep codebase exploration.
- `/tmux-specialist` — quick tmux reference.

Always `/prepare` before entering plan mode unless the user provided a repomix bundle in the prompt.

## Evidence-driven implementation

- Read the files you intend to change. Build context with `rg`, `git ls-files`, and file reads before writing.
- Run existing tests before and after your change.
- `npm run typecheck && npm run lint && npm run test` is the baseline gate.
- **Skip Playwright locally.** Do not run `npm run test:e2e` / `npx playwright test` as part of routine validation — the CI `e2e` matrix (`.github/workflows/ci.yml`) runs it on every push and PR. Push the branch and let CI cover it. Only run Playwright locally when the user explicitly asks, or when debugging a specific E2E failure they've flagged.
- Type-check or lint failures are blockers — never bypass with `eslint-disable` / `@ts-ignore`.

## Finish implementations

- Don't stop halfway. Don't leave TODOs. Don't add "Fix 1:", "Update:", or "Change 2:" meta-comments in code.
- Don't add speculative methods. Implement only what the task requires.
- Don't add fallbacks that hide bugs. Find the root cause.
