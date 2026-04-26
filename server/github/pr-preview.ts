import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import type { PrCheck, PrCheckStatus, PrPreview, PrState } from "../../shared/api-types"
import type { ExecFn } from "../dag/preflight"

const execFileP = promisify(execFileCb)

export type CheckRun = PrCheck

interface CacheEntry {
  value: PrPreview
  expiresAt: number
}

const TTL_MS = 10_000
const TIMEOUT_MS = 20_000
const cache = new Map<string, CacheEntry>()

function fromCache(prUrl: string): PrPreview | null {
  const entry = cache.get(prUrl)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(prUrl)
    return null
  }
  return entry.value
}

function toCache(prUrl: string, value: PrPreview): void {
  cache.set(prUrl, { value, expiresAt: Date.now() + TTL_MS })
}

function builtinExec(): ExecFn {
  return ({ cmd, args, opts }) =>
    execFileP(cmd, args, opts ?? {}) as Promise<{ stdout: string; stderr: string }>
}

function normalizeCheckStatus(status: string, conclusion: string | null): PrCheckStatus {
  if (conclusion === "success") return "success"
  if (conclusion === "failure") return "failure"
  if (conclusion === "neutral") return "neutral"
  if (conclusion === "skipped") return "skipped"
  if (conclusion === "cancelled") return "cancelled"
  if (conclusion === "action_required") return "action_required"
  if (conclusion === "timed_out") return "timed_out"
  if (status === "queued") return "queued"
  if (status === "in_progress") return "in_progress"
  if (status === "pending") return "pending"
  if (status === "completed") return conclusion === "success" ? "success" : "neutral"
  return "pending"
}

function parseChecks(raw: unknown): PrCheck[] {
  if (!Array.isArray(raw)) return []
  const result: PrCheck[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const obj = item as Record<string, unknown>
    const rawStatus = typeof obj["status"] === "string" ? obj["status"] : ""
    const conclusion = typeof obj["conclusion"] === "string" ? obj["conclusion"] : null
    result.push({
      name: typeof obj["name"] === "string" ? obj["name"] : "",
      status: normalizeCheckStatus(rawStatus, conclusion),
      conclusion: conclusion ?? undefined,
      url: typeof obj["link"] === "string"
        ? obj["link"]
        : typeof obj["url"] === "string"
        ? obj["url"]
        : undefined,
    })
  }
  return result
}

function normalizeState(value: unknown): PrState {
  if (value === "MERGED") return "merged"
  if (value === "CLOSED") return "closed"
  return "open"
}

function normalizeMergeable(value: unknown): boolean | null {
  if (value === "MERGEABLE") return true
  if (value === "CONFLICTING") return false
  return null
}

function parseAuthor(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return ""
  const login = (raw as Record<string, unknown>)["login"]
  return typeof login === "string" ? login : ""
}

export async function fetchPrPreview(
  prUrl: string,
  execFn?: ExecFn,
): Promise<PrPreview> {
  const cached = fromCache(prUrl)
  if (cached) return cached

  const run = execFn ?? builtinExec()

  const [viewResult, checksResult] = await Promise.all([
    run({
      cmd: "gh",
      args: [
        "pr",
        "view",
        prUrl,
        "--json",
        "number,url,title,body,state,isDraft,mergeable,headRefName,baseRefName,author,updatedAt",
      ],
      opts: { timeout: TIMEOUT_MS, encoding: "utf-8" },
    }).catch((err: unknown) => {
      throw new Error(`gh pr view failed: ${err instanceof Error ? err.message : String(err)}`)
    }),
    run({
      cmd: "gh",
      args: ["pr", "checks", prUrl, "--json", "name,status,conclusion,link"],
      opts: { timeout: TIMEOUT_MS, encoding: "utf-8" },
    }).catch(() => ({ stdout: "[]", stderr: "" })),
  ])

  let viewData: Record<string, unknown>
  try {
    const parsed = JSON.parse(viewResult.stdout) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("unexpected shape")
    }
    viewData = parsed as Record<string, unknown>
  } catch {
    throw new Error("Failed to parse gh pr view response")
  }

  let checksRaw: unknown
  try {
    checksRaw = JSON.parse(checksResult.stdout) as unknown
  } catch {
    checksRaw = []
  }

  const preview: PrPreview = {
    number: typeof viewData["number"] === "number" ? viewData["number"] : 0,
    url: typeof viewData["url"] === "string" ? viewData["url"] : prUrl,
    title: typeof viewData["title"] === "string" ? viewData["title"] : "",
    body: typeof viewData["body"] === "string" ? viewData["body"] : "",
    state: normalizeState(viewData["state"]),
    draft: viewData["isDraft"] === true,
    mergeable: normalizeMergeable(viewData["mergeable"]),
    branch: typeof viewData["headRefName"] === "string" ? viewData["headRefName"] : "",
    baseBranch: typeof viewData["baseRefName"] === "string" ? viewData["baseRefName"] : "",
    author: parseAuthor(viewData["author"]),
    updatedAt: typeof viewData["updatedAt"] === "string" ? viewData["updatedAt"] : new Date().toISOString(),
    checks: parseChecks(checksRaw),
  }

  toCache(prUrl, preview)
  return preview
}
