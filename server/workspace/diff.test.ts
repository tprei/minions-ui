import { describe, test, expect } from "bun:test"
import { computeWorkspaceDiff } from "./diff"
import type { ExecFn } from "../dag/preflight"

function makeExec(responses: Array<{ stdout: string; stderr?: string } | Error>): ExecFn {
  let idx = 0
  return async () => {
    const next = responses[idx++]
    if (!next) throw new Error("no more mock responses")
    if (next instanceof Error) throw next
    return { stdout: next.stdout, stderr: next.stderr ?? "" }
  }
}

describe("computeWorkspaceDiff", () => {
  test("returns patch from merge base", async () => {
    const patch = "diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new\n"
    const exec = makeExec([
      { stdout: "" },
      { stdout: "abc123\n" },
      { stdout: patch },
    ])

    const result = await computeWorkspaceDiff("/workspace/my-session", undefined, exec)
    expect(result.patch).toBe(patch)
    expect(result.truncated).toBe(false)
    expect(result.base).toBe("abc123")
  })

  test("truncates patch exceeding 10 MB", async () => {
    const tenMb = "x".repeat(10 * 1024 * 1024 + 100)
    const exec = makeExec([
      { stdout: "" },
      { stdout: "deadbeef\n" },
      { stdout: tenMb },
    ])

    const result = await computeWorkspaceDiff("/workspace/my-session", undefined, exec)
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.patch, "utf-8")).toBeLessThanOrEqual(10 * 1024 * 1024)
  })

  test("throws when git fetch fails", async () => {
    const exec = makeExec([new Error("network error")])
    await expect(computeWorkspaceDiff("/workspace/my-session", undefined, exec)).rejects.toThrow(
      "git fetch failed",
    )
  })

  test("throws when merge-base fails", async () => {
    const exec = makeExec([{ stdout: "" }, new Error("not a git repo")])
    await expect(computeWorkspaceDiff("/workspace/my-session", undefined, exec)).rejects.toThrow(
      "git merge-base failed",
    )
  })

  test("uses headBranch when provided", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = []
    const captureExec: ExecFn = async ({ cmd, args }) => {
      calls.push({ cmd, args })
      return { stdout: cmd === "git" && args[0] === "merge-base" ? "aabbcc\n" : "", stderr: "" }
    }

    await computeWorkspaceDiff("/workspace/my-session", "minion/my-branch", captureExec)

    const mergeBaseCall = calls.find((c) => c.args[0] === "merge-base")
    expect(mergeBaseCall?.args).toContain("minion/my-branch")
  })
})
