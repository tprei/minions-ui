# Resilience and responsive UX plan

## Goals

- Keep advertised server capabilities aligned with the UI feature gates.
- Make session creation and command responses give the client enough data for immediate navigation and feedback.
- Recover resumable agent sessions after engine restarts instead of marking all non-ship sessions failed.
- Reconnect stalled SSE streams on mobile resume and proxy keepalive gaps.
- Avoid surprise PWA reloads while a user is conducting from a phone.

## Implementation steps

1. Fix API feature flags and `POST /api/sessions` to return a full `ApiSession`.
2. Wire `ship_advance` through the ship coordinator and return command failure details when advancement is invalid.
3. Make ship `plan -> dag` schedule the DAG from the coordinator's plan output, and move completed DAGs into verification.
4. Surface unsuccessful command results in the connection store so the UI shows a retryable error instead of silently proceeding.
5. Add a client SSE heartbeat watchdog that observes server keepalives and reconnects after a quiet window.
6. Resume any running session with a provider session id during `reconcileOnBoot`, and keep non-resumable sessions on the current interrupted path.
7. Replace automatic service-worker reloads with an update/offline-ready banner.
8. Update focused tests for the changed contracts and run the baseline gate.
