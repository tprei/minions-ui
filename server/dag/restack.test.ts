import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { buildDag } from "./dag"
import { EngineEventBus } from "../events/bus"
import { createRestackManager } from "./restack"
import type { ExecFn } from "./preflight"
import type { EngineEvent } from "../events/types"
import type { SessionRegistry } from "../session/registry"

function makeExecWithSha(headSha: string): { exec: ExecFn; calls: string[][]; setHeadSha: (sha: string) => void } {
  const calls: string[][] = []
  let currentSha = headSha
  const exec: ExecFn = async ({ cmd, args }) => {
    calls.push([cmd, ...args])
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
      return { stdout: currentSha, stderr: "" }
    }
    return { stdout: "", stderr: "" }
  }
  return { exec, calls, setHeadSha: (sha: string) => { currentSha = sha } }
}

function makeFailingExec(failOn: string): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = []
  const exec: ExecFn = async ({ cmd, args }) => {
    calls.push([cmd, ...args])
    if (cmd === "git" && args.includes(failOn)) {
      throw new Error(`git ${failOn} failed`)
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
      return { stdout: "new-sha-123", stderr: "" }
    }
    return { stdout: "", stderr: "" }
  }
  return { exec, calls }
}

function makeBus(): { bus: EngineEventBus; events: EngineEvent[] } {
  const events: EngineEvent[] = []
  const bus = new EngineEventBus()
  bus.on((ev) => events.push(ev))
  return { bus, events }
}

function makeMockRegistry(): SessionRegistry {
  return {
    create: mock(() => Promise.resolve({ session: { id: 'test' } as unknown as Awaited<ReturnType<SessionRegistry['create']>>['session'], runtime: {} as unknown as Awaited<ReturnType<SessionRegistry['create']>>['runtime'] })),
    get: mock(() => undefined),
    getBySlug: mock(() => undefined),
    list: mock(() => []),
    snapshot: mock(() => undefined),
    stop: mock(() => Promise.resolve()),
    close: mock(() => Promise.resolve()),
    reply: mock(() => Promise.resolve(true)),
    reconcileOnBoot: mock(() => Promise.resolve()),
    scheduleQuotaResume: mock(() => Promise.resolve()),
  }
}

function makeGraph() {
  const graph = buildDag("dag-1", [
    { id: "a", title: "Task A", description: "First task", dependsOn: [] },
    { id: "b", title: "Task B", description: "Second task", dependsOn: ["a"] },
    { id: "c", title: "Task C", description: "Third task", dependsOn: ["b"] },
  ], "root-session", "https://github.com/org/repo")
  graph.nodes[0]!.branch = "minion/slug-a"
  graph.nodes[0]!.status = "done"
  graph.nodes[0]!.headSha = "old-sha-a"
  graph.nodes[1]!.branch = "minion/slug-b"
  graph.nodes[1]!.status = "done"
  graph.nodes[1]!.headSha = "old-sha-b"
  graph.nodes[2]!.branch = "minion/slug-c"
  graph.nodes[2]!.status = "done"
  graph.nodes[2]!.headSha = "old-sha-c"
  return graph
}

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "restack-test-"))
  fs.mkdirSync(path.join(workspaceRoot, "slug-a"), { recursive: true })
  fs.mkdirSync(path.join(workspaceRoot, "slug-b"), { recursive: true })
  fs.mkdirSync(path.join(workspaceRoot, "slug-c"), { recursive: true })
})

afterEach(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

describe("RestackManager.onParentPushed", () => {
  it("emits restack.started event for direct children", async () => {
    const { exec } = makeExecWithSha("new-sha-b")
    const { bus, events } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    const startedEvents = events.filter((e) => e.kind === "dag.node.restack.started")
    expect(startedEvents.length).toBeGreaterThanOrEqual(1)
    expect(startedEvents[0]).toMatchObject({
      kind: "dag.node.restack.started",
      dagId: "dag-1",
      nodeId: "b",
      parentNodeId: "a",
    })
  })

  it("fetches parent branch and rebases child onto it", async () => {
    const { exec, calls } = makeExecWithSha("new-sha-b")
    const { bus } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    const fetchCall = calls.find((c) => c[0] === "git" && c[1] === "fetch" && c.includes("minion/slug-a"))
    expect(fetchCall).toBeDefined()

    const rebaseCall = calls.find((c) => c[0] === "git" && c[1] === "rebase" && c.includes("origin/minion/slug-a"))
    expect(rebaseCall).toBeDefined()
  })

  it("force-pushes after successful rebase", async () => {
    const { exec, calls } = makeExecWithSha("new-sha-b")
    const { bus } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    const pushCall = calls.find((c) => c[0] === "git" && c[1] === "push" && c.includes("--force-with-lease"))
    expect(pushCall).toBeDefined()
  })

  it("emits dag.node.pushed after successful rebase and push", async () => {
    const { exec } = makeExecWithSha("new-sha-b")
    const { bus, events } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    const pushedEvents = events.filter((e) => e.kind === "dag.node.pushed")
    expect(pushedEvents.length).toBeGreaterThanOrEqual(1)
    expect(pushedEvents[0]).toMatchObject({
      kind: "dag.node.pushed",
      dagId: "dag-1",
      nodeId: "b",
      newSha: "new-sha-b",
    })
  })

  it("cascades to downstream nodes after successful rebase", async () => {
    const { exec } = makeExecWithSha("new-sha-b")
    const { bus, events } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    const pushedEvents = events.filter((e) => e.kind === "dag.node.pushed")
    expect(pushedEvents.some((e) => e.kind === "dag.node.pushed" && e.nodeId === "b")).toBe(true)
  })

  it("sets status to rebasing during rebase", async () => {
    const { exec } = makeExecWithSha("new-sha-b")
    const { bus } = makeBus()
    const graph = makeGraph()

    let statusDuringRebase: string | undefined
    const originalExec = exec
    const interceptExec: ExecFn = async (call) => {
      if (call.cmd === "git" && call.args[0] === "rebase") {
        statusDuringRebase = graph.nodes[1]!.status
      }
      return originalExec(call)
    }

    const interceptManager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: interceptExec })
    await interceptManager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    expect(statusDuringRebase).toBe("rebasing")
  })

  it("restores prior status after successful rebase", async () => {
    const { exec } = makeExecWithSha("new-sha-b")
    const { bus } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    const priorStatus = graph.nodes[1]!.status
    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    expect(graph.nodes[1]!.status).toBe(priorStatus)
  })

  it("skips nodes with status running", async () => {
    const { exec, calls } = makeExecWithSha("new-sha-b")
    const { bus } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()
    graph.nodes[1]!.status = "running"

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    const rebaseCalls = calls.filter((c) => c[0] === "git" && c[1] === "rebase")
    expect(rebaseCalls.length).toBe(0)
  })

  it("sets rebase-conflict status when cascadeDepth exceeds max", async () => {
    const { exec } = makeExecWithSha("new-sha-b")
    const { bus, events } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 5,
    }, graph)

    expect(graph.nodes[1]!.status).toBe("rebase-conflict")
    const conflictEvents = events.filter((e) => e.kind === "dag.node.restack.completed" && e.result === "conflict")
    expect(conflictEvents.length).toBeGreaterThanOrEqual(1)
  })

  it("leaves status as rebasing when rebase fails", async () => {
    const { exec } = makeFailingExec("rebase")
    const { bus } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    expect(graph.nodes[1]!.status).toBe("rebasing")
    expect(graph.nodes[1]!.error).toBeDefined()
  })

  it("emits restack.completed with conflict when push fails", async () => {
    const { exec } = makeFailingExec("push")
    const { bus, events } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    const conflictEvents = events.filter((e) => e.kind === "dag.node.restack.completed" && e.result === "conflict")
    expect(conflictEvents.length).toBeGreaterThanOrEqual(1)
  })

  it("does not cascade when rebase fails", async () => {
    const { exec } = makeFailingExec("rebase")
    const { bus, events } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    const pushedEvents = events.filter((e) => e.kind === "dag.node.pushed")
    expect(pushedEvents.length).toBe(0)
  })

  it("skips node when worktree directory does not exist", async () => {
    const { exec, calls } = makeExecWithSha("new-sha-b")
    const { bus } = makeBus()
    createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    fs.rmSync(path.join(workspaceRoot, "slug-b"), { recursive: true, force: true })

    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    const rebaseCalls = calls.filter((c) => c[0] === "git" && c[1] === "rebase")
    expect(rebaseCalls.length).toBe(0)
  })

  it("updates node headSha after successful rebase", async () => {
    const { exec } = makeExecWithSha("new-sha-b-updated")
    const { bus } = makeBus()
    const manager = createRestackManager({ bus, workspaceRoot, registry: makeMockRegistry(), execFile: exec })
    const graph = makeGraph()

    await manager.onParentPushed({
      dagId: "dag-1",
      nodeId: "a",
      parentSha: "old-sha-a",
      newSha: "new-sha-a",
      cascadeDepth: 0,
    }, graph)

    expect(graph.nodes[1]!.headSha).toBe("new-sha-b-updated")
  })
})
