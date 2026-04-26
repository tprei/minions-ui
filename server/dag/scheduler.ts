import type { Database } from "bun:sqlite"
import { readyNodes, advanceDag, failNode, resetFailedNode, nodeIndex, getUpstreamBranches, isDagComplete, dagGraphStatus } from "./dag"
import type { DagGraph, DagNode, DagInput } from "./dag"
import { saveDag, loadDag, listDags } from "./store"
import { prepared } from "../db/sqlite"
import { updateStackComment } from "./stack-comment"
import { buildDagChildPrompt } from "./dag-extract"
import type { TopicMessage } from "./types"
import type { SessionRegistry } from "../session/registry"
import type { EngineEventBus } from "../events/bus"
import type { SessionRunState } from "../events/types"
import type { ApiDagNode, ApiDagGraph } from "../../shared/api-types"
import { advanceShip } from "../ship/coordinator"
import type { CIBabysitter } from "../handlers/types"

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
}

export function createDagScheduler(opts: DagSchedulerOpts): DagScheduler {
  const { registry, db, bus, ciBabysitter } = opts
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
      await advanceShip(graph.rootSessionId, "verify", { db, registry, scheduler: { start } })
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

  async function onSessionResumed(sessionId: string): Promise<void> {
    const row = prepared.getSession(db, sessionId)
    if (!row) return
    const meta = row.metadata as { dagId?: string; dagNodeId?: string }
    if (!meta.dagId || !meta.dagNodeId) return

    let graph = activeGraphs.get(meta.dagId)
    if (!graph) {
      const stored = loadDag(meta.dagId, db)
      if (!stored) return
      graph = stored
      activeGraphs.set(meta.dagId, graph)
      cancelledDags.delete(meta.dagId)
    }

    const idx = nodeIndex(graph)
    const node = idx.get(meta.dagNodeId)
    if (!node) return
    if (node.status !== "failed" && node.status !== "ci-failed") return

    node.status = "running"
    node.error = undefined
    node.sessionId = sessionId
    nodeToSession.set(node.id, sessionId)
    nodeToGraph.set(sessionId, graph.id)

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

  return { start, onSessionCompleted, onSessionResumed, cancel, status, retryNode, forceNodeLanded, reconcileOnBoot }
}
