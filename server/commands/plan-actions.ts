import type { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import type { SessionRegistry } from "../session/registry"
import type { DagInput } from "../dag/dag"
import { buildDag } from "../dag/dag"
import { saveDag } from "../dag/store"
import { extractDagItems, extractStackItems, parseDagItems } from "../dag/dag-extract"
import { prepared } from "../db/sqlite"

export interface PlanScheduler {
  start(dagId: string): Promise<void>
}

export interface PlanActionCtx {
  db: Database
  registry: SessionRegistry
  scheduler: PlanScheduler
}

export interface PlanActionResult {
  ok: boolean
  dagId?: string
  reason?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getConversationMessages(db: Database, sessionId: string): Array<{ role: string; text: string }> {
  const rows = db
    .query<{ type: string; payload: string }, [string]>(
      "SELECT type, payload FROM session_events WHERE session_id = ? ORDER BY seq ASC",
    )
    .all(sessionId)

  const messages: Array<{ role: string; text: string }> = []
  for (const row of rows) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>
    } catch {
      continue
    }
    const text = typeof payload.text === "string" ? payload.text : ""
    if (!text) continue
    if (row.type === "assistant_message" || row.type === "assistant") {
      messages.push({ role: "assistant", text })
    } else if (row.type === "user_message" || row.type === "user") {
      messages.push({ role: "user", text })
    }
  }
  return messages
}

function getLastAssistantMessage(db: Database, sessionId: string): string {
  const rows = db
    .query<{ payload: string }, [string]>(
      "SELECT payload FROM session_events WHERE session_id = ? AND type IN ('assistant_message','assistant') ORDER BY seq DESC LIMIT 1",
    )
    .all(sessionId)
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>
      if (typeof payload.text === "string" && payload.text.length > 0) return payload.text
    } catch {
      continue
    }
  }
  return ""
}

async function gate(sessionId: string, ctx: PlanActionCtx): Promise<string | null> {
  const row = prepared.getSession(ctx.db, sessionId)
  if (!row) return "session not found"
  if (row.pipeline_advancing) return "pipeline already advancing"
  return null
}

async function killAndWait(sessionId: string, ctx: PlanActionCtx): Promise<void> {
  await ctx.registry.stop(sessionId)
  await sleep(2000)
}

async function buildAndStartDag(
  items: DagInput[],
  sessionId: string,
  ctx: PlanActionCtx,
): Promise<PlanActionResult> {
  if (items.length === 0) return { ok: false, reason: "no items extracted" }

  const dagId = randomUUID()
  const sessionRow = prepared.getSession(ctx.db, sessionId)
  const repo = sessionRow?.repo ?? ""

  const graph = buildDag(dagId, items, 0, repo)
  saveDag(graph, ctx.db)
  await ctx.scheduler.start(dagId)

  return { ok: true, dagId }
}

export async function handleExecute(sessionId: string, ctx: PlanActionCtx): Promise<PlanActionResult> {
  const rejection = await gate(sessionId, ctx)
  if (rejection) return { ok: false, reason: rejection }

  await killAndWait(sessionId, ctx)

  const conversation = getConversationMessages(ctx.db, sessionId)
  const typedConversation = conversation.map((m) => ({
    role: m.role as "user" | "assistant",
    text: m.text,
  }))

  const result = await extractDagItems(typedConversation)
  if (result.error) return { ok: false, reason: result.errorMessage ?? result.error }

  return buildAndStartDag(result.items, sessionId, ctx)
}

export async function handleSplit(sessionId: string, ctx: PlanActionCtx): Promise<PlanActionResult> {
  const rejection = await gate(sessionId, ctx)
  if (rejection) return { ok: false, reason: rejection }

  await killAndWait(sessionId, ctx)

  const conversation = getConversationMessages(ctx.db, sessionId)
  const typedConversation = conversation.map((m) => ({
    role: m.role as "user" | "assistant",
    text: m.text,
  }))

  const result = await extractDagItems(typedConversation)
  if (result.error) return { ok: false, reason: result.errorMessage ?? result.error }

  const parallelItems: DagInput[] = result.items.map((item) => ({ ...item, dependsOn: [] }))
  return buildAndStartDag(parallelItems, sessionId, ctx)
}

export async function handleStack(sessionId: string, ctx: PlanActionCtx): Promise<PlanActionResult> {
  const rejection = await gate(sessionId, ctx)
  if (rejection) return { ok: false, reason: rejection }

  await killAndWait(sessionId, ctx)

  const conversation = getConversationMessages(ctx.db, sessionId)
  const typedConversation = conversation.map((m) => ({
    role: m.role as "user" | "assistant",
    text: m.text,
  }))

  const result = await extractStackItems(typedConversation)
  if (result.error) return { ok: false, reason: result.errorMessage ?? result.error }

  const linearItems: DagInput[] = result.items.map((item, i) => ({
    ...item,
    id: item.id !== "" ? item.id : `step-${i}`,
    dependsOn: i > 0 ? [result.items[i - 1]?.id ?? `step-${i - 1}`] : [],
  }))

  return buildAndStartDag(linearItems, sessionId, ctx)
}

export async function handleDag(
  markdown: string,
  sessionId: string,
  ctx: PlanActionCtx,
): Promise<PlanActionResult> {
  const rejection = await gate(sessionId, ctx)
  if (rejection) return { ok: false, reason: rejection }

  await killAndWait(sessionId, ctx)

  let items: DagInput[]
  try {
    items = parseDagItems(markdown)
  } catch (e) {
    const lastMsg = getLastAssistantMessage(ctx.db, sessionId)
    if (!lastMsg) return { ok: false, reason: "no markdown provided and no last assistant message" }
    try {
      items = parseDagItems(lastMsg)
    } catch {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, reason: `could not parse DAG items: ${msg}` }
    }
  }

  return buildAndStartDag(items, sessionId, ctx)
}
