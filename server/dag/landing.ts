import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { nodeIndex, getDownstreamNodes } from "./dag"
import type { DagGraph } from "./dag"
import type { EngineEventBus } from "../events/bus"
import type { ExecCall, ExecFn } from "./preflight"

const execFileP = promisify(execFileCb)

function defaultExec({ cmd, args, opts }: ExecCall): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, opts ?? {}) as Promise<{ stdout: string; stderr: string }>
}

export interface LandNodeResult {
  ok: boolean
  prUrl?: string
  error?: string
}

export interface LandingManagerOpts {
  bus: EngineEventBus
  execFile?: ExecFn
}

export interface LandingManager {
  landNode(nodeId: string, graph: DagGraph): Promise<LandNodeResult>
}

export function createLandingManager(opts: LandingManagerOpts): LandingManager {
  const { bus } = opts
  const run = opts.execFile ?? defaultExec

  async function retargetAllStackedPRs(graph: DagGraph): Promise<void> {
    const prNodes = graph.nodes.filter((n) => n.prUrl && n.status !== "landed")
    for (const node of prNodes) {
      try {
        await run({
          cmd: "gh",
          args: ["pr", "edit", node.prUrl!, "--base", "main"],
          opts: { timeout: 30_000, encoding: "utf-8" },
        })
      } catch (err) {
        console.error(`[landing] failed to retarget PR ${node.prUrl} to main:`, err)
      }
    }
  }

  async function rebaseDownstream(mergedNodeId: string, graph: DagGraph): Promise<void> {
    const downstream = getDownstreamNodes(graph, mergedNodeId)

    for (const node of downstream) {
      if (!node.branch || node.status === "landed") continue

      try {
        await run({ cmd: "git", args: ["fetch", "origin", "main"], opts: { timeout: 60_000, encoding: "utf-8" } })
        await run({
          cmd: "git",
          args: ["rebase", "origin/main"],
          opts: {
            timeout: 120_000,
            encoding: "utf-8",
            env: { ...process.env, GIT_SEQUENCE_EDITOR: "true" },
          },
        })
        await run({ cmd: "git", args: ["push", "--force-with-lease"], opts: { timeout: 60_000, encoding: "utf-8" } })
      } catch (err) {
        console.error(`[landing] rebase failed for node ${node.id} branch ${node.branch}:`, err)
      }
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

    bus.emit({
      kind: "dag.node.landed",
      dagId: graph.id,
      nodeId,
    })

    await rebaseDownstream(nodeId, graph)

    return { ok: true, prUrl: node.prUrl }
  }

  return { landNode }
}
