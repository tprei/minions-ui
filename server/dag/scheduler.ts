import type { Database } from "bun:sqlite"
import { readyNodes, advanceDag, failNode, resetFailedNode, nodeIndex, getUpstreamBranches, isDagComplete } from "./dag"
import type { DagGraph, DagNode } from "./dag"
import { saveDag, loadDag, listDags } from "./store"
import { updateStackComment } from "./stack-comment"
import type { SessionRegistry } from "../session/registry"
import type { EngineEventBus } from "../events/bus"
import type { SessionRunState } from "../events/types"
import type { ApiDagNode, ApiDagGraph } from "../../shared/api-types"

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
  updateStackComment?: (graph: DagGraph) => Promise<void>
}

export interface DagScheduler {
  start(dagId: string): Promise<void>
  onSessionCompleted(sessionId: string, state: SessionRunState): Promise<void>
  cancel(dagId: string): Promise<void>
  status(dagId: string): DagStatusSnapshot
  retryNode(nodeId: string, dagId: string): Promise<void>
  forceNodeLanded(nodeId: string, dagId: string): Promise<void>
  reconcileOnBoot(): Promise<void>
}

export function createDagScheduler(opts: DagSchedulerOpts): DagScheduler {
  const { registry, db, bus } = opts
  const commentUpdater = opts.updateStackComment ?? updateStackComment

  const activeGraphs = new Map<string, DagGraph>()
  const nodeToSession = new Map<string, string>()
  const nodeToGraph = new Map<string, string>()
  const cancelledDags = new Set<string>()

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
      }
    }
    return {
      id: graph.id,
      rootTaskId: graph.rootSessionId,
      nodes,
      status: "running",
      createdAt: new Date(graph.createdAt).toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  async function spawnNode(node: DagNode, graph: DagGraph): Promise<void> {
    if (cancelledDags.has(graph.id)) return
    if (runningCount(graph) >= MAX_DAG_CONCURRENCY) return

    node.status = "running"

    const upstreamBranches = getUpstreamBranches(graph, node.id)

    let prompt = `${node.title}\n\n${node.description}`

    if (upstreamBranches.length > 0) {
      const cherryPickInfo = upstreamBranches.join(", ")
      prompt = `${prompt}\n\nUpstream branches to incorporate: ${cherryPickInfo}`
    }

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

      persist(graph)
      await commentUpdater(graph)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      node.status = "failed"
      node.error = msg
      failNode(graph, node.id)
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
      persist(graph)
    }
  }

  async function start(dagId: string): Promise<void> {
    const existing = loadDag(dagId, db)
    if (!existing) throw new Error(`DAG ${dagId} not found in store`)

    activeGraphs.set(dagId, existing)
    cancelledDags.delete(dagId)

    await tickGraph(existing)
  }

  async function onSessionCompleted(sessionId: string, state: SessionRunState): Promise<void> {
    const dagId = nodeToGraph.get(sessionId)
    if (!dagId) return

    const graph = activeGraphs.get(dagId)
    if (!graph) return

    const nodeEntry = Array.from(nodeToSession.entries()).find(([, sid]) => sid === sessionId)
    if (!nodeEntry) return
    const [nodeId] = nodeEntry

    const idx = nodeIndex(graph)
    const node = idx.get(nodeId)
    if (!node) return

    nodeToSession.delete(nodeId)
    nodeToGraph.delete(sessionId)

    if (state === "completed") {
      const { prUrl, branch } = readNodePrInfo(db, sessionId)
      if (branch) node.branch = branch
      if (prUrl) node.prUrl = prUrl
      node.status = "done"
      advanceDag(graph)

      bus.emit({
        kind: "dag.node.completed",
        dagId,
        nodeId,
        sessionId,
        state: "completed",
      })
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
    }

    persist(graph)
    await commentUpdater(graph)
    await tickGraph(graph)
  }

  async function cancel(dagId: string): Promise<void> {
    cancelledDags.add(dagId)
    const graph = activeGraphs.get(dagId)
    if (!graph) return

    const runningNodes = graph.nodes.filter((n) => n.status === "running")
    for (const node of runningNodes) {
      const sessionId = nodeToSession.get(node.id)
      if (sessionId) {
        await registry.stop(sessionId, "dag cancelled")
        nodeToSession.delete(node.id)
        nodeToGraph.delete(sessionId)
      }
      node.status = "failed"
      node.error = "dag cancelled"
    }

    persist(graph)
    activeGraphs.delete(dagId)
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

    resetFailedNode(graph, nodeId)
    persist(graph)
    await commentUpdater(graph)
    await tickGraph(graph)
  }

  async function reconcileOnBoot(): Promise<void> {
    const graphs = listDags(db)
    for (const graph of graphs) {
      const nonTerminal = graph.nodes.some((n) =>
        n.status === "pending" || n.status === "ready" || n.status === "running"
      )
      if (!nonTerminal) continue

      activeGraphs.set(graph.id, graph)

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

    persist(graph)
    await commentUpdater(graph)
    await tickGraph(graph)
  }

  return { start, onSessionCompleted, cancel, status, retryNode, forceNodeLanded, reconcileOnBoot }
}
