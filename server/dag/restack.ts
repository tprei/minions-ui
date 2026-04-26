import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs"
import { nodeIndex } from "./dag"
import type { DagGraph, DagNode } from "./dag"
import type { EngineEventBus } from "../events/bus"
import type { ExecCall, ExecFn } from "./preflight"

const execFileP = promisify(execFileCb)

const MAX_RESTACK_DEPTH = Number(process.env["MAX_RESTACK_DEPTH"] ?? 5)
const RESTACK_DEBOUNCE_MS = Number(process.env["RESTACK_DEBOUNCE_MS"] ?? 10_000)

function defaultExec({ cmd, args, opts }: ExecCall): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, opts ?? {}) as Promise<{ stdout: string; stderr: string }>
}

function worktreeDir(workspaceRoot: string, branch: string): string {
  const slug = branch.startsWith("minion/") ? branch.slice("minion/".length) : branch
  return path.join(workspaceRoot, slug)
}

export interface RestackManagerOpts {
  bus: EngineEventBus
  workspaceRoot: string
  execFile?: ExecFn
}

export interface RestackManager {
  onParentPushed(event: {
    dagId: string
    nodeId: string
    parentSha: string
    newSha: string
    cascadeDepth: number
  }, graph: DagGraph): Promise<void>
}

interface RestackContext {
  parentNodeId: string
  parentBranch: string
  parentSha: string
  cascadeDepth: number
}

export function createRestackManager(opts: RestackManagerOpts): RestackManager {
  const { bus, workspaceRoot } = opts
  const run = opts.execFile ?? defaultExec

  const inflightRestacks = new Map<string, Promise<void>>()
  const lastRestackTime = new Map<string, number>()

  async function getCurrentSha(cwd: string): Promise<string> {
    const result = await run({
      cmd: "git",
      args: ["rev-parse", "HEAD"],
      opts: { cwd, timeout: 10_000, encoding: "utf-8" },
    })
    return result.stdout.trim()
  }

  async function rebaseOntoParent(
    node: DagNode,
    parentBranch: string,
    cwd: string,
  ): Promise<{ success: boolean; newSha?: string; error?: string }> {
    try {
      await run({
        cmd: "git",
        args: ["fetch", "origin", parentBranch],
        opts: { cwd, timeout: 60_000, encoding: "utf-8" },
      })

      await run({
        cmd: "git",
        args: ["rebase", `origin/${parentBranch}`],
        opts: {
          cwd,
          timeout: 120_000,
          encoding: "utf-8",
          env: { ...process.env, GIT_SEQUENCE_EDITOR: "true" },
        },
      })

      const newSha = await getCurrentSha(cwd)
      return { success: true, newSha }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  async function restackNode(
    node: DagNode,
    graph: DagGraph,
    ctx: RestackContext,
  ): Promise<void> {
    if (!node.branch) {
      console.error(`[restack] skip node ${node.id}: no branch`)
      return
    }

    const cwd = worktreeDir(workspaceRoot, node.branch)
    if (!fs.existsSync(cwd)) {
      console.error(`[restack] skip node ${node.id}: worktree ${cwd} missing`)
      return
    }

    const now = Date.now()
    const lastTime = lastRestackTime.get(node.id) ?? 0
    if (now - lastTime < RESTACK_DEBOUNCE_MS) {
      console.log(`[restack] debounce node ${node.id}: ${now - lastTime}ms since last restack`)
      return
    }

    if (ctx.cascadeDepth >= MAX_RESTACK_DEPTH) {
      console.error(`[restack] max depth ${MAX_RESTACK_DEPTH} reached for node ${node.id}`)
      node.status = "rebase-conflict"
      node.error = `Max restack depth (${MAX_RESTACK_DEPTH}) exceeded`
      bus.emit({
        kind: "dag.node.restack.completed",
        dagId: graph.id,
        nodeId: node.id,
        result: "conflict",
        error: node.error,
      })
      return
    }

    const priorStatus = node.status
    node.status = "rebasing"
    lastRestackTime.set(node.id, now)

    bus.emit({
      kind: "dag.node.restack.started",
      dagId: graph.id,
      nodeId: node.id,
      parentNodeId: ctx.parentNodeId,
    })

    const rebaseResult = await rebaseOntoParent(node, ctx.parentBranch, cwd)

    if (!rebaseResult.success) {
      console.error(`[restack] rebase failed for node ${node.id}:`, rebaseResult.error)
      node.status = "rebasing"
      node.error = rebaseResult.error
      return
    }

    try {
      await run({
        cmd: "git",
        args: ["push", "--force-with-lease"],
        opts: { cwd, timeout: 60_000, encoding: "utf-8" },
      })
    } catch (err) {
      console.error(`[restack] force-push failed for node ${node.id}:`, err)
      node.status = priorStatus
      node.error = err instanceof Error ? err.message : String(err)
      bus.emit({
        kind: "dag.node.restack.completed",
        dagId: graph.id,
        nodeId: node.id,
        result: "conflict",
        error: node.error,
      })
      return
    }

    node.status = priorStatus
    node.error = undefined
    node.headSha = rebaseResult.newSha

    bus.emit({
      kind: "dag.node.restack.completed",
      dagId: graph.id,
      nodeId: node.id,
      result: "resolved",
    })

    const oldSha = node.headSha ?? ""
    bus.emit({
      kind: "dag.node.pushed",
      dagId: graph.id,
      nodeId: node.id,
      parentSha: oldSha,
      newSha: rebaseResult.newSha!,
    })
  }

  async function onParentPushed(
    event: {
      dagId: string
      nodeId: string
      parentSha: string
      newSha: string
      cascadeDepth: number
    },
    graph: DagGraph,
  ): Promise<void> {
    const idx = nodeIndex(graph)
    const parent = idx.get(event.nodeId)
    if (!parent || !parent.branch) {
      console.error(`[restack] parent node ${event.nodeId} has no branch`)
      return
    }

    const childrenIndex = new Map<string, DagNode[]>()
    for (const node of graph.nodes) {
      childrenIndex.set(node.id, [])
    }
    for (const node of graph.nodes) {
      for (const dep of node.dependsOn) {
        childrenIndex.get(dep)?.push(node)
      }
    }

    const directChildren = childrenIndex.get(event.nodeId) ?? []

    const ctx: RestackContext = {
      parentNodeId: event.nodeId,
      parentBranch: parent.branch,
      parentSha: event.newSha,
      cascadeDepth: event.cascadeDepth + 1,
    }

    for (const child of directChildren) {
      if (child.status === "running") {
        console.log(`[restack] defer restack for running node ${child.id}`)
        continue
      }

      const existingRestack = inflightRestacks.get(child.id)
      if (existingRestack) {
        console.log(`[restack] restack already in flight for node ${child.id}`)
        await existingRestack
        continue
      }

      const restackPromise = restackNode(child, graph, ctx).finally(() => {
        inflightRestacks.delete(child.id)
      })
      inflightRestacks.set(child.id, restackPromise)
      await restackPromise
    }
  }

  return { onParentPushed }
}
