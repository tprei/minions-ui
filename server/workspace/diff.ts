import type { ExecFn } from "../dag/preflight"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"

const execFileP = promisify(execFileCb)

export interface DiffResult {
  patch: string
  truncated: boolean
  base: string
}

const MAX_PATCH_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 30_000

function builtinExec(): ExecFn {
  return ({ cmd, args, opts }) =>
    execFileP(cmd, args, opts ?? {}) as Promise<{ stdout: string; stderr: string }>
}

export async function computeWorkspaceDiff(
  cwd: string,
  headBranch?: string,
  execFn?: ExecFn,
): Promise<DiffResult> {
  const run = execFn ?? builtinExec()

  await run({
    cmd: "git",
    args: ["fetch", "origin", "main"],
    opts: { cwd, timeout: TIMEOUT_MS, encoding: "utf-8" },
  }).catch((err: unknown) => {
    throw new Error(`git fetch failed: ${err instanceof Error ? err.message : String(err)}`)
  })

  const mergeBaseResult = await run({
    cmd: "git",
    args: ["merge-base", "origin/main", headBranch ?? "HEAD"],
    opts: { cwd, timeout: TIMEOUT_MS, encoding: "utf-8" },
  }).catch((err: unknown) => {
    throw new Error(`git merge-base failed: ${err instanceof Error ? err.message : String(err)}`)
  })

  const base = mergeBaseResult.stdout.trim()

  const diffResult = await run({
    cmd: "git",
    args: ["diff", `${base}...${headBranch ?? "HEAD"}`],
    opts: { cwd, timeout: TIMEOUT_MS, encoding: "utf-8" },
  }).catch((err: unknown) => {
    throw new Error(`git diff failed: ${err instanceof Error ? err.message : String(err)}`)
  })

  const patch = diffResult.stdout
  const byteLength = Buffer.byteLength(patch, "utf-8")

  if (byteLength > MAX_PATCH_BYTES) {
    const truncated = patch.slice(0, MAX_PATCH_BYTES)
    return { patch: truncated, truncated: true, base }
  }

  return { patch, truncated: false, base }
}
