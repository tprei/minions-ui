export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function spawnWithTimeout(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<SpawnResult> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })

  let timedOut = false
  const timer = setTimeout(async () => {
    timedOut = true
    try {
      proc.kill("SIGINT")
      await new Promise((resolve) => setTimeout(resolve, 2000))
      proc.kill("SIGKILL")
    } catch {
      // process may have already exited
    }
  }, opts.timeoutMs)

  const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)

  if (timedOut) {
    throw new Error(
      `${cmd} timed out after ${opts.timeoutMs}ms\nstderr: ${stderrBuf.slice(-1500)}`,
    )
  }

  return { stdout: stdoutBuf, stderr: stderrBuf, exitCode: exitCode ?? 1 }
}

export async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<SpawnResult> {
  const result = await spawnWithTimeout("git", args, { cwd, timeoutMs })
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${result.exitCode})\n${result.stderr.slice(-1500)}`,
    )
  }
  return result
}
