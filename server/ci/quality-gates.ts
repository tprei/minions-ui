import fs from "node:fs"
import path from "node:path"
import type { QualityGates, QualityReport } from "../handlers/types"
import type { QualityGateConfig } from "../config/repo-config"
import { readRepoConfig } from "../config/repo-config"

const GATE_TIMEOUT_MS = 5 * 60 * 1000
const KNOWN_GATES = ["test", "typecheck", "lint"] as const

interface PackageJson {
  scripts?: Record<string, string>
}

interface RunnableGate {
  name: string
  command: string[]
  required: boolean
  timeoutMs: number
  paths?: string[]
}

function detectGates(cwd: string): RunnableGate[] {
  const pkgPath = path.join(cwd, "package.json")
  if (!fs.existsSync(pkgPath)) return []

  let pkg: PackageJson
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as PackageJson
  } catch {
    return []
  }

  const scripts = pkg.scripts ?? {}
  return KNOWN_GATES
    .filter((gate) => gate in scripts)
    .map((gate) => ({
      name: gate,
      command: ["npm", "run", gate],
      required: true,
      timeoutMs: GATE_TIMEOUT_MS,
    }))
}

function configuredGates(gates: QualityGateConfig[]): RunnableGate[] {
  return gates.map((gate) => ({
    name: gate.name,
    command: gate.command,
    required: gate.required,
    timeoutMs: gate.timeoutMs ?? GATE_TIMEOUT_MS,
    paths: gate.paths,
  }))
}

async function readChangedFiles(cwd: string): Promise<string[]> {
  const fetchProc = Bun.spawn(["git", "fetch", "origin", "main"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  await fetchProc.exited.catch(() => 1)

  const baseProc = Bun.spawn(["git", "merge-base", "origin/main", "HEAD"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const [baseOut, baseExit] = await Promise.all([
    new Response(baseProc.stdout).text(),
    baseProc.exited,
  ])
  if (baseExit !== 0) return []

  const base = baseOut.trim()
  if (!base) return []

  const diffProc = Bun.spawn(["git", "diff", "--name-only", `${base}...HEAD`], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const [diffOut, diffExit] = await Promise.all([
    new Response(diffProc.stdout).text(),
    diffProc.exited,
  ])
  if (diffExit !== 0) return []

  return diffOut.split("\n").map((line) => line.trim()).filter(Boolean)
}

function normalizeRepoPath(value: string): string {
  return value.replace(/^\.\/+/, "").replace(/\/+$/, "")
}

function matchesPath(gatePath: string, changedFile: string): boolean {
  const pathPrefix = normalizeRepoPath(gatePath)
  const file = normalizeRepoPath(changedFile)
  return file === pathPrefix || file.startsWith(`${pathPrefix}/`)
}

function shouldRunGate(gate: RunnableGate, changedFiles: string[]): boolean {
  if (!gate.paths || gate.paths.length === 0) return true
  if (changedFiles.length === 0) return true
  return gate.paths.some((gatePath) => changedFiles.some((changed) => matchesPath(gatePath, changed)))
}

async function runGate(
  cwd: string,
  gate: RunnableGate,
  changedFiles: string[],
): Promise<QualityReport["results"][number]> {
  if (!shouldRunGate(gate, changedFiles)) {
    return {
      name: gate.name,
      command: gate.command,
      required: gate.required,
      passed: true,
      skipped: true,
      output: "skipped: no changed files matched gate paths",
      durationMs: 0,
    }
  }

  let timedOut = false
  const startedAt = Date.now()

  const proc = Bun.spawn(gate.command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })

  const timer = setTimeout(async () => {
    timedOut = true
    try {
      proc.kill("SIGINT")
      await new Promise((resolve) => setTimeout(resolve, 2000))
      proc.kill("SIGKILL")
    } catch {
      // process may have already exited
    }
  }, gate.timeoutMs)

  const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)

  if (timedOut) {
    return {
      name: gate.name,
      command: gate.command,
      required: gate.required,
      passed: false,
      skipped: false,
      output: `${gate.name} timed out after ${gate.timeoutMs}ms`,
      durationMs: Date.now() - startedAt,
    }
  }

  const combined = [stdoutBuf, stderrBuf].filter(Boolean).join("\n").trim()
  return {
    name: gate.name,
    command: gate.command,
    required: gate.required,
    passed: exitCode === 0,
    skipped: false,
    output: combined,
    durationMs: Date.now() - startedAt,
  }
}

export function createRealQualityGates(): QualityGates {
  return {
    async run(cwd: string): Promise<QualityReport> {
      const repoConfig = readRepoConfig(cwd)
      if (repoConfig.error) {
        return {
          allPassed: false,
          configPath: repoConfig.path,
          configError: repoConfig.error,
          results: [
            {
              name: "minions-config",
              command: [],
              required: true,
              passed: false,
              skipped: false,
              output: repoConfig.error,
              durationMs: 0,
            },
          ],
        }
      }

      const gates = repoConfig.source === "file" && repoConfig.config.quality.gates.length > 0
        ? configuredGates(repoConfig.config.quality.gates)
        : detectGates(cwd)
      if (gates.length === 0) {
        return { allPassed: true, results: [], configPath: repoConfig.path }
      }

      const changedFiles = await readChangedFiles(cwd)
      const results = await Promise.all(gates.map((gate) => runGate(cwd, gate, changedFiles)))
      const allPassed = results.every((r) => !r.required || r.passed)
      return { allPassed, results, configPath: repoConfig.path }
    },
  }
}
