import crypto from "node:crypto"
import type { Database } from "bun:sqlite"
import { readyNodes, advanceDag, failNode, resetFailedNode, nodeIndex, getUpstreamBranches, isDagComplete, dagGraphStatus, isTerminalStatus } from "./dag"
import type { DagGraph, DagNode, DagInput } from "./dag"
import { saveDag, loadDag, listDags } from "./store"
import { prepared } from "../db/sqlite"
import type { DagDeferredRestackRow } from "../db/sqlite"
import { updateStackComment } from "./stack-comment"
import { buildDagChildPrompt } from "./dag-extract"
import type { TopicMessage } from "./types"
import type { SessionRegistry } from "../session/registry"
import type { EngineEventBus } from "../events/bus"
import type { SessionRunState } from "../events/types"
import type { ApiDagNode, ApiDagGraph } from "../../shared/api-types"
import type { CIBabysitter } from "../handlers/types"
import { createRestackManager } from "./restack"
import type { RestackManager } from "./restack"
import { createDagWatchdog } from "./watchdog"
import type { DagWatchdog, DagWatchdogOpts, StallEvent, StallAction } from "./watchdog"

function fetchRootConversation(db: Database, rootSessionId: string): TopicMessage[] {
  const rows = db
    .query<{ type: string; payload: string }, [string]>(
      "SELECT type, payload FROM session_events WHERE session_id = ? AND type IN ('user_message','assistant_text') ORDER BY seq ASC",
    )
    .all(rootSessionId)

  const messages: TopicMessage[] = []
  for (const row of rows) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>
    } catch {
      continue
    }
    const text = typeof payload.text === "string" ? payload.text : ""
    if (!text) continue
    if (row.type === "user_message") {
      messages.push({ role: "user", text })
    } else if (row.type === "assistant_text" && payload.final === true) {
      messages.push({ role: "assistant", text })
    }
  }
  return messages
}

function nodesToDagInputs(nodes: DagNode[]): DagInput[] {
  return nodes.map((n) => ({
    id: n.id,
    title: n.title,
    description: n.description,
    dependsOn: n.dependsOn,
  }))
}

const PR_URL_REGEX = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/

function readNodePrInfo(db: Database, sessionId: string): { prUrl?: string; branch?: string } {
  const row = db
    .query<{ branch: string | null }, [string]>("SELECT branch FROM sessions WHERE id = ?")
    .get(sessionId)
  const branch = row?.branch ?? undefined

  const maxTurn = db
    .query<{ m: number | null }, [string]>(
      "SELECT MAX(turn) as m FROM session_events WHERE session_id = ? AND type = 'assistant_text'",
    )
    .get(sessionId)
  if (!maxTurn || maxTurn.m === null) return { branch }

  const rows = db
    .query<{ payload: string }, [string, number]>(
      "SELECT payload FROM session_events WHERE session_id = ? AND type = 'assistant_text' AND turn = ? ORDER BY seq ASC",
    )
    .all(sessionId, maxTurn.m)

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>
      if (payload.final !== true) continue
      const text = typeof payload.text === "string" ? payload.text : ""
      const match = PR_URL_REGEX.exec(text)
      if (match) return { prUrl: match[0], branch }
    } catch {
      continue
    }
  }

  return { branch }
}

const MAX_DAG_CONCURRENCY = Number(process.env["MAX_DAG_CONCURRENCY"] ?? 4)

export interface DagStatusSnapshot {
  dagId: string
  nodes: Array<{
    id: string
    status: DagNode["status"]
    sessionId?: string
    error?: string
  }>
}

export interface DagSchedulerOpts {
  registry: SessionRegistry
  db: Database
  bus: EngineEventBus
  workspace: string
  ciBabysitter: CIBabysitter
  updateStackComment?: (graph: DagGraph) => Promise<void>
  watchdog?: Pick<DagWatchdogOpts, "stallThresholdMs" | "checkIntervalMs" | "maxRetries" | "now" | "setIntervalFn" | "clearIntervalFn">
}

export interface DagScheduler {
  start(dagId: string): Promise<void>
  onSessionCompleted(sessionId: string, state: SessionRunState): Promise<void>
  onSessionResumed(sessionId: string): Promise<void>
  cancel(dagId: string): Promise<void>
  status(dagId: string): DagStatusSnapshot
  retryNode(nodeId: string, dagId: string): Promise<void>
  forceNodeLanded(nodeId: string, dagId: string): Promise<void>
  reconcileOnBoot(): Promise<void>
  persistDag(graph: DagGraph): void
  watchdogTick(at?: number): Promise<void>
  shutdown(): void
}

export function createDagScheduler(opts: DagSchedulerOpts): DagScheduler {
  const { registry, db, bus, ciBabysitter } = opts
  const commentUpdater = opts.updateStackComment ?? updateStackComment

  const activeGraphs = new Map<string, DagGraph>()
  const nodeToSession = new Map<string, string>()
  const nodeToGraph = new Map<string, string>()
  const cancelledDags = new Set<string>()
  const completedDags = new Set<string>()

  const restackManager: RestackManager = createRestackManager({
    bus,
    workspaceRoot: opts.workspace,
    registry,
  })

  function rowToDeferredEvent(row: DagDeferredRestackRow): {
    dagId: string
    nodeId: string
    parentSha: string
    newSha: string
    cascadeDepth: number
  } {
    return {
      dagId: row.dag_id,
      nodeId: row.node_id,
      parentSha: row.parent_sha,
      newSha: row.new_sha,
      cascadeDepth: row.cascade_depth,
    }
  }

  async function drainDeferredRestacksForSession(sessionId: string): Promise<void> {
    const rows = prepared.listDeferredRestacksBySession(db, sessionId)
    for (const row of rows) {
      const dagGraph = activeGraphs.get(row.dag_id) ?? loadDag(row.dag_id, db)
      if (!dagGraph) {
        prepared.deleteDeferredRestack(db, row.id)
        continue
      }
      try {
        await restackManager.onParentPushed(rowToDeferredEvent(row), dagGraph)
      } catch (err) {
        console.error(`[scheduler] deferred restack failed for node ${row.node_id}:`, err)
      }
      prepared.deleteDeferredRestack(db, row.id)
    }
  }

  const watchdog: DagWatchdog = createDagWatchdog({
    bus,
    stallThresholdMs: opts.watchdog?.stallThresholdMs,
    checkIntervalMs: opts.watchdog?.checkIntervalMs,
    maxRetries: opts.watchdog?.maxRetries,
    now: opts.watchdog?.now,
    setIntervalFn: opts.watchdog?.setIntervalFn,
    clearIntervalFn: opts.watchdog?.clearIntervalFn,
    onStall: (event, action) => handleStall(event, action),
  })

  async function handleStall(event: StallEvent, action: StallAction): Promise<void> {
    const graph = activeGraphs.get(event.graph.id)
    if (!graph) return

    if (action === "retry") {
      for (const nodeId of event.runningNodeIds) {
        const sessionId = nodeToSession.get(nodeId)
        if (sessionId) {
          await registry.stop(sessionId, `dag stalled (${event.reason})`).catch(() => {})
          nodeToSession.delete(nodeId)
          nodeToGraph.delete(sessionId)
        }
        const node = nodeIndex(graph).get(nodeId)
        if (!node) continue
        if (node.status === "running") {
          node.status = "ready"
          node.error = undefined
          node.sessionId = undefined
        }
      }
      persist(graph)
      await commentUpdater(graph).catch(() => {})
      await tickGraph(graph)
      return
    }

    for (const nodeId of event.runningNodeIds) {
      const sessionId = nodeToSession.get(nodeId)
      if (sessionId) {
        await registry.stop(sessionId, `dag stalled (${event.reason})`).catch(() => {})
        nodeToSession.delete(nodeId)
        nodeToGraph.delete(sessionId)
      }
      const node = nodeIndex(graph).get(nodeId)
      if (!node) continue
      node.status = "failed"
      node.error = `dag stalled: ${event.reason}`
      failNode(graph, nodeId)
    }

    persist(graph)
    await commentUpdater(graph).catch(() => {})
    await tickGraph(graph)
  }

  function runningCount(graph: DagGraph): number {
    return graph.nodes.filter((n) => n.status === "running").length
  }

  function persist(graph: DagGraph): void {
    saveDag(graph, db)
    bus.emit({ kind: "dag.snapshot", dag: graphToApiDag(graph) })
  }

  function mapNodeStatus(status: DagNode["status"]): ApiDagNode["status"] {
    if (status === "done") return "completed"
    if (status === "ready") return "pending"
    return status
  }

  function graphToApiDag(graph: DagGraph): ApiDagGraph {
    const nodes: Record<string, ApiDagNode> = {}
    const sessionMap = new Map(registry.list().map((session) => [session.id, session]))
    for (const node of graph.nodes) {
      const dependents = graph.nodes
        .filter((n) => n.dependsOn.includes(node.id))
        .map((n) => n.id)
      nodes[node.id] = {
        id: node.id,
        slug: node.id,
        status: mapNodeStatus(node.status),
        dependencies: node.dependsOn,
        dependents,
        session: node.sessionId ? sessionMap.get(node.sessionId) : undefined,
      }
    }
    return {
      id: graph.id,
      rootTaskId: graph.rootSessionId,
      nodes,
      status: dagGraphStatus(graph),
      createdAt: new Date(graph.createdAt).toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  async function spawnNode(node: DagNode, graph: DagGraph): Promise<void> {
    if (cancelledDags.has(graph.id)) return
    if (runningCount(graph) >= MAX_DAG_CONCURRENCY) return

    node.status = "running"

    const upstreamBranches = getUpstreamBranches(graph, node.id)
    const parentConversation = fetchRootConversation(db, graph.rootSessionId)
    const prompt = buildDagChildPrompt(
      parentConversation,
      { id: node.id, title: node.title, description: node.description, dependsOn: node.dependsOn },
      nodesToDagInputs(graph.nodes),
      upstreamBranches,
      false,
    )

    try {
      const { session } = await registry.create({
        mode: "dag-task",
        prompt,
        repo: graph.repoUrl ?? graph.repo,
        startRef: upstreamBranches[upstreamBranches.length - 1],
        metadata: { dagId: graph.id, dagNodeId: node.id },
      })

      node.status = "running"
      node.sessionId = session.id
      nodeToSession.set(node.id, session.id)
      nodeToGraph.set(session.id, graph.id)

      bus.emit({
        kind: "dag.node.started",
        dagId: graph.id,
        nodeId: node.id,
        sessionId: session.id,
      })

      watchdog.notifyProgress(graph.id)
      persist(graph)
      await commentUpdater(graph)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      node.status = "failed"
      node.error = msg
      failNode(graph, node.id)
      watchdog.notifyProgress(graph.id)
      persist(graph)
      await commentUpdater(graph)
    }
  }

  async function tickGraph(graph: DagGraph): Promise<void> {
    if (cancelledDags.has(graph.id)) return

    const ready = readyNodes(graph)
    const available = MAX_DAG_CONCURRENCY - runningCount(graph)
    const toSpawn = ready.slice(0, available)

    for (const node of toSpawn) {
      await spawnNode(node, graph)
    }

    if (isDagComplete(graph)) {
      activeGraphs.delete(graph.id)
      watchdog.disarm(graph.id)
      persist(graph)
      if (!completedDags.has(graph.id)) {
        completedDags.add(graph.id)
        const status = dagGraphStatus(graph)
        bus.emit({
          kind: "dag.completed",
          dagId: graph.id,
          rootSessionId: graph.rootSessionId,
          status: status === "failed" ? "failed" : "completed",
        })
      }
    }
  }

  async function start(dagId: string): Promise<void> {
    const existing = loadDag(dagId, db)
    if (!existing) throw new Error(`DAG ${dagId} not found in store`)

    activeGraphs.set(dagId, existing)
    cancelledDags.delete(dagId)
    completedDags.delete(dagId)
    watchdog.arm(existing)

    await tickGraph(existing)
  }

  async function onSessionCompleted(sessionId: string, state: SessionRunState): Promise<void> {
    let dagId = nodeToGraph.get(sessionId)
    let nodeId: string | undefined

    if (dagId) {
      const nodeEntry = Array.from(nodeToSession.entries()).find(([, sid]) => sid === sessionId)
      if (nodeEntry) nodeId = nodeEntry[0]
    }

    if (!dagId || !nodeId) {
      const lookup = prepared.getDagNodeBySessionId(db, sessionId)
      if (!lookup) return
      dagId = lookup.dag_id
      nodeId = lookup.node_id
    }

    let graph = activeGraphs.get(dagId)
    if (!graph) {
      const stored = loadDag(dagId, db)
      if (!stored) return
      graph = stored
      activeGraphs.set(dagId, graph)
    }

    const idx = nodeIndex(graph)
    const node = idx.get(nodeId)
    if (!node) return
    if (node.status !== "running") return

    nodeToSession.delete(nodeId)
    nodeToGraph.delete(sessionId)

    if (state === "completed") {
      const { prUrl, branch } = readNodePrInfo(db, sessionId)
      if (branch) node.branch = branch
      if (prUrl) node.prUrl = prUrl

      if (prUrl) {
        const metaRow = db
          .query<{ metadata: string }, [string]>("SELECT metadata FROM sessions WHERE id = ?")
          .get(sessionId)

        let metadata: Record<string, unknown>
        try {
          const parsed = metaRow?.metadata ? JSON.parse(metaRow.metadata) : {}
          metadata = (parsed && typeof parsed === "object") ? parsed as Record<string, unknown> : {}
        } catch {
          metadata = {}
        }

        if (!metadata.ciBabysitStartedAt) {
          metadata.ciBabysitStartedAt = Date.now()
          metadata.ciBabysitTrigger = "completion"
          prepared.updateSession(db, {
            id: sessionId,
            metadata,
            updated_at: Date.now(),
          })
          void ciBabysitter.babysitDagChildCI(sessionId, prUrl)
        }
      }

      node.status = "done"
      advanceDag(graph)

      bus.emit({
        kind: "dag.node.completed",
        dagId,
        nodeId,
        sessionId,
        state: "completed",
      })
      watchdog.notifyResolved(dagId)
    } else {
      node.status = "failed"
      node.error = `session ended with state: ${state}`
      failNode(graph, nodeId)

      bus.emit({
        kind: "dag.node.completed",
        dagId,
        nodeId,
        sessionId,
        state: state === "quota_exhausted" ? "quota_exhausted" : "errored",
      })
      watchdog.notifyProgress(dagId)
    }

    persist(graph)
    await commentUpdater(graph)
    await tickGraph(graph)

    await drainDeferredRestacksForSession(sessionId)
  }

  async function cancel(dagId: string): Promise<void> {
    cancelledDags.add(dagId)
    watchdog.disarm(dagId)

    let graph = activeGraphs.get(dagId)
    if (!graph) {
      const stored = loadDag(dagId, db)
      if (!stored) return
      graph = stored
    }

    const sessionsToStop: string[] = []
    for (const node of graph.nodes) {
      if (isTerminalStatus(node.status)) continue

      const sessionId = nodeToSession.get(node.id) ?? node.sessionId
      if (sessionId) {
        if (node.status === "running") sessionsToStop.push(sessionId)
        nodeToSession.delete(node.id)
        nodeToGraph.delete(sessionId)
        prepared.deleteDeferredRestacksBySession(db, sessionId)
      }

      node.status = "cancelled"
      node.error = node.error ?? "dag cancelled"
    }

    persist(graph)
    await commentUpdater(graph).catch((err) => {
      console.error(`[scheduler] stack comment update failed during cancel:`, err)
    })
    activeGraphs.delete(dagId)

    for (const sessionId of sessionsToStop) {
      try {
        await registry.stop(sessionId, "dag cancelled")
      } catch (err) {
        console.error(`[scheduler] failed to stop session ${sessionId} during cancel:`, err)
      }
    }
    bus.emit({ kind: "dag.cancelled", dagId })
  }

  function status(dagId: string): DagStatusSnapshot {
    const graph = activeGraphs.get(dagId) ?? loadDag(dagId, db)
    if (!graph) {
      return { dagId, nodes: [] }
    }

    return {
      dagId,
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        status: n.status,
        sessionId: nodeToSession.get(n.id),
        error: n.error,
      })),
    }
  }

  async function retryNode(nodeId: string, dagId: string): Promise<void> {
    let graph = activeGraphs.get(dagId)
    if (!graph) {
      const stored = loadDag(dagId, db)
      if (!stored) throw new Error(`DAG ${dagId} not found`)
      graph = stored
      activeGraphs.set(dagId, graph)
      cancelledDags.delete(dagId)
    }
    completedDags.delete(dagId)

    resetFailedNode(graph, nodeId)
    watchdog.arm(graph)
    watchdog.notifyResolved(graph.id)
    persist(graph)
    await commentUpdater(graph)
    await tickGraph(graph)
  }

  async function onSessionResumed(sessionId: string): Promise<void> {
    const lookup = prepared.getDagNodeBySessionId(db, sessionId)
    if (!lookup) return

    let graph = activeGraphs.get(lookup.dag_id)
    if (!graph) {
      const stored = loadDag(lookup.dag_id, db)
      if (!stored) return
      graph = stored
      activeGraphs.set(lookup.dag_id, graph)
      cancelledDags.delete(lookup.dag_id)
    }

    const idx = nodeIndex(graph)
    const node = idx.get(lookup.node_id)
    if (!node) return
    if (node.status !== "failed" && node.status !== "ci-failed") return

    node.status = "running"
    node.error = undefined
    node.sessionId = sessionId
    nodeToSession.set(node.id, sessionId)
    nodeToGraph.set(sessionId, graph.id)

    watchdog.arm(graph)
    watchdog.notifyResolved(graph.id)
    persist(graph)
    await commentUpdater(graph).catch(() => {})
  }

  async function reconcileOnBoot(): Promise<void> {
    const graphs = listDags(db)
    for (const graph of graphs) {
      const nonTerminal = graph.nodes.some((n) =>
        n.status === "pending" || n.status === "ready" || n.status === "running"
      )
      if (!nonTerminal) continue

      activeGraphs.set(graph.id, graph)
      watchdog.arm(graph)

      for (const node of graph.nodes) {
        if (node.status !== "running") continue
        if (!node.sessionId) {
          node.status = "failed"
          node.error = "session id missing after engine restart"
          failNode(graph, node.id)
          continue
        }

        const row = db
          .query<{ status: string }, [string]>("SELECT status FROM sessions WHERE id = ?")
          .get(node.sessionId)

        if (!row) {
          node.status = "failed"
          node.error = "session row missing after engine restart"
          failNode(graph, node.id)
          continue
        }

        if (row.status === "completed") {
          const { prUrl, branch } = readNodePrInfo(db, node.sessionId)
          if (branch) node.branch = branch
          if (prUrl) node.prUrl = prUrl
          node.status = "done"
          advanceDag(graph)
        } else if (row.status === "failed") {
          node.status = "failed"
          node.error = "session ended (failed) while engine was down"
          failNode(graph, node.id)
        } else {
          nodeToSession.set(node.id, node.sessionId)
          nodeToGraph.set(node.sessionId, graph.id)
        }
      }

      persist(graph)
      await commentUpdater(graph).catch(() => {})
      await tickGraph(graph)
    }

    await reconcileDeferredRestacks()
  }

  async function reconcileDeferredRestacks(): Promise<void> {
    const rows = prepared.listAllDeferredRestacks(db)
    const sessionsStillRunning = new Set(nodeToSession.values())
    for (const row of rows) {
      if (sessionsStillRunning.has(row.session_id)) continue

      const dagGraph = activeGraphs.get(row.dag_id) ?? loadDag(row.dag_id, db)
      if (!dagGraph) {
        prepared.deleteDeferredRestack(db, row.id)
        continue
      }

      try {
        await restackManager.onParentPushed(rowToDeferredEvent(row), dagGraph)
      } catch (err) {
        console.error(`[scheduler] boot deferred restack failed for node ${row.node_id}:`, err)
      }
      prepared.deleteDeferredRestack(db, row.id)
    }
  }

  async function forceNodeLanded(nodeId: string, dagId: string): Promise<void> {
    let graph = activeGraphs.get(dagId)
    if (!graph) {
      const stored = loadDag(dagId, db)
      if (!stored) throw new Error(`DAG ${dagId} not found`)
      graph = stored
      activeGraphs.set(dagId, graph)
      cancelledDags.delete(dagId)
    }

    const idx = nodeIndex(graph)
    const node = idx.get(nodeId)
    if (!node) throw new Error(`node ${nodeId} not found in DAG ${dagId}`)

    node.status = "landed"
    advanceDag(graph)

    bus.emit({
      kind: "dag.node.landed",
      dagId,
      nodeId,
    })

    watchdog.notifyResolved(dagId)
    persist(graph)
    await commentUpdater(graph)
    await tickGraph(graph)
  }

  bus.onKind("dag.node.pushed", async (event) => {
    const graph = activeGraphs.get(event.dagId)
    if (!graph) return

    const idx = nodeIndex(graph)
    const node = idx.get(event.nodeId)
    if (!node) return

    if (node.status === "running") {
      const sessionId = node.sessionId
      if (sessionId) {
        prepared.insertDeferredRestack(db, {
          id: crypto.randomUUID(),
          dag_id: event.dagId,
          session_id: sessionId,
          node_id: event.nodeId,
          parent_sha: event.parentSha,
          new_sha: event.newSha,
          cascade_depth: 0,
          created_at: Date.now(),
        })
        console.log(`[scheduler] defer restack for running node ${event.nodeId}`)
        return
      }
    }

    await restackManager.onParentPushed(
      {
        dagId: event.dagId,
        nodeId: event.nodeId,
        parentSha: event.parentSha,
        newSha: event.newSha,
        cascadeDepth: 0,
      },
      graph,
    ).catch((err) => {
      console.error(`[scheduler] restack failed for node ${event.nodeId}:`, err)
    })
  })

  return {
    start,
    onSessionCompleted,
    onSessionResumed,
    cancel,
    status,
    retryNode,
    forceNodeLanded,
    reconcileOnBoot,
    persistDag: persist,
    watchdogTick: (at) => watchdog.tick(at),
    shutdown: () => watchdog.shutdown(),
  }
}
