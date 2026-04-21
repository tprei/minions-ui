import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"

const execFileP = promisify(execFileCb)

export interface ExecOpts {
  cwd?: string
  timeout?: number
  encoding?: string
  env?: NodeJS.ProcessEnv
}

export interface ExecCall {
  cmd: string
  args: string[]
  opts?: ExecOpts
}

export type ExecFn = (call: ExecCall) => Promise<{ stdout: string; stderr: string }>

function defaultExec({ cmd, args, opts }: ExecCall): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, opts ?? {}) as Promise<{ stdout: string; stderr: string }>
}

export interface PreflightResult {
  mergeable: boolean
  conflictPaths?: string[]
  reason?: string
}

export async function checkPRMergeability(prUrl: string, execFn: ExecFn = defaultExec): Promise<PreflightResult> {
  let stdout: string
  try {
    const result = await execFn({
      cmd: "gh",
      args: ["pr", "view", prUrl, "--json", "mergeable,mergeStateStatus"],
      opts: { timeout: 30_000, encoding: "utf-8" },
    })
    stdout = result.stdout
  } catch (err) {
    return {
      mergeable: false,
      reason: `gh pr view failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { mergeable: false, reason: "could not parse gh pr view output" }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { mergeable: false, reason: "unexpected gh pr view response shape" }
  }

  const obj = parsed as Record<string, unknown>
  const mergeable = obj.mergeable

  if (mergeable === "MERGEABLE") {
    return { mergeable: true }
  }

  if (mergeable === "CONFLICTING") {
    return { mergeable: false, reason: "PR has merge conflicts" }
  }

  const stateStatus = typeof obj.mergeStateStatus === "string" ? obj.mergeStateStatus : undefined
  return {
    mergeable: false,
    reason: stateStatus ? `not mergeable: ${stateStatus}` : `not mergeable: ${String(mergeable)}`,
  }
}

export async function detectLocalConflicts(cwd: string, base: string, execFn: ExecFn = defaultExec): Promise<PreflightResult> {
  try {
    await execFn({
      cmd: "git",
      args: ["fetch", "origin", base],
      opts: { cwd, timeout: 60_000, encoding: "utf-8" },
    })
  } catch (err) {
    return {
      mergeable: false,
      reason: `git fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  try {
    await execFn({
      cmd: "git",
      args: ["merge", "--no-commit", "--no-ff", "--keep-redundant-commits", `origin/${base}`],
      opts: { cwd, timeout: 30_000, encoding: "utf-8" },
    })

    await execFn({
      cmd: "git",
      args: ["merge", "--abort"],
      opts: { cwd, timeout: 10_000, encoding: "utf-8" },
    }).catch(() => undefined)

    return { mergeable: true }
  } catch (err) {
    const stderr = err instanceof Error && "stderr" in err ? String((err as NodeJS.ErrnoException & { stderr: unknown }).stderr) : ""

    await execFn({
      cmd: "git",
      args: ["merge", "--abort"],
      opts: { cwd, timeout: 10_000, encoding: "utf-8" },
    }).catch(() => undefined)

    const conflictPaths = extractConflictPaths(stderr)

    return {
      mergeable: false,
      conflictPaths: conflictPaths.length > 0 ? conflictPaths : undefined,
      reason: conflictPaths.length > 0
        ? `conflicts in: ${conflictPaths.join(", ")}`
        : "merge conflict detected",
    }
  }
}

function extractConflictPaths(text: string): string[] {
  const paths: string[] = []
  for (const line of text.split("\n")) {
    const match = /^CONFLICT.*in (.+)$/.exec(line.trim())
    if (match?.[1]) paths.push(match[1])
  }
  return paths
}
