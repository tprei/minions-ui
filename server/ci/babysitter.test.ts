import { describe, test, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { openDatabase, runMigrations } from "../db/sqlite"
import { createRealCIBabysitter } from "./babysitter"
import type { ExecFn } from "../dag/preflight"
import { createSessionRegistry } from "../session/registry"
import { resetEventBus } from "../events/bus"

const noDelay = (): Promise<void> => Promise.resolve()

function makeExecFn(
  responses: Array<{ stdout: string; stderr?: string } | Error>,
): ExecFn {
  let idx = 0
  return async () => {
    const next = responses[idx++]
    if (!next) return { stdout: "", stderr: "" }
    if (next instanceof Error) throw next
    return { stdout: next.stdout, stderr: next.stderr ?? "" }
  }
}

function seedSession(
  db: Database,
  id: string,
  prUrl: string | null,
  repo = "https://github.com/org/repo.git",
): void {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, bare_dir, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES (?, 'test-slug', 'completed', 'cmd', 'task', ?, null, null, ?, null, null, null, '/ws', ?, ?, 0, '[]', '[]', '[]', null, 0, '{}', 0)`,
    [id, repo, prUrl, now, now],
  )
}

describe("createRealCIBabysitter", () => {
  let db: Database

  beforeEach(() => {
    resetEventBus()
    db = openDatabase(":memory:")
    runMigrations(db)
  })

  test("babysitPR returns immediately when all checks pass", async () => {
    seedSession(db, "sess-1", "https://github.com/org/repo/pull/1")
    const registry = createSessionRegistry({ getDb: () => db })

    const mergeablePayload = JSON.stringify({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" })
    const viewPayload = JSON.stringify({
      title: "Test PR",
      state: "OPEN",
      mergeable: "MERGEABLE",
      updatedAt: "2024-01-01T00:00:00Z",
    })
    const checksPayload = JSON.stringify([
      { name: "ci/test", status: "completed", conclusion: "success", link: null },
    ])

    const exec = makeExecFn([
      { stdout: mergeablePayload },
      { stdout: viewPayload },
      { stdout: checksPayload },
    ])

    const babysitter = createRealCIBabysitter({
      registry,
      db,
      execFn: exec,
      maxRetries: 1,
      delayFn: noDelay,
    })
    await babysitter.babysitPR("sess-1", "https://github.com/org/repo/pull/1")
  })

  test("queueDeferredBabysit resolves immediately when pr_url is null", async () => {
    seedSession(db, "sess-no-pr", null)
    const registry = createSessionRegistry({ getDb: () => db })
    const babysitter = createRealCIBabysitter({ registry, db, delayFn: noDelay })
    await babysitter.queueDeferredBabysit("sess-no-pr", "parent-thread-1")
  })

  test("babysitDagChildCI delegates to babysitPR behaviour", async () => {
    seedSession(db, "sess-dag", "https://github.com/org/repo/pull/200")
    const registry = createSessionRegistry({ getDb: () => db })

    const mergeablePayload = JSON.stringify({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" })
    const viewPayload = JSON.stringify({
      title: "DAG PR",
      state: "OPEN",
      mergeable: "MERGEABLE",
      updatedAt: "2024-01-01T00:00:00Z",
    })
    const checksPayload = JSON.stringify([
      { name: "ci/lint", status: "completed", conclusion: "success", link: null },
    ])

    const exec = makeExecFn([
      { stdout: mergeablePayload },
      { stdout: viewPayload },
      { stdout: checksPayload },
    ])

    const babysitter = createRealCIBabysitter({
      registry,
      db,
      execFn: exec,
      maxRetries: 1,
      delayFn: noDelay,
    })
    await babysitter.babysitDagChildCI("sess-dag", "https://github.com/org/repo/pull/200")
  })

  test("aborts on terminal error (404)", async () => {
    seedSession(db, "sess-404", "https://github.com/org/repo/pull/404")
    const registry = createSessionRegistry({ getDb: () => db })

    const exec = makeExecFn([new Error("404: not found")])

    const babysitter = createRealCIBabysitter({
      registry,
      db,
      execFn: exec,
      maxRetries: 3,
      delayFn: noDelay,
    })
    await babysitter.babysitPR("sess-404", "https://github.com/org/repo/pull/404")
  })
})
