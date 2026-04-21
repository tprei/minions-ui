import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export interface AskpassInstall {
  scriptPath: string
  envOverrides: Record<string, string>
}

export function installAskpass(): AskpassInstall {
  const scriptPath = path.join(os.tmpdir(), "minions-git-askpass.sh")

  const workspaceRoot = process.env["WORKSPACE_ROOT"] ?? process.cwd()
  const tokenFile =
    process.env["GITHUB_TOKEN_FILE"] ?? path.join(workspaceRoot, ".gh-token")

  const script = [
    "#!/bin/sh",
    `TOKEN_FILE="${tokenFile}"`,
    `if [ -f "$TOKEN_FILE" ]; then`,
    `  cat "$TOKEN_FILE"`,
    `  exit 0`,
    `fi`,
    `if [ -n "$GITHUB_TOKEN" ]; then`,
    `  printf '%s' "$GITHUB_TOKEN"`,
    `  exit 0`,
    `fi`,
    `echo "askpass: no token available" >&2`,
    `exit 1`,
    "",
  ].join("\n")

  fs.writeFileSync(scriptPath, script, { mode: 0o755 })

  return {
    scriptPath,
    envOverrides: {
      GIT_ASKPASS: scriptPath,
      SSH_ASKPASS: scriptPath,
    },
  }
}
