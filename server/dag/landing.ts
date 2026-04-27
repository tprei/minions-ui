import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import crypto from "node:crypto"
import { nodeIndex, getDownstreamNodes } from "./dag"
import type { DagGraph, DagNode } from "./dag"
import type { EngineEventBus } from "../events/bus"
import type { ExecCall, ExecFn } from "./preflight"
import type { SessionRegistry } from "../session/registry"
import { createLogger } from "./logger"

const execFileP = promisify(execFileCb)
const log = createLogger("landing")

function defaultExec({ cmd, args, opts }: ExecCall): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, opts ?? {}) as Promise<{ stdout: string; stderr: string }>
}

export type LandingMode = "best-effort" | "all-or-nothing"

export interface LandNodeResult {
  ok: boolean
  prUrl?: string
  error?: string
  closedSessionId?: string
  mergeCommitSha?: string
}

export interface LandRollbackEntry {
  nodeId: string
  prUrl?: string
  mergeCommitSha?: string
  reverted: boolean
  revertCommitSha?: string
  error?: string
}

export interface LandSequenceResult {
  ok: boolean
  mode: LandingMode
  attempted: number
  landed: LandNodeResult[]
  failed: LandNodeResult[]
  aborted: boolean
  rollback?: {
    attempted: boolean
    fullySuccessful: boolean
    entries: LandRollbackEntry[]
    error?: string
  }
}

export interface LandingManagerOpts {
  bus: EngineEventBus
  workspaceRoot: string
  execFile?: ExecFn
  registry?: SessionRegistry
  persistDag?: (graph: DagGraph) => void
  resolveBareDir?: (graph: DagGraph) => string | null
}

export interface LandSequenceOpts {
  mode?: LandingMode
}

export interface LandingManager {
  landNode(nodeId: string, graph: DagGraph): Promise<LandNodeResult>
  landSequence(nodeIds: string[], graph: DagGraph, opts?: LandSequenceOpts): Promise<LandSequenceResult>
}

interface ParsedPrUrl {
  owner: string
  repo: string
  number: string
}

function parsePrUrl(prUrl: string): ParsedPrUrl | null {
  const m = prUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!m) return null
  return { owner: m[1]!, repo: m[2]!, number: m[3]! }
}

function worktreeDir(workspaceRoot: string, branch: string): string {
  const slug = branch.startsWith("minion/") ? branch.slice("minion/".length) : branch
  return path.join(workspaceRoot, slug)
}

function defaultResolveBareDir(workspaceRoot: string, graph: DagGraph): string | null {
  const repoUrl = graph.repoUrl ?? graph.repo
  if (!repoUrl) return null
  const segment = repoUrl.split("/").pop() ?? repoUrl
  const repoName = segment.replace(/\.git$/, "")
  if (!repoName) return null
  return path.join(workspaceRoot, ".repos", `${repoName}.git`)
}

export function createLandingManager(opts: LandingManagerOpts): LandingManager {
  const { bus, workspaceRoot, registry, persistDag } = opts
  const run = opts.execFile ?? defaultExec
  const resolveBareDir = opts.resolveBareDir ?? ((graph: DagGraph) => defaultResolveBareDir(workspaceRoot, graph))

  async function retargetAllStackedPRs(graph: DagGraph): Promise<void> {
    const prNodes = graph.nodes.filter((n) => n.prUrl && n.status !== "landed")
    for (const node of prNodes) {
      const parsed = parsePrUrl(node.prUrl!)
      if (!parsed) {
        log.error({ dagId: graph.id, nodeId: node.id, prUrl: node.prUrl }, "cannot parse PR URL")
        continue
      }
      try {
        await run({
          cmd: "gh",
          args: [
            "api",
            "--method",
            "PATCH",
            `/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
            "-f",
            "base=main",
          ],
          opts: { timeout: 30_000, encoding: "utf-8" },
        })
      } catch (err) {
        log.error({ dagId: graph.id, nodeId: node.id, prUrl: node.prUrl, err }, "failed to retarget PR to main")
      }
    }
  }

  async function rebaseDownstream(mergedNodeId: string, graph: DagGraph): Promise<void> {
    const downstream = getDownstreamNodes(graph, mergedNodeId)

    for (const node of downstream) {
      if (!node.branch || node.status === "landed") continue

      const cwd = worktreeDir(workspaceRoot, node.branch)
      if (!fs.existsSync(cwd)) {
        log.error({ dagId: graph.id, nodeId: node.id, cwd }, "skip rebase: worktree missing")
        continue
      }

      try {
        await run({ cmd: "git", args: ["fetch", "origin", "main"], opts: { cwd, timeout: 60_000, encoding: "utf-8" } })
        await run({
          cmd: "git",
          args: ["rebase", "origin/main"],
          opts: {
            cwd,
            timeout: 120_000,
            encoding: "utf-8",
            env: { ...process.env, GIT_SEQUENCE_EDITOR: "true" },
          },
        })
        await run({ cmd: "git", args: ["push", "--force-with-lease"], opts: { cwd, timeout: 60_000, encoding: "utf-8" } })
      } catch (err) {
        log.error({ dagId: graph.id, nodeId: node.id, branch: node.branch, err }, "rebase failed")
      }
    }
  }

  async function fetchMergeCommitSha(prUrl: string): Promise<string | undefined> {
    try {
      const { stdout } = await run({
        cmd: "gh",
        args: ["pr", "view", prUrl, "--json", "mergeCommit", "-q", ".mergeCommit.oid"],
        opts: { timeout: 30_000, encoding: "utf-8" },
      })
      const sha = stdout.trim()
      return sha.length > 0 ? sha : undefined
    } catch (err) {
      console.error(`[landing] failed to fetch merge commit SHA for ${prUrl}:`, err)
      return undefined
    }
  }

  async function landNode(nodeId: string, graph: DagGraph): Promise<LandNodeResult> {
    const idx = nodeIndex(graph)
    const node = idx.get(nodeId)
    if (!node) {
      return { ok: false, error: `node ${nodeId} not found in graph` }
    }

    if (!node.prUrl) {
      return { ok: false, error: `node ${nodeId} has no PR URL` }
    }

    await retargetAllStackedPRs(graph)

    try {
      await run({
        cmd: "gh",
        args: ["pr", "merge", node.prUrl, "--squash", "--delete-branch"],
        opts: { timeout: 120_000, encoding: "utf-8" },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, prUrl: node.prUrl, error: `merge failed: ${msg}` }
    }

    node.status = "landed"

    const mergeCommitSha = await fetchMergeCommitSha(node.prUrl)

    if (persistDag) {
      try {
        persistDag(graph)
      } catch (err) {
        log.error({ dagId: graph.id, nodeId, err }, "persistDag failed")
      }
    }

    let closedSessionId: string | undefined
    if (registry && node.sessionId) {
      try {
        await registry.close(node.sessionId)
        closedSessionId = node.sessionId
      } catch (err) {
        log.error({ dagId: graph.id, nodeId, sessionId: node.sessionId, err }, "failed to close session")
      }
    }

    bus.emit({
      kind: "dag.node.landed",
      dagId: graph.id,
      nodeId,
    })

    await rebaseDownstream(nodeId, graph)

    return { ok: true, prUrl: node.prUrl, closedSessionId, mergeCommitSha }
  }

  async function revertMergedCommits(
    landed: LandNodeResult[],
    graph: DagGraph,
  ): Promise<{ entries: LandRollbackEntry[]; error?: string }> {
    const idx = nodeIndex(graph)
    const entries: LandRollbackEntry[] = landed.map((r) => ({
      nodeId: nodeIdForResult(r, graph) ?? "",
      prUrl: r.prUrl,
      mergeCommitSha: r.mergeCommitSha,
      reverted: false,
    }))

    const bareDir = resolveBareDir(graph)
    if (!bareDir) {
      const error = "rollback skipped: bare repo path could not be resolved"
      for (const entry of entries) entry.error = error
      return { entries, error }
    }

    let scratch: string
    try {
      scratch = await createScratchWorktree(bareDir)
    } catch (err) {
      const error = `rollback skipped: failed to create scratch worktree: ${errMessage(err)}`
      for (const entry of entries) entry.error = error
      return { entries, error }
    }

    try {
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]!
        if (!entry.mergeCommitSha) {
          entry.error = "no merge commit SHA captured; cannot revert"
          continue
        }
        try {
          await run({
            cmd: "git",
            args: ["revert", "--no-edit", entry.mergeCommitSha],
            opts: { cwd: scratch, timeout: 60_000, encoding: "utf-8" },
          })
          const headOut = await run({
            cmd: "git",
            args: ["rev-parse", "HEAD"],
            opts: { cwd: scratch, timeout: 30_000, encoding: "utf-8" },
          })
          entry.revertCommitSha = headOut.stdout.trim() || undefined
          await run({
            cmd: "git",
            args: ["push", "origin", "HEAD:main"],
            opts: { cwd: scratch, timeout: 60_000, encoding: "utf-8" },
          })
          entry.reverted = true

          const node = idx.get(entry.nodeId)
          if (node && node.status === "landed") {
            node.status = "done"
          }

          bus.emit({
            kind: "dag.node.land_reverted",
            dagId: graph.id,
            nodeId: entry.nodeId,
          })
        } catch (err) {
          entry.error = `revert failed: ${errMessage(err)}`
          break
        }
      }
    } finally {
      if (persistDag) {
        try {
          persistDag(graph)
        } catch (err) {
          console.error(`[landing] persistDag failed during rollback:`, err)
        }
      }
      try {
        await run({
          cmd: "git",
          args: ["worktree", "remove", "--force", scratch],
          opts: { cwd: bareDir, timeout: 30_000, encoding: "utf-8" },
        })
      } catch {
        // best-effort cleanup
      }
      try {
        if (fs.existsSync(scratch)) fs.rmSync(scratch, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
    }

    return { entries }
  }

  async function createScratchWorktree(bareDir: string): Promise<string> {
    const scratch = path.join(os.tmpdir(), `minion-landing-rollback-${crypto.randomBytes(6).toString("hex")}`)
    await run({
      cmd: "git",
      args: ["fetch", "origin", "main"],
      opts: { cwd: bareDir, timeout: 60_000, encoding: "utf-8" },
    })
    await run({
      cmd: "git",
      args: ["worktree", "add", "--detach", scratch, "origin/main"],
      opts: { cwd: bareDir, timeout: 60_000, encoding: "utf-8" },
    })
    return scratch
  }

  async function landSequence(
    nodeIds: string[],
    graph: DagGraph,
    sequenceOpts?: LandSequenceOpts,
  ): Promise<LandSequenceResult> {
    const mode: LandingMode = sequenceOpts?.mode ?? "best-effort"
    const landed: LandNodeResult[] = []
    const failed: LandNodeResult[] = []
    let aborted = false

    for (const nodeId of nodeIds) {
      const result = await landNode(nodeId, graph)
      if (result.ok) {
        landed.push({ ...result })
      } else {
        failed.push({ ...result, error: result.error, prUrl: result.prUrl })
        if (mode === "all-or-nothing") {
          aborted = true
          break
        }
      }
    }

    let rollback: LandSequenceResult["rollback"]
    if (mode === "all-or-nothing" && failed.length > 0 && landed.length > 0) {
      const { entries, error } = await revertMergedCommits(landed, graph)
      const fullySuccessful = entries.every((e) => e.reverted)
      rollback = {
        attempted: true,
        fullySuccessful,
        entries,
        ...(error ? { error } : {}),
      }
    }

    return {
      ok: failed.length === 0,
      mode,
      attempted: landed.length + failed.length,
      landed,
      failed,
      aborted,
      ...(rollback ? { rollback } : {}),
    }
  }

  return { landNode, landSequence }
}

function nodeIdForResult(result: LandNodeResult, graph: DagGraph): string | null {
  if (!result.prUrl) return null
  const match = graph.nodes.find((n) => n.prUrl === result.prUrl)
  return match?.id ?? null
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function nodeForLandResult(result: LandNodeResult, graph: DagGraph): DagNode | undefined {
  if (!result.prUrl) return undefined
  return graph.nodes.find((n) => n.prUrl === result.prUrl)
}
