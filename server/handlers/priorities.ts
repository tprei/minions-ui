/**
 * Centralised execution-order constants for `session.completed` handlers.
 *
 * `CompletionDispatcher` invokes registered handlers in ASCENDING priority
 * order (lower number runs earlier). Handlers must reference one of the
 * constants below instead of inlining a magic number so the ordering contract
 * is auditable in a single file.
 *
 * Tiers are spaced by 10 to leave room for new handlers without renumbering
 * existing ones.
 *
 * Ordering invariants — read these before changing a value:
 *
 *  1. OBSERVE (0) runs first.
 *     Handlers in this tier read or persist terminal session state, drain
 *     in-memory queues, and emit derived events. They MUST NOT depend on
 *     side effects from any later tier. `parent-notify` lives here so the
 *     DAG scheduler observes the terminal state before any retry/advance
 *     handler can mask it.
 *
 *  2. RECORD (10) runs after OBSERVE.
 *     Append-only bookkeeping (e.g. `session_stats` rows) and post-hoc
 *     status checks (`restack-resolver` validates rebase outcome and pushes).
 *     Must run after OBSERVE because `restack-resolver` emits
 *     `dag.node.pushed` based on the SHA captured by the observer.
 *
 *  3. RETRY (20) runs before any ADVANCE.
 *     Reschedules the session on transient failure (e.g. `quota_exhausted`).
 *     Must precede ADVANCE so a quota-blocked ship-think is not advanced to
 *     ship-plan.
 *
 *  4. ADVANCE (30) runs after RETRY.
 *     Pipeline progression (`ship-think` → `ship-plan` → `ship-do`). Only
 *     fires on `state === 'completed'`, which makes it disjoint from RETRY
 *     in practice, but the ordering is preserved as a safety net.
 *
 *  5. EMIT_MODE (40) runs after ADVANCE.
 *     Emits `session.mode_completed`. Sequenced last among single-purpose
 *     handlers so downstream listeners see post-advance state.
 *
 *  6. LOOP (50) runs after EMIT_MODE.
 *     Records loop outcome and closes the session. Depends on EMIT_MODE so
 *     loop scheduler subscribers see the mode-completed signal first.
 *
 *  7. TASK (60) runs last.
 *     Composite that fans out to quality gates, digest, and CI babysit for
 *     `mode === 'task'` sessions. Intentionally last because it triggers
 *     side effects (PR comments, CI polling) that should not race with
 *     OBSERVE-tier state capture.
 */
export const HANDLER_PRIORITIES = {
  OBSERVE: 0,
  RECORD: 10,
  RETRY: 20,
  ADVANCE: 30,
  EMIT_MODE: 40,
  LOOP: 50,
  TASK: 60,
} as const

export type HandlerPriority = (typeof HANDLER_PRIORITIES)[keyof typeof HANDLER_PRIORITIES]
