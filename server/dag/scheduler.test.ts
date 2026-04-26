import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { buildDag } from "./dag"
import { saveDag } from "./store"
import { createDagScheduler } from "./scheduler"
import { EngineEventBus } from "../events/bus"
import { openDatabase, prepared, runMigrations } from "../db/sqlite"
import { DIRECTIVE_VERIFY } from "../ship/coordinator"
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
    await scheduler.start("dag-ship-complete")
    await scheduler.onSessionCompleted("ship-child", "completed")

    const row = prepared.getSession(db, rootId)
    expect(row?.stage).toBe("verify")
    expect(replies).toEqual([{ sessionId: rootId, text: DIRECTIVE_VERIFY }])
  })

  it("cancel stops running sessions and marks them failed", async () => {
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
    expect(nodeA?.status).toBe("failed")
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

  it("onSessionResumed is a no-op when session is not part of a DAG", async () => {
    const scheduler = makeScheduler(makeRegistry(db))
    const session = makeSession("loner", db)
    await expect(scheduler.onSessionResumed(session.id)).resolves.toBeUndefined()
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
})
