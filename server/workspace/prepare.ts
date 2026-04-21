import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { runGit, spawnWithTimeout } from "./git"
import type { WorkspaceHandle, PrepareOpts } from "./types"

const HARDLINK_COPY_TIMEOUT_MS = 300_000
const NPM_INSTALL_TIMEOUT_MS = 600_000
const NPM_INSTALL_MAX_ATTEMPTS = 2

function extractRepoName(repoUrl: string): string {
  const segment = repoUrl.split("/").pop() ?? repoUrl
  return segment.replace(/\.git$/, "")
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

async function forceRemoveDir(target: string): Promise<void> {
  try {
    await spawnWithTimeout("chmod", ["-R", "a+rwX", target], { timeoutMs: 60_000 })
  } catch {
    // best-effort
  }
  fs.rmSync(target, { recursive: true, force: true })
}

async function makeNodeModulesReadOnly(nmDir: string): Promise<void> {
  try {
    await spawnWithTimeout("chmod", ["-R", "a-w", nmDir], { timeoutMs: 30_000 })
  } catch {
    // non-fatal
  }
}

async function restoreWritePermissions(target: string): Promise<void> {
  try {
    if (fs.existsSync(target)) {
      await spawnWithTimeout("chmod", ["-R", "a+rwX", target], { timeoutMs: 60_000 })
    }
  } catch {
    // best-effort
  }
}

function detectLockfile(workDir: string): {
  lockHashFile: string
  installCmd: string
  installArgs: string[]
} {
  if (fs.existsSync(path.join(workDir, "bun.lock"))) {
    return {
      lockHashFile: path.join(workDir, "bun.lock"),
      installCmd: "bun",
      installArgs: ["install", "--frozen-lockfile"],
    }
  }
  if (fs.existsSync(path.join(workDir, "pnpm-lock.yaml"))) {
    return {
      lockHashFile: path.join(workDir, "pnpm-lock.yaml"),
      installCmd: "pnpm",
      installArgs: ["install", "--frozen-lockfile"],
    }
  }
  if (fs.existsSync(path.join(workDir, "package-lock.json"))) {
    return {
      lockHashFile: path.join(workDir, "package-lock.json"),
      installCmd: "npm",
      installArgs: ["ci", "--prefer-offline"],
    }
  }
  return {
    lockHashFile: path.join(workDir, "package.json"),
    installCmd: "npm",
    installArgs: ["install", "--prefer-offline"],
  }
}

async function bootstrapOnePackage(
  workDir: string,
  reposDir: string,
  cacheKey: string,
  cacheVersion: string,
): Promise<void> {
  const { lockHashFile, installCmd, installArgs } = detectLockfile(workDir)
  const versionedKey = `${cacheVersion}-${cacheKey}`
  const nmDir = path.join(workDir, "node_modules")
  const cacheDir = path.join(reposDir, `${versionedKey}-node_modules`)
  const hashFile = path.join(reposDir, `${versionedKey}-lock.hash`)

  const currentHash = fs.existsSync(lockHashFile) ? sha256File(lockHashFile) : null
  const cachedHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8").trim() : null

  if (currentHash && cachedHash === currentHash && fs.existsSync(cacheDir)) {
    if (fs.existsSync(nmDir)) {
      await forceRemoveDir(nmDir)
    }
    try {
      await spawnWithTimeout("cp", ["-al", cacheDir, nmDir], { timeoutMs: HARDLINK_COPY_TIMEOUT_MS })
      await makeNodeModulesReadOnly(nmDir)
      return
    } catch {
      if (fs.existsSync(nmDir)) await forceRemoveDir(nmDir)
    }
  }

  if (fs.existsSync(nmDir)) {
    if (currentHash && cachedHash === currentHash) {
      return
    }
    await forceRemoveDir(nmDir)
  }

  let installed = false
  for (let attempt = 1; attempt <= NPM_INSTALL_MAX_ATTEMPTS; attempt++) {
    const result = await spawnWithTimeout(installCmd, installArgs, {
      cwd: workDir,
      env: { ...process.env, NODE_ENV: "development" },
      timeoutMs: NPM_INSTALL_TIMEOUT_MS,
    })
    if (result.exitCode === 0) {
      installed = true
      break
    }
    console.warn(`[workspace] ${installCmd} attempt ${attempt} failed:\n${result.stderr.slice(-1500)}`)
    if (fs.existsSync(nmDir)) await forceRemoveDir(nmDir)
  }

  if (!installed) {
    console.error(`[workspace] dependency bootstrap failed after ${NPM_INSTALL_MAX_ATTEMPTS} attempts`)
    return
  }

  try {
    if (fs.existsSync(cacheDir)) await forceRemoveDir(cacheDir)
    await spawnWithTimeout("cp", ["-al", nmDir, cacheDir], { timeoutMs: HARDLINK_COPY_TIMEOUT_MS })
    if (currentHash) fs.writeFileSync(hashFile, currentHash)
  } catch (err) {
    console.warn("[workspace] failed to cache node_modules (non-fatal):", err)
  }

  await makeNodeModulesReadOnly(cacheDir)
}

async function bootstrapPython(
  workDir: string,
  reposDir: string,
  cacheKey: string,
  cacheVersion: string,
): Promise<void> {
  const uvCheck = await spawnWithTimeout("which", ["uv"], { timeoutMs: 5_000 })
  if (uvCheck.exitCode !== 0) {
    console.warn("[workspace] uv not found on PATH, skipping Python bootstrap")
    return
  }

  const hasUvLock = fs.existsSync(path.join(workDir, "uv.lock"))
  const hasRequirements = fs.existsSync(path.join(workDir, "requirements.txt"))

  const lockHashFile = hasUvLock
    ? path.join(workDir, "uv.lock")
    : hasRequirements
    ? path.join(workDir, "requirements.txt")
    : null

  if (!lockHashFile) return

  const versionedKey = `${cacheVersion}-${cacheKey}`
  const cacheDir = path.join(reposDir, `${versionedKey}-venv`)
  const hashFile = path.join(reposDir, `${versionedKey}-${hasUvLock ? "uvlock" : "req"}.hash`)
  const venvDir = path.join(workDir, ".venv")

  const currentHash = sha256File(lockHashFile)
  const cachedHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8").trim() : null

  if (fs.existsSync(venvDir)) {
    if (currentHash === cachedHash) {
      return
    }
    try {
      await spawnWithTimeout("chmod", ["-R", "u+w", venvDir], { timeoutMs: 30_000 })
    } catch {
      // best-effort
    }
    fs.rmSync(venvDir, { recursive: true, force: true })
  }

  if (currentHash === cachedHash && fs.existsSync(cacheDir)) {
    try {
      await spawnWithTimeout("cp", ["-al", cacheDir, venvDir], { timeoutMs: 120_000 })
      return
    } catch {
      console.warn("[workspace] hardlink copy failed for .venv, will re-install")
    }
  }

  try {
    if (hasUvLock) {
      const result = await spawnWithTimeout("uv", ["sync"], { cwd: workDir, timeoutMs: 300_000 })
      if (result.exitCode !== 0) {
        console.warn("[workspace] uv sync failed:", result.stderr.slice(-1500))
        return
      }
    } else {
      const venvResult = await spawnWithTimeout("uv", ["venv"], { cwd: workDir, timeoutMs: 60_000 })
      if (venvResult.exitCode !== 0) {
        console.warn("[workspace] uv venv failed:", venvResult.stderr.slice(-1500))
        return
      }
      const pipResult = await spawnWithTimeout(
        "uv",
        ["pip", "install", "-r", "requirements.txt"],
        { cwd: workDir, timeoutMs: 300_000 },
      )
      if (pipResult.exitCode !== 0) {
        console.warn("[workspace] uv pip install failed:", pipResult.stderr.slice(-1500))
        return
      }
    }

    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true })
    if (fs.existsSync(venvDir)) {
      await spawnWithTimeout("cp", ["-al", venvDir, cacheDir], { timeoutMs: 120_000 })
      fs.writeFileSync(hashFile, currentHash)
    }
  } catch (err) {
    console.warn("[workspace] Python bootstrap failed (non-fatal):", err)
  }
}

async function bootstrapDependencies(
  workDir: string,
  reposDir: string,
  repoName: string,
  cacheVersion: string,
): Promise<void> {
  if (fs.existsSync(path.join(workDir, "package.json"))) {
    await bootstrapOnePackage(workDir, reposDir, repoName, cacheVersion)
  }

  const hasPyproject = fs.existsSync(path.join(workDir, "pyproject.toml"))
  const hasRequirements = fs.existsSync(path.join(workDir, "requirements.txt"))
  const hasUvLock = fs.existsSync(path.join(workDir, "uv.lock"))
  if (hasPyproject || hasRequirements || hasUvLock) {
    await bootstrapPython(workDir, reposDir, repoName, cacheVersion)
  }

  try {
    const entries = fs.readdirSync(workDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const nested = path.join(workDir, entry.name)
      const subKey = `${repoName}-${entry.name}`
      if (fs.existsSync(path.join(nested, "package.json"))) {
        await bootstrapOnePackage(nested, reposDir, subKey, cacheVersion)
      }
      const hasSubPyproject = fs.existsSync(path.join(nested, "pyproject.toml"))
      const hasSubReq = fs.existsSync(path.join(nested, "requirements.txt"))
      const hasSubUvLock = fs.existsSync(path.join(nested, "uv.lock"))
      if (hasSubPyproject || hasSubReq || hasSubUvLock) {
        await bootstrapPython(nested, reposDir, subKey, cacheVersion)
      }
    }
  } catch {
    // non-fatal — monorepo walk failure
  }
}

async function ensureDevtoolsFallback(workspaceRoot: string): Promise<void> {
  const source = "/opt/devtools/node_modules"
  if (!fs.existsSync(source)) return

  const target = path.join(workspaceRoot, "node_modules")
  const versionSrc = "/opt/devtools/.devtools-version"
  const shaFile = path.join(workspaceRoot, ".devtools-version")

  const currentSha = fs.existsSync(versionSrc) ? fs.readFileSync(versionSrc, "utf8").trim() : ""
  const cachedSha = fs.existsSync(shaFile) ? fs.readFileSync(shaFile, "utf8").trim() : ""

  if (currentSha && currentSha === cachedSha) return

  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })

  await spawnWithTimeout("cp", ["-al", source, target], { timeoutMs: 30_000 })
  if (currentSha) fs.writeFileSync(shaFile, currentSha)
}

async function resolveDefaultBranch(bareDir: string): Promise<string> {
  try {
    const result = await runGit(bareDir, ["symbolic-ref", "HEAD"])
    const branch = result.stdout.trim().replace("refs/heads/", "")
    await runGit(bareDir, ["rev-parse", "--verify", `refs/heads/${branch}`])
    return branch
  } catch {
    // detached HEAD or unborn branch
  }

  for (const name of ["main", "master"]) {
    try {
      await runGit(bareDir, ["rev-parse", "--verify", `refs/heads/${name}`])
      return name
    } catch {
      // doesn't exist
    }
  }

  throw new Error(`Could not resolve default branch in ${bareDir}`)
}

export async function prepareWorkspace(opts: PrepareOpts): Promise<WorkspaceHandle> {
  const { slug, repoUrl, workspaceRoot, startRef, cacheVersion = "v3", bootstrap = true } = opts

  const repoName = extractRepoName(repoUrl)
  const reposDir = path.join(workspaceRoot, ".repos")
  fs.mkdirSync(reposDir, { recursive: true })

  const bareDir = path.join(reposDir, `${repoName}.git`)

  if (!fs.existsSync(bareDir)) {
    await spawnWithTimeout("git", ["clone", "--bare", repoUrl, bareDir], { timeoutMs: 120_000 })
    await runGit(bareDir, [
      "config",
      "remote.origin.fetch",
      "+refs/heads/*:refs/heads/*",
    ])
  }

  const excludeRefs: string[] = []
  try {
    const wtResult = await runGit(bareDir, ["worktree", "list", "--porcelain"])
    for (const m of wtResult.stdout.matchAll(/^branch refs\/heads\/(.+)$/gm)) {
      if (m[1] != null) excludeRefs.push(`^refs/heads/${m[1]}`)
    }
  } catch {
    // proceed without exclusions
  }
  const fetchRefspecs = [`+refs/heads/*:refs/heads/*`, ...excludeRefs]
  await runGit(bareDir, ["fetch", "--prune", "origin", ...fetchRefspecs], 120_000)

  const baseRef = startRef ?? (await resolveDefaultBranch(bareDir))
  const branch = `minion/${slug}`
  const workDir = path.join(workspaceRoot, slug)

  if (fs.existsSync(workDir)) {
    try {
      await runGit(bareDir, ["worktree", "remove", "--force", workDir])
    } catch {
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  }

  try {
    await runGit(bareDir, ["worktree", "prune"])
    await runGit(bareDir, ["branch", "-D", branch])
  } catch {
    // branch/worktree may not exist
  }

  await runGit(bareDir, ["worktree", "add", workDir, "-b", branch, baseRef])
  await runGit(workDir, ["remote", "set-url", "origin", repoUrl])

  await ensureDevtoolsFallback(workspaceRoot)

  if (bootstrap) {
    await bootstrapDependencies(workDir, reposDir, repoName, cacheVersion)
  }

  return { slug, cwd: workDir, bareDir, branch, baseRef }
}

export async function rebootstrapIfMissing(
  workDir: string,
  repoName: string,
  workspaceRoot: string,
  cacheVersion = "v3",
): Promise<void> {
  const reposDir = path.join(workspaceRoot, ".repos")
  const needsNode =
    fs.existsSync(path.join(workDir, "package.json")) &&
    !fs.existsSync(path.join(workDir, "node_modules"))
  const hasPyproject = fs.existsSync(path.join(workDir, "pyproject.toml"))
  const hasRequirements = fs.existsSync(path.join(workDir, "requirements.txt"))
  const hasUvLock = fs.existsSync(path.join(workDir, "uv.lock"))
  const needsPython = (hasPyproject || hasRequirements || hasUvLock) && !fs.existsSync(path.join(workDir, ".venv"))

  if (needsNode) {
    await bootstrapOnePackage(workDir, reposDir, repoName, cacheVersion)
  }
  if (needsPython) {
    await bootstrapPython(workDir, reposDir, repoName, cacheVersion)
  }
}

export async function removeWorkspace(handle: WorkspaceHandle): Promise<void> {
  const { cwd, bareDir, branch } = handle

  await restoreWritePermissions(path.join(cwd, "node_modules"))
  await restoreWritePermissions(path.join(cwd, ".venv"))

  try {
    await runGit(bareDir, ["worktree", "remove", "--force", cwd], 30_000)
  } catch {
    try {
      fs.rmSync(cwd, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }

  try {
    await runGit(bareDir, ["branch", "-D", branch], 10_000)
  } catch {
    // branch may not exist
  }
}
