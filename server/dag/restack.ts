import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs"
import { nodeIndex } from "./dag"
import type { DagGraph, DagNode } from "./dag"
import type { EngineEventBus } from "../events/bus"
import type { ExecCall, ExecFn } from "./preflight"
import type { SessionRegistry } from "../session/registry"
import { createLogger } from "./logger"

const execFileP = promisify(execFileCb)
const log = createLogger("restack")

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
  registry: SessionRegistry
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
  const { bus, workspaceRoot, registry } = opts
  const run = opts.execFile ?? defaultExec

  const inflightRestacks = new Map<string, Promise<void>>()
  const lastRestackTime = new Map<string, number>()
  const resolverAttempts = new Map<string, number>()

  async function getCurrentSha(cwd: string): Promise<string> {
    const result = await run({
      cmd: "git",
      args: ["rev-parse", "HEAD"],
      opts: { cwd, timeout: 10_000, encoding: "utf-8" },
    })
    return result.stdout.trim()
  }

  async function getGitStatus(cwd: string): Promise<string> {
    try {
      const result = await run({
        cmd: "git",
        args: ["status"],
        opts: { cwd, timeout: 10_000, encoding: "utf-8" },
      })
      return result.stdout
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  async function spawnResolver(
    node: DagNode,
    graph: DagGraph,
    ctx: RestackContext,
    cwd: string,
  ): Promise<void> {
    const attemptKey = `${graph.id}:${node.id}:${ctx.parentSha}`
    const attempts = resolverAttempts.get(attemptKey) ?? 0

    if (attempts >= 1) {
      log.error({ dagId: graph.id, nodeId: node.id, attempts }, "max resolver attempts reached")
      node.status = "rebase-conflict"
      node.error = "Automatic conflict resolution failed"
      bus.emit({
        kind: "dag.node.restack.completed",
        dagId: graph.id,
        nodeId: node.id,
        result: "conflict",
        error: node.error,
      })
      return
    }

    resolverAttempts.set(attemptKey, attempts + 1)

    const gitStatus = await getGitStatus(cwd)
    const prompt = `Resolve the git rebase conflict in this workspace.

Current git status:
\`\`\`
${gitStatus}
\`\`\`

Context:
- Node: ${node.id} (${node.title})
- Rebasing onto: ${ctx.parentBranch}
- Parent SHA: ${ctx.parentSha}

Steps:
1. Examine the conflict markers in the affected files
2. Understand the parent's intent by reviewing the diff
3. Resolve conflicts appropriately
4. Run: git rebase --continue
5. Push changes: git push --force-with-lease

If the conflict cannot be resolved automatically or requires human judgment, run: git rebase --abort`

    try {
      const slug = node.branch!.startsWith("minion/") ? node.branch!.slice("minion/".length) : node.branch!
      await registry.create({
        mode: "rebase-resolver",
        prompt,
        repo: graph.repoUrl ?? graph.repo,
        slug,
        workspaceRoot,
        metadata: {
          dagId: graph.id,
          dagNodeId: node.id,
          parentBranch: ctx.parentBranch,
          parentSha: ctx.parentSha,
          resolverAttemptKey: attemptKey,
        },
      })
      log.info({ dagId: graph.id, nodeId: node.id, parentBranch: ctx.parentBranch, parentSha: ctx.parentSha }, "spawned resolver session")
    } catch (err) {
      log.error({ dagId: graph.id, nodeId: node.id, err }, "failed to spawn resolver")
      node.status = "rebase-conflict"
      node.error = `Failed to spawn resolver: ${err instanceof Error ? err.message : String(err)}`
      bus.emit({
        kind: "dag.node.restack.completed",
        dagId: graph.id,
        nodeId: node.id,
        result: "conflict",
        error: node.error,
      })
    }
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
      log.error({ dagId: graph.id, nodeId: node.id }, "skip node: no branch")
      return
    }

    const cwd = worktreeDir(workspaceRoot, node.branch)
    if (!fs.existsSync(cwd)) {
      log.error({ dagId: graph.id, nodeId: node.id, cwd }, "skip node: worktree missing")
      return
    }

    const now = Date.now()
    const lastTime = lastRestackTime.get(node.id) ?? 0
    if (now - lastTime < RESTACK_DEBOUNCE_MS) {
      log.info({ dagId: graph.id, nodeId: node.id, sinceMs: now - lastTime }, "debounce node restack")
      return
    }

    if (ctx.cascadeDepth >= MAX_RESTACK_DEPTH) {
      log.error({ dagId: graph.id, nodeId: node.id, maxDepth: MAX_RESTACK_DEPTH }, "max restack depth reached")
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
      log.error({ dagId: graph.id, nodeId: node.id, error: rebaseResult.error }, "rebase failed")
      node.status = "rebasing"
      node.error = rebaseResult.error
      await spawnResolver(node, graph, ctx, cwd)
      return
    }

    try {
      await run({
        cmd: "git",
        args: ["push", "--force-with-lease"],
        opts: { cwd, timeout: 60_000, encoding: "utf-8" },
      })
    } catch (err) {
      log.error({ dagId: graph.id, nodeId: node.id, err }, "force-push failed")
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
      log.error({ dagId: event.dagId, nodeId: event.nodeId }, "parent node has no branch")
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
        log.info({ dagId: graph.id, nodeId: child.id, parentNodeId: event.nodeId }, "defer restack for running node")
        continue
      }

      const existingRestack = inflightRestacks.get(child.id)
      if (existingRestack) {
        log.info({ dagId: graph.id, nodeId: child.id }, "restack already in flight")
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
