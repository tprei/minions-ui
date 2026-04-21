import { describe, it, expect } from "bun:test"
import { buildDag } from "./dag"
import { updateStackComment } from "./stack-comment"
import type { ExecFn } from "./preflight"

function makeSuccessExec(viewBody = ""): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = []
  const exec: ExecFn = async ({ args }) => {
    calls.push([...args])
    const isView = args[1] === "view"
    return {
      stdout: isView ? JSON.stringify({ body: viewBody }) : "",
      stderr: "",
    }
  }
  return { exec, calls }
}

describe("updateStackComment", () => {
  it("does nothing when no open PRs exist", async () => {
    const { exec, calls } = makeSuccessExec()
    const graph = buildDag("test-dag", [
      { id: "a", title: "Task A", description: "Description A", dependsOn: [] },
    ], 1, "repo")

    await updateStackComment(graph, exec)
    expect(calls).toHaveLength(0)
  })

  it("does nothing when only landed nodes have PRs", async () => {
    const { exec, calls } = makeSuccessExec()
    const graph = buildDag("test-dag", [
      { id: "a", title: "Task A", description: "Description A", dependsOn: [] },
    ], 1, "repo")
    graph.nodes[0]!.prUrl = "https://github.com/org/repo/pull/1"
    graph.nodes[0]!.status = "landed"

    await updateStackComment(graph, exec)
    expect(calls).toHaveLength(0)
  })

  it("calls gh pr view and gh pr edit for each open PR", async () => {
    const { exec, calls } = makeSuccessExec("## Existing body")
    const graph = buildDag("test-dag", [
      { id: "a", title: "Task A", description: "Description A", dependsOn: [] },
      { id: "b", title: "Task B", description: "Description B", dependsOn: ["a"] },
    ], 1, "repo")
    graph.nodes[0]!.prUrl = "https://github.com/org/repo/pull/1"
    graph.nodes[0]!.status = "done"
    graph.nodes[1]!.prUrl = "https://github.com/org/repo/pull/2"
    graph.nodes[1]!.status = "running"

    await updateStackComment(graph, exec)

    const viewCalls = calls.filter((a) => a[0] === "pr" && a[1] === "view")
    const editCalls = calls.filter((a) => a[0] === "pr" && a[1] === "edit")

    expect(viewCalls).toHaveLength(2)
    expect(editCalls).toHaveLength(2)
  })

  it("includes dag section markers in the PR body", async () => {
    let editBody = ""
    const exec: ExecFn = async ({ args }) => {
      if (args[1] === "edit") {
        const bodyIdx = args.indexOf("--body")
        if (bodyIdx !== -1 && args[bodyIdx + 1]) editBody = args[bodyIdx + 1]!
      }
      return { stdout: JSON.stringify({ body: "" }), stderr: "" }
    }

    const graph = buildDag("test-dag", [
      { id: "a", title: "Task A", description: "Description A", dependsOn: [] },
    ], 1, "repo")
    graph.nodes[0]!.prUrl = "https://github.com/org/repo/pull/1"
    graph.nodes[0]!.status = "running"

    await updateStackComment(graph, exec)

    expect(editBody).toContain("<!-- dag-status-start -->")
    expect(editBody).toContain("<!-- dag-status-end -->")
    expect(editBody).toContain("Task A")
  })

  it("preserves existing body content before dag section", async () => {
    const existingBody = "## My PR\n\nSome description"
    let capturedBody = ""
    const exec: ExecFn = async ({ args }) => {
      if (args[1] === "edit") {
        const bodyIdx = args.indexOf("--body")
        if (bodyIdx !== -1 && args[bodyIdx + 1]) capturedBody = args[bodyIdx + 1]!
      }
      return { stdout: JSON.stringify({ body: existingBody }), stderr: "" }
    }

    const graph = buildDag("test-dag", [
      { id: "a", title: "Task A", description: "Description A", dependsOn: [] },
    ], 1, "repo")
    graph.nodes[0]!.prUrl = "https://github.com/org/repo/pull/1"
    graph.nodes[0]!.status = "running"

    await updateStackComment(graph, exec)

    expect(capturedBody).toContain("## My PR")
    expect(capturedBody).toContain("Some description")
    expect(capturedBody).toContain("<!-- dag-status-start -->")
  })

  it("continues updating other PRs when one gh call fails", async () => {
    let editCount = 0
    const exec: ExecFn = async ({ args }) => {
      const prUrl = args[2]
      if (args[1] === "view" && typeof prUrl === "string" && prUrl.includes("pull/1")) {
        throw new Error("gh error for PR 1")
      }
      if (args[1] === "edit") {
        editCount++
      }
      return { stdout: JSON.stringify({ body: "" }), stderr: "" }
    }

    const graph = buildDag("test-dag", [
      { id: "a", title: "Task A", description: "Description A", dependsOn: [] },
      { id: "b", title: "Task B", description: "Description B", dependsOn: [] },
    ], 1, "repo")
    graph.nodes[0]!.prUrl = "https://github.com/org/repo/pull/1"
    graph.nodes[0]!.status = "running"
    graph.nodes[1]!.prUrl = "https://github.com/org/repo/pull/2"
    graph.nodes[1]!.status = "running"

    await expect(updateStackComment(graph, exec)).resolves.toBeUndefined()
    expect(editCount).toBeGreaterThanOrEqual(1)
  })
})
