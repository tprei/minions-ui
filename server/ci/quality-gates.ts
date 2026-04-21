import fs from "node:fs"
import path from "node:path"
import type { QualityGates, QualityReport } from "../handlers/types"

const GATE_TIMEOUT_MS = 5 * 60 * 1000
const KNOWN_GATES = ["test", "typecheck", "lint"] as const

interface PackageJson {
  scripts?: Record<string, string>
}

function detectGates(cwd: string): string[] {
  const pkgPath = path.join(cwd, "package.json")
  if (!fs.existsSync(pkgPath)) return []

  let pkg: PackageJson
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as PackageJson
  } catch {
    return []
  }

  const scripts = pkg.scripts ?? {}
  return KNOWN_GATES.filter((gate) => gate in scripts)
}

async function runGate(
  cwd: string,
  name: string,
): Promise<{ name: string; passed: boolean; output: string }> {
  let timedOut = false

  const proc = Bun.spawn(["npm", "run", name], {
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
  }, GATE_TIMEOUT_MS)

  const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)

  if (timedOut) {
    return {
      name,
      passed: false,
      output: `${name} timed out after ${GATE_TIMEOUT_MS}ms`,
    }
  }

  const combined = [stdoutBuf, stderrBuf].filter(Boolean).join("\n").trim()
  return {
    name,
    passed: exitCode === 0,
    output: combined,
  }
}

export function createRealQualityGates(): QualityGates {
  return {
    async run(cwd: string): Promise<QualityReport> {
      const gates = detectGates(cwd)
      if (gates.length === 0) {
        return { allPassed: true, results: [] }
      }

      const results = await Promise.all(gates.map((gate) => runGate(cwd, gate)))
      const allPassed = results.every((r) => r.passed)
      return { allPassed, results }
    },
  }
}
