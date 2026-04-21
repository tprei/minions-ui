import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import type { ExecFn } from "../dag/preflight"

const execFileP = promisify(execFileCb)

export interface CheckRun {
  name: string
  status: string
  conclusion: string | null
  url: string | null
}

export interface PrPreview {
  title: string
  state: string
  mergeable: string | null
  updatedAt: string
  checks: CheckRun[]
}

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

function parseChecks(raw: unknown): CheckRun[] {
  if (!Array.isArray(raw)) return []
  const result: CheckRun[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const obj = item as Record<string, unknown>
    result.push({
      name: typeof obj["name"] === "string" ? obj["name"] : "",
      status: typeof obj["status"] === "string" ? obj["status"] : "",
      conclusion: typeof obj["conclusion"] === "string" ? obj["conclusion"] : null,
      url: typeof obj["link"] === "string"
        ? obj["link"]
        : typeof obj["url"] === "string"
        ? obj["url"]
        : null,
    })
  }
  return result
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
      args: ["pr", "view", prUrl, "--json", "title,state,mergeable,updatedAt"],
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
    title: typeof viewData["title"] === "string" ? viewData["title"] : "",
    state: typeof viewData["state"] === "string" ? viewData["state"] : "",
    mergeable: typeof viewData["mergeable"] === "string" ? viewData["mergeable"] : null,
    updatedAt: typeof viewData["updatedAt"] === "string" ? viewData["updatedAt"] : new Date().toISOString(),
    checks: parseChecks(checksRaw),
  }

  toCache(prUrl, preview)
  return preview
}
