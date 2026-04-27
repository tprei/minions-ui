import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { buildDag } from "./dag"
import { saveDag, loadDag } from "./store"
import { createDagScheduler } from "./scheduler"
import { EngineEventBus } from "../events/bus"
import { openDatabase, prepared, runMigrations } from "../db/sqlite"
import type { SessionRegistry, CreateSessionOpts } from "../session/registry"
import type { SessionRuntime } from "../session/runtime"
import type { ApiSession } from "../../shared/api-types"
import type { EngineEvent } from "../events/types"

function makeTestDb(): Database {
  const db = openDatabase(":memory:")
  runMigrations(db)
  return db
}

function makeSession(id: string, db?: Database, status: "running" | "completed" | "failed" | "waiting_input" = "running"): ApiSession {
  const session: ApiSession = {
    id,
    slug: `test-${id}`,
    status: status === "waiting_input" ? "running" : status,
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
      status,
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
  const sessions: ApiSession[] = []
  const registry: SessionRegistry = {
    create: createFn ?? (async () => {
      const session = makeSession("mock-session-" + Math.random().toString(36).slice(2), db)
      sessions.push(session)
      return { session, runtime: {} as SessionRuntime }
    }),
    get: () => undefined,
    getBySlug: () => undefined,
    list: () => sessions,
    snapshot: () => undefined,
    stop: async () => undefined,
    close: async () => undefined,
    reply: async () => true,
    reconcileOnBoot: async () => undefined,
    scheduleQuotaResume: async () => undefined,
  }
  return registry
}

function makeScheduler(db: Database, bus: EngineEventBus, registry: SessionRegistry) {
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
    updateStackComment: async () => {},
  })
}

describe("multi-level orchestration: ship -> DAG", () => {
  let db: Database
  let bus: EngineEventBus

  beforeEach(() => {
    db = makeTestDb()
    bus = new EngineEventBus()
  })

  it("advances ship to verify only after all DAG nodes terminate", async () => {
    const rootId = "ship-root-multi"
    insertShipRoot(db, rootId, "dag")

    const graph = buildDag(
      "dag-multi-level",
      [
        { id: "a", title: "Task A", description: "First", dependsOn: [] },
        { id: "b", title: "Task B", description: "Second", dependsOn: ["a"] },
        { id: "c", title: "Task C", description: "Third", dependsOn: ["a"] },
        { id: "d", title: "Task D", description: "Final", dependsOn: ["b", "c"] },
      ],
      rootId,
      "https://github.com/org/repo",
    )
    saveDag(graph, db)

    const created: string[] = []
    const registry = makeRegistry(db, async (opts) => {
      const id = `child-${created.length}`
      const meta = (opts.metadata ?? {}) as { dagNodeId?: string }
      const session = makeSession(id, db)
      created.push(meta.dagNodeId ?? id)
      return { session, runtime: {} as never }
    })

    const replies: Array<{ sessionId: string; text: string }> = []
    registry.reply = async (sessionId, text) => {
      replies.push({ sessionId, text })
      return true
    }

    const scheduler = makeScheduler(db, bus, registry)

    await scheduler.start("dag-multi-level")
    expect(created).toEqual(["a"])
    expect(replies).toHaveLength(0)

    await scheduler.onSessionCompleted("child-0", "completed")
    expect(created.slice(1).sort()).toEqual(["b", "c"])
    expect(replies).toHaveLength(0)

    const rowAfterA = prepared.getSession(db, rootId)
    expect(rowAfterA?.stage).toBe("dag")

    await scheduler.onSessionCompleted("child-1", "completed")
    await scheduler.onSessionCompleted("child-2", "completed")
    expect(created).toContain("d")
    expect(replies).toHaveLength(0)

    const rowBeforeD = prepared.getSession(db, rootId)
    expect(rowBeforeD?.stage).toBe("dag")

    const dNodeIdx = created.indexOf("d")
    await scheduler.onSessionCompleted(`child-${dNodeIdx}`, "completed")

    const rowAfterAll = prepared.getSession(db, rootId)
    expect(rowAfterAll?.stage).toBe("verify")
    expect(replies).toHaveLength(1)
    expect(replies[0]!.sessionId).toBe(rootId)
    expect(replies[0]!.text).toContain("Task A")
    expect(replies[0]!.text).toContain("Task D")
  })

  it("still advances ship to verify when a DAG branch fails mid-flight", async () => {
    const rootId = "ship-root-fail"
    insertShipRoot(db, rootId, "dag")

    const graph = buildDag(
      "dag-mid-fail",
      [
        { id: "a", title: "Task A", description: "First", dependsOn: [] },
        { id: "b", title: "Task B", description: "Second", dependsOn: ["a"] },
        { id: "c", title: "Task C", description: "Indep", dependsOn: [] },
      ],
      rootId,
      "https://github.com/org/repo",
    )
    saveDag(graph, db)

    const created: string[] = []
    const registry = makeRegistry(db, async (opts) => {
      const meta = (opts.metadata ?? {}) as { dagNodeId?: string }
      const id = `c-${created.length}-${meta.dagNodeId}`
      created.push(id)
      const session = makeSession(id, db)
      return { session, runtime: {} as never }
    })

    const replies: Array<{ sessionId: string; text: string }> = []
    registry.reply = async (sessionId, text) => {
      replies.push({ sessionId, text })
      return true
    }

    const scheduler = makeScheduler(db, bus, registry)
    await scheduler.start("dag-mid-fail")

    expect(created).toHaveLength(2)

    const aSessionId = created.find((id) => id.endsWith("-a"))!
    const cSessionId = created.find((id) => id.endsWith("-c"))!
    await scheduler.onSessionCompleted(aSessionId, "errored")

    const status = scheduler.status("dag-mid-fail")
    expect(status.nodes.find((n) => n.id === "a")?.status).toBe("failed")
    expect(status.nodes.find((n) => n.id === "b")?.status).toBe("skipped")

    const rowMid = prepared.getSession(db, rootId)
    expect(rowMid?.stage).toBe("dag")

    await scheduler.onSessionCompleted(cSessionId, "completed")

    const rowAfter = prepared.getSession(db, rootId)
    expect(rowAfter?.stage).toBe("verify")
    expect(replies).toHaveLength(1)
  })

  it("emits dag.node.completed with state=quota_exhausted and skips downstream", async () => {
    const graph = buildDag(
      "dag-quota",
      [
        { id: "a", title: "Task A", description: "First", dependsOn: [] },
        { id: "b", title: "Task B", description: "Second", dependsOn: ["a"] },
      ],
      "root-session",
      "https://github.com/org/repo",
    )
    saveDag(graph, db)

    const events: Array<{ kind: string; nodeId?: string; state?: string }> = []
    bus.onKind("dag.node.completed", (e) =>
      events.push({ kind: e.kind, nodeId: e.nodeId, state: e.state }),
    )

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const id = `s-${sessions.length}`
      sessions.push(id)
      const session = makeSession(id, db)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(db, bus, registry)
    await scheduler.start("dag-quota")

    await scheduler.onSessionCompleted(sessions[0]!, "quota_exhausted")

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ kind: "dag.node.completed", nodeId: "a", state: "quota_exhausted" })

    const status = scheduler.status("dag-quota")
    expect(status.nodes.find((n) => n.id === "a")?.status).toBe("failed")
    expect(status.nodes.find((n) => n.id === "b")?.status).toBe("skipped")

    expect(sessions).toHaveLength(1)
  })
})

describe("multi-level orchestration: concurrent DAGs", () => {
  it("applies MAX_DAG_CONCURRENCY independently per DAG", async () => {
    const db = makeTestDb()
    const bus = new EngineEventBus()

    const graphA = buildDag(
      "dag-A",
      Array.from({ length: 6 }, (_, i) => ({
        id: `a${i}`,
        title: `A${i}`,
        description: "",
        dependsOn: [] as string[],
      })),
      "root-A",
      "https://github.com/org/repo",
    )
    saveDag(graphA, db)

    const graphB = buildDag(
      "dag-B",
      Array.from({ length: 6 }, (_, i) => ({
        id: `b${i}`,
        title: `B${i}`,
        description: "",
        dependsOn: [] as string[],
      })),
      "root-B",
      "https://github.com/org/repo",
    )
    saveDag(graphB, db)

    const spawned = { A: 0, B: 0 }

    const registry = makeRegistry(db, async (opts) => {
      const meta = (opts.metadata ?? {}) as { dagId?: string }
      const which = meta.dagId === "dag-A" ? "A" : "B"
      spawned[which]++
      await new Promise<void>((r) => setTimeout(r, 0))
      const session = makeSession(`s-${which}-${spawned[which]}-${Math.random().toString(36).slice(2)}`, db)
      return { session, runtime: {} as never }
    })

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
    })

    await Promise.all([scheduler.start("dag-A"), scheduler.start("dag-B")])

    expect(spawned.A).toBeLessThanOrEqual(4)
    expect(spawned.B).toBeLessThanOrEqual(4)
    expect(spawned.A).toBeGreaterThan(0)
    expect(spawned.B).toBeGreaterThan(0)

    const statusA = scheduler.status("dag-A")
    const statusB = scheduler.status("dag-B")
    const runningA = statusA.nodes.filter((n) => n.status === "running").length
    const runningB = statusB.nodes.filter((n) => n.status === "running").length
    expect(runningA).toBeLessThanOrEqual(4)
    expect(runningB).toBeLessThanOrEqual(4)
    expect(runningA + runningB).toBeGreaterThanOrEqual(2)
  })
})

describe("multi-level orchestration: boot reconciliation", () => {
  let db: Database
  let bus: EngineEventBus

  beforeEach(() => {
    db = makeTestDb()
    bus = new EngineEventBus()
  })

  it("marks running nodes failed when sessionId is missing after restart", async () => {
    const graph = buildDag(
      "dag-boot-no-session",
      [
        { id: "a", title: "Task A", description: "", dependsOn: [] },
        { id: "b", title: "Task B", description: "", dependsOn: ["a"] },
      ],
      "root-boot-1",
      "https://github.com/org/repo",
    )
    graph.nodes[0]!.status = "running"
    graph.nodes[0]!.sessionId = undefined
    saveDag(graph, db)

    const scheduler = makeScheduler(db, bus, makeRegistry(db))
    await scheduler.reconcileOnBoot()

    const reloaded = loadDag("dag-boot-no-session", db)!
    expect(reloaded.nodes.find((n) => n.id === "a")?.status).toBe("failed")
    expect(reloaded.nodes.find((n) => n.id === "a")?.error).toContain("session id missing")
    expect(reloaded.nodes.find((n) => n.id === "b")?.status).toBe("skipped")
  })

  it("promotes node to done when its session completed while engine was down", async () => {
    const sessionId = "boot-completed-session"
    makeSession(sessionId, db, "completed")

    const graph = buildDag(
      "dag-boot-done",
      [
        { id: "a", title: "Task A", description: "", dependsOn: [] },
        { id: "b", title: "Task B", description: "", dependsOn: ["a"] },
      ],
      "root-boot-2",
      "https://github.com/org/repo",
    )
    graph.nodes[0]!.status = "running"
    graph.nodes[0]!.sessionId = sessionId
    saveDag(graph, db)

    const created: string[] = []
    const registry = makeRegistry(db, async () => {
      const id = `b-${created.length}`
      created.push(id)
      const session = makeSession(id, db)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(db, bus, registry)
    await scheduler.reconcileOnBoot()

    const reloaded = loadDag("dag-boot-done", db)!
    expect(reloaded.nodes.find((n) => n.id === "a")?.status).toBe("done")

    expect(created).toHaveLength(1)
    const status = scheduler.status("dag-boot-done")
    expect(status.nodes.find((n) => n.id === "b")?.status).toBe("running")
  })

  it("marks node failed and skips dependents when session ended failed during restart", async () => {
    const sessionId = "boot-failed-session"
    makeSession(sessionId, db, "failed")

    const graph = buildDag(
      "dag-boot-failed",
      [
        { id: "a", title: "Task A", description: "", dependsOn: [] },
        { id: "b", title: "Task B", description: "", dependsOn: ["a"] },
      ],
      "root-boot-3",
      "https://github.com/org/repo",
    )
    graph.nodes[0]!.status = "running"
    graph.nodes[0]!.sessionId = sessionId
    saveDag(graph, db)

    const scheduler = makeScheduler(db, bus, makeRegistry(db))
    await scheduler.reconcileOnBoot()

    const reloaded = loadDag("dag-boot-failed", db)!
    expect(reloaded.nodes.find((n) => n.id === "a")?.status).toBe("failed")
    expect(reloaded.nodes.find((n) => n.id === "b")?.status).toBe("skipped")
  })

  it("re-tracks a still-running session and resumes its onSessionCompleted handler", async () => {
    const sessionId = "boot-running-session"
    makeSession(sessionId, db, "running")

    const graph = buildDag(
      "dag-boot-running",
      [
        { id: "a", title: "Task A", description: "", dependsOn: [] },
        { id: "b", title: "Task B", description: "", dependsOn: ["a"] },
      ],
      "root-boot-4",
      "https://github.com/org/repo",
    )
    graph.nodes[0]!.status = "running"
    graph.nodes[0]!.sessionId = sessionId
    saveDag(graph, db)

    const created: string[] = []
    const registry = makeRegistry(db, async () => {
      const id = `b-${created.length}`
      created.push(id)
      const session = makeSession(id, db)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(db, bus, registry)
    await scheduler.reconcileOnBoot()

    expect(created).toHaveLength(0)
    expect(scheduler.status("dag-boot-running").nodes.find((n) => n.id === "a")?.status).toBe("running")

    await scheduler.onSessionCompleted(sessionId, "completed")

    expect(created).toHaveLength(1)
    expect(scheduler.status("dag-boot-running").nodes.find((n) => n.id === "a")?.status).toBe("done")
    expect(scheduler.status("dag-boot-running").nodes.find((n) => n.id === "b")?.status).toBe("running")
  })
})

describe("multi-level orchestration: SSE event ordering", () => {
  let db: Database
  let bus: EngineEventBus

  beforeEach(() => {
    db = makeTestDb()
    bus = new EngineEventBus()
  })

  it("emits dag.node.* events before the dag.snapshot they reference", async () => {
    const graph = buildDag(
      "dag-order",
      [
        { id: "a", title: "Task A", description: "", dependsOn: [] },
        { id: "b", title: "Task B", description: "", dependsOn: ["a"] },
      ],
      "root-order",
      "https://github.com/org/repo",
    )
    saveDag(graph, db)

    const order: EngineEvent[] = []
    bus.on((e) => order.push(e))

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const id = `s-${sessions.length}`
      sessions.push(id)
      const session = makeSession(id, db)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(db, bus, registry)
    await scheduler.start("dag-order")
    await scheduler.onSessionCompleted(sessions[0]!, "completed")

    const startedIdx = order.findIndex((e) => e.kind === "dag.node.started" && e.nodeId === "a")
    const firstSnapshotIdx = order.findIndex((e) => e.kind === "dag.snapshot")
    expect(startedIdx).toBeGreaterThanOrEqual(0)
    expect(firstSnapshotIdx).toBeGreaterThan(startedIdx)

    const completedIdx = order.findIndex((e) => e.kind === "dag.node.completed" && e.nodeId === "a")
    expect(completedIdx).toBeGreaterThanOrEqual(0)

    const snapshotsAfterCompleted = order
      .slice(completedIdx + 1)
      .filter((e) => e.kind === "dag.snapshot")
    expect(snapshotsAfterCompleted.length).toBeGreaterThan(0)
    const firstSnapshotAfterCompleted = snapshotsAfterCompleted[0] as Extract<EngineEvent, { kind: "dag.snapshot" }>
    expect(firstSnapshotAfterCompleted.dag.nodes["a"]?.status).toBe("completed")

    const startedB = order.findIndex(
      (e, i) => i > completedIdx && e.kind === "dag.node.started" && e.nodeId === "b",
    )
    expect(startedB).toBeGreaterThan(completedIdx)
  })

  it("emits a final dag.snapshot with terminal status when DAG completes", async () => {
    const graph = buildDag(
      "dag-terminal",
      [{ id: "only", title: "Only", description: "", dependsOn: [] }],
      "root-terminal",
      "https://github.com/org/repo",
    )
    saveDag(graph, db)

    const snapshots: Array<{ status: string }> = []
    bus.onKind("dag.snapshot", (e) => snapshots.push({ status: e.dag.status }))

    const sessions: string[] = []
    const registry = makeRegistry(db, async () => {
      const id = `t-${sessions.length}`
      sessions.push(id)
      const session = makeSession(id, db)
      return { session, runtime: {} as never }
    })

    const scheduler = makeScheduler(db, bus, registry)
    await scheduler.start("dag-terminal")
    await scheduler.onSessionCompleted(sessions[0]!, "completed")

    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots[snapshots.length - 1]!.status).toBe("completed")
  })
})
