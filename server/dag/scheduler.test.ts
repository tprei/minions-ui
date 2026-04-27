import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { buildDag } from "./dag"
import { saveDag, loadDag } from "./store"
import { createDagScheduler } from "./scheduler"
import { registerDagCompletionHandler } from "../handlers/dag-completion-handler"
import { EngineEventBus } from "../events/bus"
import { openDatabase, prepared, runMigrations } from "../db/sqlite"
import { buildVerifyDirective } from "../ship/verification"
import type { SessionRegistry, CreateSessionOpts } from "../session/registry"
import type { SessionRuntime } from "../session/runtime"
import type { ApiSession } from "../../shared/api-types"

function makeTestDb(): Database {
  const db = openDatabase(":memory:")
  runMigrations(db)
  return db
}

function makeSession(id: string, db?: Database): ApiSession {
  const session: ApiSession = {
    id,
    slug: `test-${id}`,
    status: "running",
    command: "test",
    repo: "https://github.com/org/repo",
    branch: `minion/test-${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: "dag-task",
    conversation: [],
  }
  if (db) {
    const now = Date.now()
    prepared.insertSession(db, {
      id,
      slug: session.slug,
      status: "running",
      command: session.command,
      mode: session.mode,
      repo: session.repo ?? null,
      branch: session.branch ?? null,
      bare_dir: null,
      pr_url: null,
      parent_id: null,
      variant_group_id: null,
      claude_session_id: null,
      workspace_root: null,
      created_at: now,
      updated_at: now,
      needs_attention: false,
      attention_reasons: [],
      quick_actions: [],
      conversation: [],
      quota_sleep_until: null,
      quota_retry_count: 0,
      metadata: {},
      pipeline_advancing: false,
      stage: null,
      coordinator_children: [],
    })
  }
  return session
}

function insertShipRoot(db: Database, id: string, stage: "think" | "plan" | "dag" | "verify" | "done"): void {
  const now = Date.now()
  prepared.insertSession(db, {
    id,
    slug: id,
    status: "running",
    command: "ship this",
    mode: "ship",
    repo: "https://github.com/org/repo",
    branch: "minion/ship-root",
    bare_dir: null,
    pr_url: null,
    parent_id: null,
    variant_group_id: null,
    claude_session_id: "thread-ship-root",
    workspace_root: "/tmp/workspace",
    created_at: now,
    updated_at: now,
    needs_attention: false,
    attention_reasons: [],
    quick_actions: [],
    conversation: [],
    quota_sleep_until: null,
    quota_retry_count: 0,
    metadata: {},
    pipeline_advancing: false,
    stage,
    coordinator_children: [],
  })
}

function makeRegistry(db: Database, createFn?: (opts: CreateSessionOpts) => Promise<{ session: ApiSession; runtime: SessionRuntime }>) {
  const registry: SessionRegistry = {
    create: createFn ?? (async () => ({ session: makeSession("mock-session-" + Math.random().toString(36).slice(2), db), runtime: {} as SessionRuntime })),
    get: () => undefined,
    getBySlug: () => undefined,
    list: () => [],
    snapshot: () => undefined,
    stop: async () => undefined,
    close: async () => undefined,
    reply: async () => true,
    reconcileOnBoot: async () => undefined,
    scheduleQuotaResume: async () => undefined,
  }
  return registry
}

describe("DagScheduler", () => {
  let db: Database
  let bus: EngineEventBus
  let stackCommentCallCount: number

  beforeEach(() => {
    db = makeTestDb()
    bus = new EngineEventBus()
    stackCommentCallCount = 0
  })

  function makeScheduler(registry: SessionRegistry) {
    return createDagScheduler({
      registry,
      db,
      bus,
      workspace: "/tmp",
      ciBabysitter: {
        babysitPR: async () => {},
        queueDeferredBabysit: async () => {},
        babysitDagChildCI: async () => {},
      },
      updateStackComment: async () => { stackCommentCallCount++ },
    })
  }

  it("spawns ready nodes when dag starts", async () => {
    const graph = buildDag("dag-1", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: [] },
      { id: "c", title: "Task C", description: "C", dependsOn: ["a", "b"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const created: string[] = []
    const registry = makeRegistry(db, async (opts) => {
      const session = makeSession(`session-${created.length}`, db)
      created.push(opts.prompt.slice(0, 40))
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-1")

    expect(created).toHaveLength(2)
  })

  it("passes the DAG's repo URL to registry.create after save/load round-trip", async () => {
    const repoUrl = "https://github.com/org/repo"
    const graph = buildDag("dag-repo", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", repoUrl)
    saveDag(graph, db)

    const repos: string[] = []
    const registry = makeRegistry(db, async (opts) => {
      repos.push(opts.repo)
      return { session: makeSession("s-" + opts.prompt, db), runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-repo")

    expect(repos).toEqual([repoUrl])
  })

  it("respects MAX_DAG_CONCURRENCY limit", async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      title: `Task ${i}`,
      description: `Task ${i} desc`,
      dependsOn: [] as string[],
    }))
    const graph = buildDag("dag-big", nodes, "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    let concurrent = 0
    let maxConcurrent = 0

    const registry = makeRegistry(db, async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise<void>((r) => setTimeout(r, 0))
      concurrent--
      return { session: makeSession("s" + Math.random(), db), runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-big")

    expect(maxConcurrent).toBeLessThanOrEqual(4)
  })

  it("advances downstream nodes after session completes", async () => {
    const graph = buildDag("dag-chain", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const createdSessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`session-${createdSessions.length}`, db)
      createdSessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-chain")

    expect(createdSessions).toHaveLength(1)

    await scheduler.onSessionCompleted(createdSessions[0]!, "completed")

    expect(createdSessions).toHaveLength(2)
  })

  it("marks node failed and skips dependents on session error", async () => {
    const graph = buildDag("dag-fail", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const createdSessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`session-${createdSessions.length}`, db)
      createdSessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-fail")

    const sessionId = createdSessions[0]!
    await scheduler.onSessionCompleted(sessionId, "errored")

    const s = scheduler.status("dag-fail")
    const nodeA = s.nodes.find((n) => n.id === "a")
    const nodeB = s.nodes.find((n) => n.id === "b")

    expect(nodeA?.status).toBe("failed")
    expect(nodeB?.status).toBe("skipped")
  })

  it("emits dag.node.started event when node spawns", async () => {
    const graph = buildDag("dag-events", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const events: Array<{ kind: string; nodeId: string }> = []
    bus.onKind("dag.node.started", (e) => events.push({ kind: e.kind, nodeId: e.nodeId }))

    const registry = makeRegistry(db)
    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-events")

    expect(events).toHaveLength(1)
    expect(events[0]!.nodeId).toBe("a")
  })

  it("emits dag.node.completed event when session finishes", async () => {
    const graph = buildDag("dag-complete", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const events: Array<{ kind: string; state: string }> = []
    bus.onKind("dag.node.completed", (e) => events.push({ kind: e.kind, state: e.state }))

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-complete")
    await scheduler.onSessionCompleted(sessions[0]!, "completed")

    expect(events).toHaveLength(1)
    expect(events[0]!.state).toBe("completed")
  })

  it("emits live DAG snapshots with node sessions and terminal status", async () => {
    const graph = buildDag("dag-live-snapshot", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: ApiSession[] = []
    const events: Array<{ status: string; sessionId?: string }> = []
    bus.onKind("dag.snapshot", (e) => {
      events.push({
        status: e.dag.status,
        sessionId: e.dag.nodes["a"]?.session?.id,
      })
    })

    const registry = makeRegistry(db, async () => {
      const session = makeSession("s-live", db)
      sessions.push(session)
      return { session, runtime: {} as never }
    })
    registry.list = () => sessions

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-live-snapshot")
    await scheduler.onSessionCompleted("s-live", "completed")

    expect(events[0]).toEqual({ status: "running", sessionId: "s-live" })
    expect(events.at(-1)).toEqual({ status: "completed", sessionId: "s-live" })
  })

  it("advances ship roots to verification when their DAG becomes terminal", async () => {
    const rootId = "ship-root"
    insertShipRoot(db, rootId, "dag")

    const graph = buildDag("dag-ship-complete", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], rootId, "https://github.com/org/repo")
    saveDag(graph, db)

    const replies: Array<{ sessionId: string; text: string }> = []
    const registry = makeRegistry(db, async () => ({ session: makeSession("ship-child", db), runtime: {} as never }))
    registry.reply = async (sessionId, text) => {
      replies.push({ sessionId, text })
      return true
    }

    const scheduler = makeScheduler(registry)
    registerDagCompletionHandler(bus, { db, registry, scheduler: { start: scheduler.start } })

    const dagCompletedEvents: Array<{ dagId: string; rootSessionId: string; status: string }> = []
    bus.onKind("dag.completed", (e) => {
      dagCompletedEvents.push({ dagId: e.dagId, rootSessionId: e.rootSessionId, status: e.status })
    })

    await scheduler.start("dag-ship-complete")
    await scheduler.onSessionCompleted("ship-child", "completed")
    await new Promise((r) => setTimeout(r, 0))

    expect(dagCompletedEvents).toEqual([
      { dagId: "dag-ship-complete", rootSessionId: rootId, status: "completed" },
    ])

    const row = prepared.getSession(db, rootId)
    expect(row?.stage).toBe("verify")
    const expected = buildVerifyDirective([
      { title: "Task A", description: "A", branch: "minion/test-ship-child", prUrl: null },
    ])
    expect(replies).toEqual([{ sessionId: rootId, text: expected }])
  })

  it("emits dag.completed without advancing ship for non-ship root sessions", async () => {
    const graph = buildDag("dag-non-ship", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session-non-ship", "https://github.com/org/repo")
    saveDag(graph, db)

    const dagCompletedEvents: Array<{ dagId: string; status: string }> = []
    bus.onKind("dag.completed", (e) => {
      dagCompletedEvents.push({ dagId: e.dagId, status: e.status })
    })

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-non-ship")
    await scheduler.onSessionCompleted(sessions[0]!, "completed")

    expect(dagCompletedEvents).toEqual([{ dagId: "dag-non-ship", status: "completed" }])
  })

  it("emits dag.completed with status=failed when DAG terminates with failed nodes", async () => {
    const graph = buildDag("dag-failed", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session-failed", "https://github.com/org/repo")
    saveDag(graph, db)

    const dagCompletedEvents: Array<{ dagId: string; status: string }> = []
    bus.onKind("dag.completed", (e) => {
      dagCompletedEvents.push({ dagId: e.dagId, status: e.status })
    })

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-failed")
    await scheduler.onSessionCompleted(sessions[0]!, "errored")

    expect(dagCompletedEvents).toEqual([{ dagId: "dag-failed", status: "failed" }])
  })

  it("cancel stops running sessions and marks them cancelled", async () => {
    const graph = buildDag("dag-cancel", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const stopped: string[] = []
    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })
    registry.stop = async (id) => { stopped.push(id) }

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-cancel")
    await scheduler.cancel("dag-cancel")

    expect(stopped).toHaveLength(1)
    expect(stopped[0]).toBe(sessions[0])

    const s = scheduler.status("dag-cancel")
    const nodeA = s.nodes.find((n) => n.id === "a")
    expect(nodeA?.status).toBe("cancelled")
    expect(nodeA?.error).toBe("dag cancelled")
  })

  it("cancel sweeps pending and ready nodes to cancelled without spawning them", async () => {
    const graph = buildDag("dag-cancel-sweep", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
      { id: "c", title: "Task C", description: "C", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-cancel-sweep")

    expect(sessions).toHaveLength(1)

    await scheduler.cancel("dag-cancel-sweep")

    const s = scheduler.status("dag-cancel-sweep")
    expect(s.nodes.find((n) => n.id === "a")?.status).toBe("cancelled")
    expect(s.nodes.find((n) => n.id === "b")?.status).toBe("cancelled")
    expect(s.nodes.find((n) => n.id === "c")?.status).toBe("cancelled")
  })

  it("cancel persists cancelled state to the DB so it survives reload", async () => {
    const graph = buildDag("dag-cancel-persist", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })
    registry.stop = async () => {}

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-cancel-persist")
    await scheduler.cancel("dag-cancel-persist")

    const reloaded = loadDag("dag-cancel-persist", db)
    expect(reloaded).not.toBeNull()
    expect(reloaded!.nodes.find((n) => n.id === "a")?.status).toBe("cancelled")
    expect(reloaded!.nodes.find((n) => n.id === "b")?.status).toBe("cancelled")
  })

  it("cancel preserves already-terminal nodes (done, failed, landed)", async () => {
    const graph = buildDag("dag-cancel-terminal", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: [] },
      { id: "c", title: "Task C", description: "C", dependsOn: [] },
      { id: "d", title: "Task D", description: "D", dependsOn: ["a", "b", "c"] },
    ], "root-session", "https://github.com/org/repo")
    graph.nodes.find((n) => n.id === "a")!.status = "done"
    graph.nodes.find((n) => n.id === "b")!.status = "failed"
    graph.nodes.find((n) => n.id === "c")!.status = "landed"
    saveDag(graph, db)

    const registry = makeRegistry(db)
    const scheduler = makeScheduler(registry)
    await scheduler.cancel("dag-cancel-terminal")

    const reloaded = loadDag("dag-cancel-terminal", db)
    expect(reloaded!.nodes.find((n) => n.id === "a")?.status).toBe("done")
    expect(reloaded!.nodes.find((n) => n.id === "b")?.status).toBe("failed")
    expect(reloaded!.nodes.find((n) => n.id === "c")?.status).toBe("landed")
    expect(reloaded!.nodes.find((n) => n.id === "d")?.status).toBe("cancelled")
  })

  it("cancel works on a cold DAG that was never started", async () => {
    const graph = buildDag("dag-cold-cancel", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const registry = makeRegistry(db)
    const scheduler = makeScheduler(registry)

    await scheduler.cancel("dag-cold-cancel")

    const reloaded = loadDag("dag-cold-cancel", db)
    expect(reloaded!.nodes.find((n) => n.id === "a")?.status).toBe("cancelled")
    expect(reloaded!.nodes.find((n) => n.id === "b")?.status).toBe("cancelled")
  })

  it("cancel emits a dag.snapshot with cancelled status", async () => {
    const graph = buildDag("dag-cancel-snapshot", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })
    registry.stop = async () => {}

    const snapshots: Array<{ status: string }> = []
    bus.onKind("dag.snapshot", (e) => snapshots.push({ status: e.dag.status }))

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-cancel-snapshot")
    snapshots.length = 0

    await scheduler.cancel("dag-cancel-snapshot")

    expect(snapshots.at(-1)?.status).toBe("cancelled")
  })

  it("cancel is idempotent and safe on an unknown DAG", async () => {
    const registry = makeRegistry(db)
    const scheduler = makeScheduler(registry)
    await expect(scheduler.cancel("does-not-exist")).resolves.toBeUndefined()
  })

  it("retryNode resets a failed node and re-spawns it", async () => {
    const graph = buildDag("dag-retry", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-retry")

    await scheduler.onSessionCompleted(sessions[0]!, "errored")

    const before = scheduler.status("dag-retry")
    expect(before.nodes[0]?.status).toBe("failed")

    await scheduler.retryNode("a", "dag-retry")

    expect(sessions).toHaveLength(2)
    const after = scheduler.status("dag-retry")
    expect(after.nodes[0]?.status).toBe("running")
  })

  it("forceNodeLanded marks node landed and advances DAG", async () => {
    const graph = buildDag("dag-force", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-force")

    await scheduler.forceNodeLanded("a", "dag-force")

    const after = scheduler.status("dag-force")
    const nodeA = after.nodes.find((n) => n.id === "a")
    const nodeB = after.nodes.find((n) => n.id === "b")

    expect(nodeA?.status).toBe("landed")
    expect(nodeB?.status).toBe("running")
  })

  it("status returns empty nodes for unknown dag", () => {
    const scheduler = makeScheduler(makeRegistry(db))
    const s = scheduler.status("nonexistent")
    expect(s.dagId).toBe("nonexistent")
    expect(s.nodes).toHaveLength(0)
  })

  it("calls updateStackComment after each node state transition", async () => {
    const graph = buildDag("dag-comment", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-comment")
    await scheduler.onSessionCompleted(sessions[0]!, "completed")

    expect(stackCommentCallCount).toBeGreaterThan(0)
  })

  it("onSessionResumed resets a failed DAG node back to running", async () => {
    const graph = buildDag("dag-resume", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const id = `session-${sessions.length}`
      const session = makeSession(id, db)
      sessions.push(session.id)
      prepared.updateSession(db, {
        id: session.id,
        updated_at: Date.now(),
        metadata: { dagId: "dag-resume", dagNodeId: "a" },
      })
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-resume")

    const sessionId = sessions[0]!
    await scheduler.onSessionCompleted(sessionId, "errored")

    const afterFail = scheduler.status("dag-resume")
    expect(afterFail.nodes.find((n) => n.id === "a")?.status).toBe("failed")
    expect(afterFail.nodes.find((n) => n.id === "b")?.status).toBe("skipped")

    await scheduler.onSessionResumed(sessionId)

    const afterResume = scheduler.status("dag-resume")
    expect(afterResume.nodes.find((n) => n.id === "a")?.status).toBe("running")
    expect(afterResume.nodes.find((n) => n.id === "a")?.sessionId).toBe(sessionId)
  })

  it("onSessionCompleted recovers from DB when in-memory cache is empty", async () => {
    const graph = buildDag("dag-recover", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`session-${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const firstScheduler = makeScheduler(registry)
    await firstScheduler.start("dag-recover")
    expect(sessions).toHaveLength(1)
    const sessionId = sessions[0]!

    const secondScheduler = makeScheduler(registry)

    await secondScheduler.onSessionCompleted(sessionId, "completed")

    const after = secondScheduler.status("dag-recover")
    const nodeA = after.nodes.find((n) => n.id === "a")
    expect(nodeA?.status).toBe("done")
    expect(sessions).toHaveLength(2)
  })

  it("onSessionCompleted ignores DB-discovered nodes that are not running", async () => {
    const graph = buildDag("dag-stale", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const registry = makeRegistry(db, async () => ({ session: makeSession("stale-sess", db), runtime: {} as never }))
    const firstScheduler = makeScheduler(registry)
    await firstScheduler.start("dag-stale")

    await firstScheduler.onSessionCompleted("stale-sess", "completed")

    const secondScheduler = makeScheduler(registry)
    await secondScheduler.onSessionCompleted("stale-sess", "completed")

    const after = secondScheduler.status("dag-stale")
    const nodeA = after.nodes.find((n) => n.id === "a")
    expect(nodeA?.status).toBe("done")
  })

  it("onSessionResumed uses indexed dag_nodes.session_id lookup, not session metadata", async () => {
    const graph = buildDag("dag-resume-indexed", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const id = `session-${sessions.length}`
      const session = makeSession(id, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-resume-indexed")

    const sessionId = sessions[0]!
    await scheduler.onSessionCompleted(sessionId, "errored")

    prepared.updateSession(db, {
      id: sessionId,
      updated_at: Date.now(),
      metadata: {},
    })

    await scheduler.onSessionResumed(sessionId)

    const after = scheduler.status("dag-resume-indexed")
    expect(after.nodes.find((n) => n.id === "a")?.status).toBe("running")
  })

  it("onSessionResumed is a no-op when session is not part of a DAG", async () => {
    const scheduler = makeScheduler(makeRegistry(db))
    const session = makeSession("loner", db)
    await expect(scheduler.onSessionResumed(session.id)).resolves.toBeUndefined()
  })

  it("watchdog retries running nodes on first no-progress stall", async () => {
    let now = 1_000
    const graph = buildDag("dag-stall-retry", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const stoppedSessions: string[] = []
    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })
    registry.stop = async (id) => { stoppedSessions.push(id) }

    const stallEvents: Array<{ reason: string; action: string; stallCount: number }> = []
    bus.onKind("dag.stalled", (e) => stallEvents.push({ reason: e.reason, action: e.action, stallCount: e.stallCount }))

    const scheduler = createDagScheduler({
      registry,
      db,
      bus,
      workspace: "/tmp",
      ciBabysitter: {
        babysitPR: async () => {},
        queueDeferredBabysit: async () => {},
        babysitDagChildCI: async () => {},
      },
      updateStackComment: async () => {},
      watchdog: {
        stallThresholdMs: 1000,
        checkIntervalMs: 1_000_000,
        maxRetries: 1,
        now: () => now,
        setIntervalFn: (() => 0) as unknown as typeof setInterval,
        clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      },
    })

    await scheduler.start("dag-stall-retry")
    expect(sessions).toHaveLength(1)
    const firstSession = sessions[0]!

    now = 5_000
    await scheduler.watchdogTick(now)

    expect(stallEvents).toHaveLength(1)
    expect(stallEvents[0]).toMatchObject({ reason: "no-progress", action: "retry", stallCount: 1 })
    expect(stoppedSessions).toEqual([firstSession])
    expect(sessions).toHaveLength(2)

    const status = scheduler.status("dag-stall-retry")
    expect(status.nodes[0]?.status).toBe("running")

    scheduler.shutdown()
  })

  it("watchdog fail-forwards after retry budget is exhausted", async () => {
    let now = 1_000
    const graph = buildDag("dag-stall-fwd", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })
    registry.stop = async () => {}

    const stallEvents: Array<{ action: string }> = []
    bus.onKind("dag.stalled", (e) => stallEvents.push({ action: e.action }))

    const scheduler = createDagScheduler({
      registry,
      db,
      bus,
      workspace: "/tmp",
      ciBabysitter: {
        babysitPR: async () => {},
        queueDeferredBabysit: async () => {},
        babysitDagChildCI: async () => {},
      },
      updateStackComment: async () => {},
      watchdog: {
        stallThresholdMs: 1000,
        checkIntervalMs: 1_000_000,
        maxRetries: 1,
        now: () => now,
        setIntervalFn: (() => 0) as unknown as typeof setInterval,
        clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      },
    })

    await scheduler.start("dag-stall-fwd")

    now = 5_000
    await scheduler.watchdogTick(now)
    expect(stallEvents.at(-1)?.action).toBe("retry")

    now = 10_000
    await scheduler.watchdogTick(now)
    expect(stallEvents.at(-1)?.action).toBe("fail-forward")

    const status = scheduler.status("dag-stall-fwd")
    const nodeA = status.nodes.find((n) => n.id === "a")
    const nodeB = status.nodes.find((n) => n.id === "b")
    expect(nodeA?.status).toBe("failed")
    expect(nodeA?.error).toContain("dag stalled")
    expect(nodeB?.status).toBe("skipped")

    scheduler.shutdown()
  })

  it("watchdog deadline immediately fail-forwards even on first stall", async () => {
    let now = 1_000
    const graph = buildDag("dag-stall-deadline", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo", undefined, { deadlineMs: 5_000 })
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })
    registry.stop = async () => {}

    const stallEvents: Array<{ reason: string; action: string }> = []
    bus.onKind("dag.stalled", (e) => stallEvents.push({ reason: e.reason, action: e.action }))

    const scheduler = createDagScheduler({
      registry,
      db,
      bus,
      workspace: "/tmp",
      ciBabysitter: {
        babysitPR: async () => {},
        queueDeferredBabysit: async () => {},
        babysitDagChildCI: async () => {},
      },
      updateStackComment: async () => {},
      watchdog: {
        stallThresholdMs: 1_000_000,
        checkIntervalMs: 1_000_000,
        maxRetries: 5,
        now: () => now,
        setIntervalFn: (() => 0) as unknown as typeof setInterval,
        clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      },
    })

    await scheduler.start("dag-stall-deadline")

    now = 6_000
    await scheduler.watchdogTick(now)

    expect(stallEvents).toHaveLength(1)
    expect(stallEvents[0]).toEqual({ reason: "deadline", action: "fail-forward" })

    const status = scheduler.status("dag-stall-deadline")
    expect(status.nodes[0]?.status).toBe("failed")

    scheduler.shutdown()
  })

  it("watchdog notifyResolved keeps the dag alive across node completion", async () => {
    let now = 1_000
    const graph = buildDag("dag-stall-progress", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const stallEvents: unknown[] = []
    bus.onKind("dag.stalled", (e) => stallEvents.push(e))

    const scheduler = createDagScheduler({
      registry,
      db,
      bus,
      workspace: "/tmp",
      ciBabysitter: {
        babysitPR: async () => {},
        queueDeferredBabysit: async () => {},
        babysitDagChildCI: async () => {},
      },
      updateStackComment: async () => {},
      watchdog: {
        stallThresholdMs: 1000,
        checkIntervalMs: 1_000_000,
        maxRetries: 1,
        now: () => now,
        setIntervalFn: (() => 0) as unknown as typeof setInterval,
        clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      },
    })

    await scheduler.start("dag-stall-progress")

    now = 1_500
    await scheduler.onSessionCompleted(sessions[0]!, "completed")

    now = 2_200
    await scheduler.watchdogTick(now)

    expect(stallEvents).toHaveLength(0)

    scheduler.shutdown()
  })

  it("watchdog disarms when the dag completes", async () => {
    let now = 1_000
    const graph = buildDag("dag-stall-disarm", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const stallEvents: unknown[] = []
    bus.onKind("dag.stalled", (e) => stallEvents.push(e))

    const scheduler = createDagScheduler({
      registry,
      db,
      bus,
      workspace: "/tmp",
      ciBabysitter: {
        babysitPR: async () => {},
        queueDeferredBabysit: async () => {},
        babysitDagChildCI: async () => {},
      },
      updateStackComment: async () => {},
      watchdog: {
        stallThresholdMs: 1000,
        checkIntervalMs: 1_000_000,
        maxRetries: 1,
        now: () => now,
        setIntervalFn: (() => 0) as unknown as typeof setInterval,
        clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      },
    })

    await scheduler.start("dag-stall-disarm")
    await scheduler.onSessionCompleted(sessions[0]!, "completed")

    now = 1_000_000
    await scheduler.watchdogTick(now)

    expect(stallEvents).toHaveLength(0)

    scheduler.shutdown()
  })

  it("onSessionResumed is a no-op when node is not in failed state", async () => {
    const graph = buildDag("dag-resume-noop", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const id = `session-${sessions.length}`
      const session = makeSession(id, db)
      sessions.push(session.id)
      prepared.updateSession(db, {
        id: session.id,
        updated_at: Date.now(),
        metadata: { dagId: "dag-resume-noop", dagNodeId: "a" },
      })
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-resume-noop")

    const before = scheduler.status("dag-resume-noop")
    expect(before.nodes[0]?.status).toBe("running")

    await scheduler.onSessionResumed(sessions[0]!)

    const after = scheduler.status("dag-resume-noop")
    expect(after.nodes[0]?.status).toBe("running")
  })

  it("emits dag.completed when all nodes finish successfully", async () => {
    const graph = buildDag("dag-emit-complete", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const events: Array<{ dagId: string; status: string }> = []
    bus.onKind("dag.completed", (e) => events.push({ dagId: e.dagId, status: e.status }))

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-emit-complete")

    expect(events).toHaveLength(0)

    await scheduler.onSessionCompleted(sessions[0]!, "completed")
    expect(events).toHaveLength(0)

    await scheduler.onSessionCompleted(sessions[1]!, "completed")
    expect(events).toEqual([{ dagId: "dag-emit-complete", status: "completed" }])
  })

  it("emits dag.completed with status 'failed' when a node fails", async () => {
    const graph = buildDag("dag-emit-failed", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
      { id: "b", title: "Task B", description: "B", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const events: Array<{ dagId: string; status: string }> = []
    bus.onKind("dag.completed", (e) => events.push({ dagId: e.dagId, status: e.status }))

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-emit-failed")

    await scheduler.onSessionCompleted(sessions[0]!, "errored")

    expect(events).toEqual([{ dagId: "dag-emit-failed", status: "failed" }])
  })

  it("emits dag.completed only once per terminal transition", async () => {
    const graph = buildDag("dag-emit-once", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const events: Array<{ dagId: string }> = []
    bus.onKind("dag.completed", (e) => events.push({ dagId: e.dagId }))

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-emit-once")
    await scheduler.onSessionCompleted(sessions[0]!, "completed")
    expect(events).toHaveLength(1)

    await scheduler.forceNodeLanded("a", "dag-emit-once")
    expect(events).toHaveLength(1)
  })

  it("emits dag.completed again after retry resurrects a failed DAG", async () => {
    const graph = buildDag("dag-emit-retry", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const events: Array<{ status: string }> = []
    bus.onKind("dag.completed", (e) => events.push({ status: e.status }))

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`s${sessions.length}`, db)
      sessions.push(session.id)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-emit-retry")
    await scheduler.onSessionCompleted(sessions[0]!, "errored")

    expect(events).toEqual([{ status: "failed" }])

    await scheduler.retryNode("a", "dag-emit-retry")
    await scheduler.onSessionCompleted(sessions[1]!, "completed")

    expect(events).toEqual([{ status: "failed" }, { status: "completed" }])
  })

  it("emits dag.cancelled when cancel is called on an active DAG", async () => {
    const graph = buildDag("dag-emit-cancel", [
      { id: "a", title: "Task A", description: "A", dependsOn: [] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    const cancelled: Array<{ dagId: string }> = []
    const completed: Array<{ dagId: string }> = []
    bus.onKind("dag.cancelled", (e) => cancelled.push({ dagId: e.dagId }))
    bus.onKind("dag.completed", (e) => completed.push({ dagId: e.dagId }))

    const registry = makeRegistry(db, async () => ({ session: makeSession("ss", db), runtime: {} as never }))
    const scheduler = makeScheduler(registry)
    await scheduler.start("dag-emit-cancel")
    await scheduler.cancel("dag-emit-cancel")

    expect(cancelled).toEqual([{ dagId: "dag-emit-cancel" }])
    expect(completed).toHaveLength(0)
  })

  it("does not emit dag.cancelled when cancelling an unknown DAG", async () => {
    const cancelled: Array<{ dagId: string }> = []
    bus.onKind("dag.cancelled", (e) => cancelled.push({ dagId: e.dagId }))

    const scheduler = makeScheduler(makeRegistry(db))
    await scheduler.cancel("never-started")

    expect(cancelled).toHaveLength(0)
  })
})

describe("DagScheduler restack integration", () => {
  it("defers restack when node is running", async () => {
    const db = makeTestDb()
    const bus = new EngineEventBus()
    const sessions: ApiSession[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`sess-${sessions.length}`, db)
      sessions.push(session)
      return { session, runtime: {} as never }
    })
    const scheduler = createDagScheduler({
      registry,
      db,
      bus,
      workspace: "/tmp/workspace",
      ciBabysitter: {
        babysitPR: async () => {},
        queueDeferredBabysit: async () => {},
        babysitDagChildCI: async () => {},
      },
    })

    const graph = buildDag("dag-deferred-restack", [
      { id: "a", title: "Task A", description: "First", dependsOn: [] },
      { id: "b", title: "Task B", description: "Second", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    saveDag(graph, db)

    await scheduler.start("dag-deferred-restack")

    graph.nodes[0]!.status = "running"
    graph.nodes[0]!.sessionId = sessions[0]!.id
    saveDag(graph, db)

    bus.emit({
      kind: "dag.node.pushed",
      dagId: "dag-deferred-restack",
      nodeId: "a",
      parentSha: "old-sha",
      newSha: "new-sha",
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    await scheduler.onSessionCompleted(sessions[0]!.id, "completed")
  })

  it("processes deferred restacks on session completion", async () => {
    const db = makeTestDb()
    const bus = new EngineEventBus()
    const events: unknown[] = []
    bus.on((ev) => events.push(ev))

    const sessions: ApiSession[] = []
    const registry = makeRegistry(db, async () => {
      const session = makeSession(`sess-${sessions.length}`, db)
      sessions.push(session)
      return { session, runtime: {} as never }
    })
    const scheduler = createDagScheduler({
      registry,
      db,
      bus,
      workspace: "/tmp/workspace",
      ciBabysitter: {
        babysitPR: async () => {},
        queueDeferredBabysit: async () => {},
        babysitDagChildCI: async () => {},
      },
    })

    const graph = buildDag("dag-deferred-drain", [
      { id: "a", title: "Task A", description: "First", dependsOn: [] },
      { id: "b", title: "Task B", description: "Second", dependsOn: ["a"] },
    ], "root-session", "https://github.com/org/repo")
    graph.nodes[0]!.branch = "minion/test-a"
    graph.nodes[1]!.branch = "minion/test-b"
    saveDag(graph, db)

    await scheduler.start("dag-deferred-drain")

    graph.nodes[0]!.status = "running"
    graph.nodes[0]!.sessionId = sessions[0]!.id
    saveDag(graph, db)

    bus.emit({
      kind: "dag.node.pushed",
      dagId: "dag-deferred-drain",
      nodeId: "a",
      parentSha: "old-sha",
      newSha: "new-sha",
    })

    await scheduler.onSessionCompleted(sessions[0]!.id, "completed")
  })
})
