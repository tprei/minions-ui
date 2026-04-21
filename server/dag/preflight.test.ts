import { describe, it, expect } from "bun:test"
import { checkPRMergeability, detectLocalConflicts } from "./preflight"
import type { ExecFn } from "./preflight"

function mockExec(result: { stdout: string; stderr?: string } | Error): ExecFn {
  return async () => {
    if (result instanceof Error) throw result
    return { stdout: result.stdout, stderr: result.stderr ?? "" }
  }
}

describe("checkPRMergeability", () => {
  it("returns mergeable:true when gh reports MERGEABLE", async () => {
    const exec = mockExec({ stdout: JSON.stringify({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }) })
    const result = await checkPRMergeability("https://github.com/org/repo/pull/1", exec)
    expect(result.mergeable).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it("returns mergeable:false with reason when gh reports CONFLICTING", async () => {
    const exec = mockExec({ stdout: JSON.stringify({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }) })
    const result = await checkPRMergeability("https://github.com/org/repo/pull/2", exec)
    expect(result.mergeable).toBe(false)
    expect(result.reason).toContain("conflict")
  })

  it("returns mergeable:false when gh command fails", async () => {
    const exec = mockExec(new Error("command not found: gh"))
    const result = await checkPRMergeability("https://github.com/org/repo/pull/3", exec)
    expect(result.mergeable).toBe(false)
    expect(result.reason).toContain("gh pr view failed")
  })

  it("returns mergeable:false when gh output is not valid JSON", async () => {
    const exec = mockExec({ stdout: "not json" })
    const result = await checkPRMergeability("https://github.com/org/repo/pull/4", exec)
    expect(result.mergeable).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it("returns mergeable:false with state info for BLOCKED status", async () => {
    const exec = mockExec({ stdout: JSON.stringify({ mergeable: "UNKNOWN", mergeStateStatus: "BLOCKED" }) })
    const result = await checkPRMergeability("https://github.com/org/repo/pull/5", exec)
    expect(result.mergeable).toBe(false)
    expect(result.reason).toContain("BLOCKED")
  })
})

describe("detectLocalConflicts", () => {
  it("returns mergeable:true when git merge succeeds", async () => {
    const exec = mockExec({ stdout: "", stderr: "" })
    const result = await detectLocalConflicts("/tmp/repo", "main", exec)
    expect(result.mergeable).toBe(true)
  })

  it("returns mergeable:false with conflict paths when merge has conflicts", async () => {
    let callCount = 0
    const exec: ExecFn = async () => {
      callCount++
      if (callCount === 1) {
        return { stdout: "", stderr: "" }
      }
      const err = Object.assign(new Error("merge conflict"), {
        stderr: "CONFLICT (content): Merge conflict in src/foo.ts\nCONFLICT (content): Merge conflict in src/bar.ts\n",
      })
      throw err
    }

    const result = await detectLocalConflicts("/tmp/repo", "main", exec)
    expect(result.mergeable).toBe(false)
    expect(result.conflictPaths).toBeDefined()
    expect(result.conflictPaths).toContain("src/foo.ts")
    expect(result.conflictPaths).toContain("src/bar.ts")
  })

  it("returns mergeable:false when git fetch fails", async () => {
    const exec = mockExec(new Error("fetch failed"))
    const result = await detectLocalConflicts("/tmp/repo", "main", exec)
    expect(result.mergeable).toBe(false)
    expect(result.reason).toContain("git fetch failed")
  })
})
