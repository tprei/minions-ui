import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { renderDagForGitHub, upsertDagSection } from "./dag"
import type { DagGraph } from "./dag"
import type { ExecCall, ExecFn } from "./preflight"
import { createLogger } from "./logger"

const execFileP = promisify(execFileCb)
const log = createLogger("stack-comment")

function defaultExec({ cmd, args, opts }: ExecCall): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, opts ?? {}) as Promise<{ stdout: string; stderr: string }>
}

export async function updateStackComment(graph: DagGraph, execFn: ExecFn = defaultExec): Promise<void> {
  const openPrNodes = graph.nodes.filter((n) => n.prUrl && n.status !== "landed")

  if (openPrNodes.length === 0) return

  const results = await Promise.allSettled(
    openPrNodes.map(async (node) => {
      const prUrl = node.prUrl!
      let existingBody: string
      try {
        const viewResult = await execFn({
          cmd: "gh",
          args: ["pr", "view", prUrl, "--json", "body"],
          opts: { timeout: 30_000, encoding: "utf-8" },
        })
        const parsed = JSON.parse(viewResult.stdout) as { body?: string }
        existingBody = parsed.body ?? ""
      } catch {
        existingBody = ""
      }

      const newBody = upsertDagSection(existingBody, renderDagForGitHub(graph, node.id))

      await execFn({
        cmd: "gh",
        args: ["pr", "edit", prUrl, "--body", newBody],
        opts: { timeout: 30_000, encoding: "utf-8" },
      })
    }),
  )

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const node = openPrNodes[i]!
      log.error({ dagId: graph.id, nodeId: node.id, prUrl: node.prUrl, err: result.reason }, "failed to update PR body")
    }
  })
}
