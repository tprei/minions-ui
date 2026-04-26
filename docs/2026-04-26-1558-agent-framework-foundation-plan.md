# Agent framework foundation plan

## Scope

Build the foundation for the competitive takeaways:

- Add a repo-owned `minions.json` contract for quality gates and merge policy.
- Run configured gates as the source of truth for completed sessions.
- Expose merge readiness through the API.
- Show readiness inside the existing PR review surface.

## Follow-on slices

- Checkpoints and rollback per session turn and DAG node.
- GitHub issue, PR comment, Linear, and Slack entry points.
- Provider capability routing UI and per-task policy controls.
- Readiness analytics across repos, modes, providers, and DAGs.
- Governance hardening for permissions, secrets, network policy, and audit history.
