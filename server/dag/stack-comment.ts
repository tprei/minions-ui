import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { renderDagForGitHub, upsertDagSection } from "./dag"
import type { DagGraph } from "./dag"
import type { ExecCall, ExecFn } from "./preflight"

const execFileP = promisify(execFileCb)

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

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[stack-comment] failed to update PR:", result.reason)
    }
  }
}
