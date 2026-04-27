import type { Database } from "bun:sqlite"
import { dagGraphStatus, nodeIndex } from "./dag"
import type { DagGraph, DagNode } from "./dag"
import { prepared, getDb } from "../db/sqlite"

function graphToRows(graph: DagGraph): { dagRow: Parameters<typeof prepared.insertDag>[1]; nodeRows: Parameters<typeof prepared.upsertDagNode>[1][] } {
  const repo = graph.repoUrl ?? graph.repo ?? null
  const dagRow = {
    id: graph.id,
    root_task_id: graph.rootSessionId,
    status: dagGraphStatus(graph),
    repo: repo && repo.length > 0 ? repo : null,
    deadline_ms: graph.deadlineMs ?? null,
    created_at: graph.createdAt,
    updated_at: Date.now(),
  }

  const idx = nodeIndex(graph)
  const nodeRows = graph.nodes.map((node) => {
    const dependents: string[] = graph.nodes
      .filter((n) => n.dependsOn.includes(node.id))
      .map((n) => n.id)

    return {
      dag_id: graph.id,
      id: node.id,
      slug: node.id,
      status: mapNodeStatus(node.status),
      session_id: node.sessionId ?? null,
      dependencies: node.dependsOn,
      dependents,
      payload: nodeToPayload(node),
    }
  })

  void idx

  return { dagRow, nodeRows }
}

type DbNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "ci-pending" | "ci-failed" | "landed" | "cancelled"

function mapNodeStatus(status: DagNode["status"]): DbNodeStatus {
  if (status === "ready") return "pending"
  if (status === "done") return "completed"
  return status as DbNodeStatus
}

function mapNodeStatusBack(status: DbNodeStatus): DagNode["status"] {
  if (status === "completed") return "done"
  return status as DagNode["status"]
}

function nodeToPayload(node: DagNode): Record<string, unknown> {
  return {
    title: node.title,
    description: node.description,
    branch: node.branch ?? null,
    prUrl: node.prUrl ?? null,
    error: node.error ?? null,
    recoveryAttempted: node.recoveryAttempted ?? null,
    mergeBase: node.mergeBase ?? null,
    baseSha: node.baseSha ?? null,
    headSha: node.headSha ?? null,
    prCommentId: node.prCommentId ?? null,
    threadId: node.threadId ?? null,
    originalStatus: node.status,
  }
}

function payloadToNodeFields(payload: Record<string, unknown>): Partial<DagNode> {
  return {
    title: typeof payload.title === "string" ? payload.title : "",
    description: typeof payload.description === "string" ? payload.description : "",
    branch: typeof payload.branch === "string" ? payload.branch : undefined,
    prUrl: typeof payload.prUrl === "string" ? payload.prUrl : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
    recoveryAttempted: typeof payload.recoveryAttempted === "boolean" ? payload.recoveryAttempted : undefined,
    mergeBase: typeof payload.mergeBase === "string" ? payload.mergeBase : undefined,
    baseSha: typeof payload.baseSha === "string" ? payload.baseSha : undefined,
    headSha: typeof payload.headSha === "string" ? payload.headSha : undefined,
    prCommentId: typeof payload.prCommentId === "number" ? payload.prCommentId : undefined,
    threadId: typeof payload.threadId === "number" ? payload.threadId : undefined,
  }
}

export function loadDag(id: string, db?: Database): DagGraph | null {
  const database = db ?? getDb()
  const dagRow = prepared.getDag(database, id)
  if (!dagRow) return null

  const nodeRows = prepared.listDagNodes(database, id)

  const nodes: DagNode[] = nodeRows.map((row) => {
    const fields = payloadToNodeFields(row.payload)
    const originalStatus = typeof row.payload.originalStatus === "string"
      ? (row.payload.originalStatus as DagNode["status"])
      : mapNodeStatusBack(row.status)

    return {
      id: row.id,
      title: fields.title ?? row.id,
      description: fields.description ?? "",
      dependsOn: row.dependencies,
      status: originalStatus,
      branch: fields.branch,
      prUrl: fields.prUrl,
      error: fields.error,
      recoveryAttempted: fields.recoveryAttempted,
      mergeBase: fields.mergeBase,
      baseSha: fields.baseSha,
      headSha: fields.headSha,
      prCommentId: fields.prCommentId,
      threadId: fields.threadId,
      sessionId: row.session_id ?? undefined,
    }
  })

  return {
    id: dagRow.id,
    nodes,
    rootSessionId: dagRow.root_task_id,
    repo: dagRow.repo ?? "",
    createdAt: dagRow.created_at,
    deadlineMs: dagRow.deadline_ms ?? undefined,
  }
}

export function saveDag(graph: DagGraph, db?: Database): void {
  const database = db ?? getDb()
  const existing = prepared.getDag(database, graph.id)
  const { dagRow, nodeRows } = graphToRows(graph)

  if (existing) {
    prepared.updateDag(database, {
      id: dagRow.id,
      root_task_id: dagRow.root_task_id,
      status: dagRow.status,
      repo: dagRow.repo,
      deadline_ms: dagRow.deadline_ms,
      updated_at: dagRow.updated_at,
    })
  } else {
    prepared.insertDag(database, dagRow)
  }

  for (const nodeRow of nodeRows) {
    prepared.upsertDagNode(database, nodeRow)
  }
}

export function listDags(db?: Database): DagGraph[] {
  const database = db ?? getDb()
  const dagRows = prepared.listDags(database)
  const graphs: DagGraph[] = []
  for (const row of dagRows) {
    const graph = loadDag(row.id, database)
    if (graph) graphs.push(graph)
  }
  return graphs
}

export function deleteDag(id: string, db?: Database): void {
  const database = db ?? getDb()
  prepared.deleteDag(database, id)
}
