import { describe, test, expect } from "bun:test"
import { fetchPrPreview } from "./pr-preview"
import type { ExecFn } from "../dag/preflight"

function makeExec(calls: Array<{ stdout: string } | Error>): ExecFn {
  let idx = 0
  return async () => {
    const next = calls[idx++]
    if (!next) throw new Error("no more mock responses")
    if (next instanceof Error) throw next
    return { stdout: next.stdout, stderr: "" }
  }
}

const PR_URL = "https://github.com/org/repo/pull/5001"

describe("fetchPrPreview", () => {
  test("returns parsed preview with checks", async () => {
    const viewPayload = JSON.stringify({
      number: 5001,
      url: PR_URL,
      title: "My PR",
      body: "Body",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      headRefName: "feature",
      baseRefName: "main",
      author: { login: "octocat" },
      updatedAt: "2024-01-01T00:00:00Z",
    })
    const checksPayload = JSON.stringify([
      { name: "ci/test", status: "completed", conclusion: "success", link: "https://ci.example.com/1" },
    ])

    const exec = makeExec([{ stdout: viewPayload }, { stdout: checksPayload }])
    const result = await fetchPrPreview(PR_URL, exec)

    expect(result.title).toBe("My PR")
    expect(result.number).toBe(5001)
    expect(result.state).toBe("open")
    expect(result.mergeable).toBe(true)
    expect(result.branch).toBe("feature")
    expect(result.baseBranch).toBe("main")
    expect(result.author).toBe("octocat")
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0]!.name).toBe("ci/test")
    expect(result.checks[0]!.conclusion).toBe("success")
    expect(result.checks[0]!.status).toBe("success")
  })

  test("checks result is empty array when gh pr checks fails", async () => {
    const viewPayload = JSON.stringify({
      number: 1002,
      url: "https://github.com/org/repo/pull/1002",
      title: "My PR",
      body: "",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      headRefName: "feature",
      baseRefName: "main",
      author: { login: "octocat" },
      updatedAt: "2024-01-01T00:00:00Z",
    })

    const exec = makeExec([{ stdout: viewPayload }, new Error("gh pr checks failed")])
    const result = await fetchPrPreview("https://github.com/org/repo/pull/1002", exec)

    expect(result.title).toBe("My PR")
    expect(result.checks).toHaveLength(0)
  })

  test("throws when gh pr view fails", async () => {
    const exec = makeExec([new Error("404: PR not found")])
    await expect(fetchPrPreview("https://github.com/org/repo/pull/1003", exec)).rejects.toThrow(
      "gh pr view failed",
    )
  })

  test("returns cached result on second call within TTL", async () => {
    const viewPayload = JSON.stringify({
      number: 5099,
      url: "https://github.com/org/repo/pull/5099",
      title: "Cached PR",
      body: "",
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      headRefName: "feature",
      baseRefName: "main",
      author: { login: "octocat" },
      updatedAt: "2024-01-01T00:00:00Z",
    })
    const checksPayload = JSON.stringify([])

    let callCount = 0
    const exec: ExecFn = async () => {
      callCount++
      return { stdout: callCount === 1 ? viewPayload : checksPayload, stderr: "" }
    }

    const url = "https://github.com/org/repo/pull/5099"
    const first = await fetchPrPreview(url, exec)
    const second = await fetchPrPreview(url, exec)

    expect(first.title).toBe("Cached PR")
    expect(second.title).toBe("Cached PR")
    expect(callCount).toBe(2)
  })
})
