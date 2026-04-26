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
  retryNode?(nodeId: string, dagId: string): Promise<void>
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
      "SELECT type, payload FROM session_events WHERE session_id = ? AND type IN ('user_message','assistant_text') ORDER BY seq ASC",
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
    if (row.type === "user_message") {
      messages.push({ role: "user", text })
    } else if (row.type === "assistant_text" && payload.final === true) {
      messages.push({ role: "assistant", text })
    }
  }
  return messages
}

function getLastAssistantMessage(db: Database, sessionId: string): string {
  const maxTurnRow = db
    .query<{ max_turn: number | null }, [string]>(
      "SELECT MAX(turn) as max_turn FROM session_events WHERE session_id = ? AND type = 'assistant_text'",
    )
    .get(sessionId)
  const lastTurn = maxTurnRow?.max_turn ?? null
  if (lastTurn === null) return ""

  const rows = db
    .query<{ payload: string }, [string, number]>(
      "SELECT payload FROM session_events WHERE session_id = ? AND type = 'assistant_text' AND turn = ? ORDER BY seq ASC",
    )
    .all(sessionId, lastTurn)

  const blocks = new Map<string, string>()
  for (const row of rows) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>
    } catch {
      continue
    }
    const blockId = typeof payload.blockId === "string" ? payload.blockId : ""
    const text = typeof payload.text === "string" ? payload.text : ""
    const final = payload.final === true
    if (!blockId || !text) continue
    if (final) blocks.set(blockId, text)
    else if (!blocks.has(blockId)) blocks.set(blockId, text)
  }

  return Array.from(blocks.values()).filter((t) => t.length > 0).join("\n\n")
}

async function gate(sessionId: string, ctx: PlanActionCtx): Promise<string | null> {
  const row = prepared.getSession(ctx.db, sessionId)
  if (!row) return "session not found"
  if (row.pipeline_advancing) return "pipeline already advancing"
  return null
}

function setPipelineAdvancing(ctx: PlanActionCtx, sessionId: string, value: boolean): void {
  ctx.db.run(
    "UPDATE sessions SET pipeline_advancing = ?, updated_at = ? WHERE id = ?",
    [value ? 1 : 0, Date.now(), sessionId],
  )
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

  const graph = buildDag(dagId, items, sessionId, repo)
  saveDag(graph, ctx.db)
  await ctx.scheduler.start(dagId)

  return { ok: true, dagId }
}


const EXECUTE_DIRECTIVE_PLAN = [
  "Implement your plan now, in this session — do NOT wait for another turn.",
  "",
  "1. Write the code.",
  "2. Run the unit/integration tests (NOT e2e or browser tests — too expensive).",
  "3. `git add -A && git commit -m \"<descriptive message>\"`.",
  "4. `git push -u origin HEAD`. Auth is preconfigured via GIT_ASKPASS.",
  "5. `gh pr create` targeting `main` (no --draft, no --no-verify). Include a short summary and a test plan.",
  "6. End your turn with a single trailing line: `PR: <url>` — so the orchestrator can link the PR.",
  "",
  "If blocked, end with `BLOCKED: <one-line reason>` instead of stopping silently.",
].join("\n")

const EXECUTE_DIRECTIVE_THINK = [
  "Your previous output is research/analysis, not a concrete implementation plan.",
  "Pick the SINGLE highest-leverage item from your analysis above and implement only that one item now. If multiple items are equally compelling, choose the smallest scope first.",
  "Do NOT wait for another turn or ask which to pick — make the call yourself and act.",
  "",
  "1. State in one sentence which item you picked and why.",
  "2. Write the code.",
  "3. Run the unit/integration tests (NOT e2e or browser tests — too expensive).",
  "4. `git add -A && git commit -m \"<descriptive message>\"`.",
  "5. `git push -u origin HEAD`. Auth is preconfigured via GIT_ASKPASS.",
  "6. `gh pr create` targeting `main` (no --draft, no --no-verify). Include a short summary and a test plan.",
  "7. End your turn with a single trailing line: `PR: <url>` — so the orchestrator can link the PR.",
  "",
  "If blocked, end with `BLOCKED: <one-line reason>` instead of stopping silently.",
].join("\n")

export async function handleExecute(sessionId: string, ctx: PlanActionCtx): Promise<PlanActionResult> {
  const rejection = await gate(sessionId, ctx)
  if (rejection) return { ok: false, reason: rejection }

  const row = prepared.getSession(ctx.db, sessionId)
  const mode = row?.mode

  if (mode === "ship") {
    return { ok: false, reason: "use /dag to schedule a ship plan" }
  }

  if (mode === "think" || mode === "plan" || mode === "review") {
    setPipelineAdvancing(ctx, sessionId, true)
    try {
      await killAndWait(sessionId, ctx)
      const plan = getLastAssistantMessage(ctx.db, sessionId)
      if (!plan) {
        setPipelineAdvancing(ctx, sessionId, false)
        return { ok: false, reason: "no plan/analysis to execute" }
      }

      const directive = mode === "think" ? EXECUTE_DIRECTIVE_THINK : EXECUTE_DIRECTIVE_PLAN
      const prompt = [plan, "", directive].join("\n")

      const { session } = await ctx.registry.create({
        mode: "dag-task",
        prompt,
        repo: row?.repo ?? "",
        parentId: sessionId,
      })

      setPipelineAdvancing(ctx, sessionId, false)
      return { ok: true, dagId: session.id }
    } catch (err) {
      setPipelineAdvancing(ctx, sessionId, false)
      throw err
    }
  }

  if (mode === "task" || mode === "dag-task" || mode === "ship-verify") {
    try {
      const ok = await ctx.registry.reply(sessionId, EXECUTE_DIRECTIVE_PLAN)
      if (!ok) return { ok: false, reason: "could not inject execute directive into session" }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  return { ok: false, reason: `execute not supported for mode ${mode ?? "unknown"}` }
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

  const row = prepared.getSession(ctx.db, sessionId)
  if (row?.mode !== "ship") {
    await killAndWait(sessionId, ctx)
  }

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
