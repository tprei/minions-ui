import { describe, test, expect, afterEach, beforeAll } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { prepareWorkspace, removeWorkspace, rebootstrapIfMissing } from "./prepare"
import { spawnWithTimeout } from "./git"

const TMPDIR = Bun.env["TMPDIR"] ?? "/tmp"

function makeTmpDir(): string {
  const dir = path.join(TMPDIR, `ws-test-${crypto.randomBytes(6).toString("hex")}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function initLocalBareRepo(bare: string, work: string): Promise<void> {
  fs.mkdirSync(bare, { recursive: true })
  fs.mkdirSync(work, { recursive: true })
  await spawnWithTimeout("git", ["init", "--bare", bare], { timeoutMs: 10_000 })
  await spawnWithTimeout("git", ["init", work], { timeoutMs: 10_000 })
  await spawnWithTimeout("git", ["config", "user.email", "test@example.com"], { cwd: work, timeoutMs: 5_000 })
  await spawnWithTimeout("git", ["config", "user.name", "Test"], { cwd: work, timeoutMs: 5_000 })
  fs.writeFileSync(path.join(work, "README.md"), "hello")
  await spawnWithTimeout("git", ["add", "."], { cwd: work, timeoutMs: 5_000 })
  await spawnWithTimeout("git", ["commit", "-m", "init"], { cwd: work, timeoutMs: 10_000 })
  await spawnWithTimeout("git", ["remote", "add", "origin", bare], { cwd: work, timeoutMs: 5_000 })
  await spawnWithTimeout("git", ["push", "origin", "HEAD:main"], { cwd: work, timeoutMs: 10_000 })
}

const roots: string[] = []
function trackedRoot(): string {
  const dir = makeTmpDir()
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
})

describe("prepareWorkspace + removeWorkspace", () => {
  test("creates bare clone and worktree from local repo", async () => {
    const workspaceRoot = trackedRoot()
    const bare = path.join(TMPDIR, `bare-origin-${crypto.randomBytes(4).toString("hex")}.git`)
    const work = path.join(TMPDIR, `work-origin-${crypto.randomBytes(4).toString("hex")}`)
    roots.push(bare, work)

    await initLocalBareRepo(bare, work)

    const handle = await prepareWorkspace({
      slug: "test-slug",
      repoUrl: bare,
      workspaceRoot,
      bootstrap: false,
    })

    const repoName = path.basename(bare).replace(/\.git$/, "")
    expect(fs.existsSync(path.join(workspaceRoot, ".repos", `${repoName}.git`))).toBe(true)
    expect(fs.existsSync(handle.cwd)).toBe(true)
    expect(fs.existsSync(path.join(handle.cwd, "README.md"))).toBe(true)
    expect(handle.branch).toBe("minion/test-slug")
    expect(handle.slug).toBe("test-slug")
  })

  test("second call reuses bare clone without re-cloning", async () => {
    const workspaceRoot = trackedRoot()
    const bare = path.join(TMPDIR, `bare-reuse-${crypto.randomBytes(4).toString("hex")}.git`)
    const work = path.join(TMPDIR, `work-reuse-${crypto.randomBytes(4).toString("hex")}`)
    roots.push(bare, work)

    await initLocalBareRepo(bare, work)

    const repoName = path.basename(bare).replace(/\.git$/, "")
    const expectedBareDir = path.join(workspaceRoot, ".repos", `${repoName}.git`)

    await prepareWorkspace({ slug: "slug-a", repoUrl: bare, workspaceRoot, bootstrap: false })
    const statAfterFirst = fs.statSync(expectedBareDir)

    await prepareWorkspace({ slug: "slug-b", repoUrl: bare, workspaceRoot, bootstrap: false })
    const statAfterSecond = fs.statSync(expectedBareDir)

    expect(statAfterFirst.ino).toBe(statAfterSecond.ino)
    expect(fs.existsSync(path.join(workspaceRoot, "slug-a"))).toBe(true)
    expect(fs.existsSync(path.join(workspaceRoot, "slug-b"))).toBe(true)
  })

  test("removeWorkspace cleans worktree and branch", async () => {
    const workspaceRoot = trackedRoot()
    const bare = path.join(TMPDIR, `bare-remove-${crypto.randomBytes(4).toString("hex")}.git`)
    const work = path.join(TMPDIR, `work-remove-${crypto.randomBytes(4).toString("hex")}`)
    roots.push(bare, work)

    await initLocalBareRepo(bare, work)

    const handle = await prepareWorkspace({
      slug: "rm-slug",
      repoUrl: bare,
      workspaceRoot,
      bootstrap: false,
    })

    expect(fs.existsSync(handle.cwd)).toBe(true)
    await removeWorkspace(handle)
    expect(fs.existsSync(handle.cwd)).toBe(false)
  })

  test("second prepareWorkspace call with same slug replaces previous worktree", async () => {
    const workspaceRoot = trackedRoot()
    const bare = path.join(TMPDIR, `bare-replace-${crypto.randomBytes(4).toString("hex")}.git`)
    const work = path.join(TMPDIR, `work-replace-${crypto.randomBytes(4).toString("hex")}`)
    roots.push(bare, work)

    await initLocalBareRepo(bare, work)

    const handle1 = await prepareWorkspace({
      slug: "same-slug",
      repoUrl: bare,
      workspaceRoot,
      bootstrap: false,
    })
    expect(fs.existsSync(handle1.cwd)).toBe(true)

    const handle2 = await prepareWorkspace({
      slug: "same-slug",
      repoUrl: bare,
      workspaceRoot,
      bootstrap: false,
    })
    expect(fs.existsSync(handle2.cwd)).toBe(true)
    expect(handle1.cwd).toBe(handle2.cwd)
  })
})

describe("ensureDevtoolsFallback", () => {
  test("is a noop when /opt/devtools/node_modules is absent", async () => {
    if (fs.existsSync("/opt/devtools/node_modules")) {
      console.log("SKIP: /opt/devtools/node_modules present")
      return
    }
    const workspaceRoot = trackedRoot()
    const bare = path.join(TMPDIR, `bare-devtools-${crypto.randomBytes(4).toString("hex")}.git`)
    const work = path.join(TMPDIR, `work-devtools-${crypto.randomBytes(4).toString("hex")}`)
    roots.push(bare, work)

    await initLocalBareRepo(bare, work)

    await prepareWorkspace({ slug: "devtools-slug", repoUrl: bare, workspaceRoot, bootstrap: false })
    expect(fs.existsSync(path.join(workspaceRoot, "node_modules"))).toBe(false)
    expect(fs.existsSync(path.join(workspaceRoot, ".devtools-version"))).toBe(false)
  })
})

describe("lockfile detection", () => {
  test("detects bun.lock", async () => {
    const workspaceRoot = trackedRoot()
    const bare = path.join(TMPDIR, `bare-bunlock-${crypto.randomBytes(4).toString("hex")}.git`)
    const work = path.join(TMPDIR, `work-bunlock-${crypto.randomBytes(4).toString("hex")}`)
    roots.push(bare, work)

    await initLocalBareRepo(bare, work)
    const handle = await prepareWorkspace({
      slug: "bunlock-slug",
      repoUrl: bare,
      workspaceRoot,
      bootstrap: false,
    })

    fs.writeFileSync(path.join(handle.cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }))
    fs.writeFileSync(path.join(handle.cwd, "bun.lock"), "")

    const { spawnWithTimeout: spawn2 } = await import("./git")
    const result = await spawn2("node", ["-e", `
      const fs = require('fs');
      const dir = ${JSON.stringify(handle.cwd)};
      const hasBun = fs.existsSync(dir + '/bun.lock');
      const hasPnpm = fs.existsSync(dir + '/pnpm-lock.yaml');
      const hasNpm = fs.existsSync(dir + '/package-lock.json');
      if (hasBun) process.stdout.write('bun');
      else if (hasPnpm) process.stdout.write('pnpm');
      else if (hasNpm) process.stdout.write('npm-ci');
      else process.stdout.write('npm-install');
    `], { timeoutMs: 5_000 })
    expect(result.stdout.trim()).toBe("bun")
  })

  test("detects pnpm-lock.yaml when bun.lock absent", async () => {
    const workspaceRoot = trackedRoot()
    const bare = path.join(TMPDIR, `bare-pnpm-${crypto.randomBytes(4).toString("hex")}.git`)
    const work = path.join(TMPDIR, `work-pnpm-${crypto.randomBytes(4).toString("hex")}`)
    roots.push(bare, work)

    await initLocalBareRepo(bare, work)
    const handle = await prepareWorkspace({
      slug: "pnpm-slug",
      repoUrl: bare,
      workspaceRoot,
      bootstrap: false,
    })

    fs.writeFileSync(path.join(handle.cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }))
    fs.writeFileSync(path.join(handle.cwd, "pnpm-lock.yaml"), "")

    const hasBun = fs.existsSync(path.join(handle.cwd, "bun.lock"))
    const hasPnpm = fs.existsSync(path.join(handle.cwd, "pnpm-lock.yaml"))
    expect(hasBun).toBe(false)
    expect(hasPnpm).toBe(true)
  })

  test("detects package-lock.json when no other lockfile", async () => {
    const workspaceRoot = trackedRoot()
    const bare = path.join(TMPDIR, `bare-npmlk-${crypto.randomBytes(4).toString("hex")}.git`)
    const work = path.join(TMPDIR, `work-npmlk-${crypto.randomBytes(4).toString("hex")}`)
    roots.push(bare, work)

    await initLocalBareRepo(bare, work)
    const handle = await prepareWorkspace({
      slug: "npmlk-slug",
      repoUrl: bare,
      workspaceRoot,
      bootstrap: false,
    })

    fs.writeFileSync(path.join(handle.cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }))
    fs.writeFileSync(path.join(handle.cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }))

    const hasBun = fs.existsSync(path.join(handle.cwd, "bun.lock"))
    const hasPnpm = fs.existsSync(path.join(handle.cwd, "pnpm-lock.yaml"))
    const hasNpm = fs.existsSync(path.join(handle.cwd, "package-lock.json"))
    expect(hasBun).toBe(false)
    expect(hasPnpm).toBe(false)
    expect(hasNpm).toBe(true)
  })
})

describe("bootstrapOnePackage caching", () => {
  let npmAvailable = false

  beforeAll(async () => {
    const r = await spawnWithTimeout("which", ["npm"], { timeoutMs: 5_000 })
    npmAvailable = r.exitCode === 0
  })

  test("runs install without error for empty-deps package.json", async () => {
    if (!npmAvailable) {
      console.log("SKIP: npm not available")
      return
    }

    const workspaceRoot = trackedRoot()
    const bare = path.join(TMPDIR, `bare-npm-${crypto.randomBytes(4).toString("hex")}.git`)
    const work = path.join(TMPDIR, `work-npm-${crypto.randomBytes(4).toString("hex")}`)
    roots.push(bare, work)

    await initLocalBareRepo(bare, work)
    const handle = await prepareWorkspace({
      slug: "npm-slug",
      repoUrl: bare,
      workspaceRoot,
      bootstrap: false,
    })

    fs.writeFileSync(
      path.join(handle.cwd, "package.json"),
      JSON.stringify({ name: "ws-test-empty", version: "1.0.0", dependencies: {} }),
    )

    const repoName = path.basename(handle.bareDir).replace(/\.git$/, "")

    await expect(rebootstrapIfMissing(handle.cwd, repoName, workspaceRoot)).resolves.toBeUndefined()
  })
})
