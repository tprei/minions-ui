import fs from "node:fs"
import path from "node:path"
import os from "node:os"

function readTokenFromFile(): string | null {
  const filePath = process.env["GITHUB_TOKEN_FILE"]
  if (!filePath) {
    const workspaceRoot = process.env["WORKSPACE_ROOT"] ?? process.cwd()
    const defaultPath = path.join(workspaceRoot, ".gh-token")
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, "utf-8").trim() || null
    }
    return null
  }
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, "utf-8").trim() || null
}

function resolveToken(): string | null {
  return readTokenFromFile() ?? process.env["GITHUB_TOKEN"] ?? null
}

export function runCredentialHelper(): void {
  const lines: string[] = []
  const buf = fs.readFileSync("/dev/stdin", "utf-8")
  for (const line of buf.split("\n")) {
    const trimmed = line.trim()
    if (trimmed) lines.push(trimmed)
  }

  const token = resolveToken()
  if (!token) {
    process.stderr.write("git-credential-helper: no token available\n")
    process.exit(1)
  }

  process.stdout.write(`username=x-access-token\npassword=${token}\n`)
}

export function installCredentialHelper(): { scriptPath: string } {
  const scriptPath = path.join(os.tmpdir(), "minions-git-credential-helper.sh")
  const selfPath = path.resolve(import.meta.dir, "credential-helper.ts")

  const script = [
    "#!/bin/sh",
    `exec bun run "${selfPath}" "$@"`,
    "",
  ].join("\n")

  fs.writeFileSync(scriptPath, script, { mode: 0o755 })

  return { scriptPath }
}

if (import.meta.main) {
  runCredentialHelper()
}
