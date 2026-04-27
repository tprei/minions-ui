import { describe, it, expect, beforeEach } from "bun:test"
import { createDagWatchdog } from "./watchdog"
import type { StallAction, StallEvent } from "./watchdog"
import { buildDag } from "./dag"
import { EngineEventBus } from "../events/bus"
import type { EngineEventOfKind } from "../events/types"

type StalledEvent = EngineEventOfKind<"dag.stalled">

function makeGraph(deadlineMs?: number) {
  const graph = buildDag(
    "dag-test",
    [{ id: "a", title: "Task A", description: "A", dependsOn: [] }],
    "root-session",
    "https://github.com/org/repo",
    undefined,
    deadlineMs != null ? { deadlineMs } : undefined,
  )
  graph.nodes[0]!.status = "running"
  graph.nodes[0]!.sessionId = "session-a"
  return graph
}

describe("DagWatchdog", () => {
  let bus: EngineEventBus
  let stallEvents: StalledEvent[]
  let onStallCalls: Array<{ event: StallEvent; action: StallAction }>

  beforeEach(() => {
    bus = new EngineEventBus()
    stallEvents = []
    onStallCalls = []
    bus.onKind("dag.stalled", (e) => stallEvents.push(e))
  })

  function makeWatchdog(overrides: { now?: () => number; stallThresholdMs?: number; maxRetries?: number; onStall?: (event: StallEvent, action: StallAction) => Promise<void> } = {}) {
    return createDagWatchdog({
      bus,
      stallThresholdMs: overrides.stallThresholdMs ?? 1000,
      checkIntervalMs: 1_000_000,
      maxRetries: overrides.maxRetries ?? 1,
      now: overrides.now,
      setIntervalFn: (() => 0) as unknown as typeof setInterval,
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      onStall: overrides.onStall ?? (async (event, action) => {
        onStallCalls.push({ event, action })
      }),
    })
  }

  it("does not fire before stall threshold is reached", async () => {
    let t = 0
    const dog = makeWatchdog({ now: () => t })
    dog.arm(makeGraph())

    t = 500
    await dog.tick()

    expect(stallEvents).toHaveLength(0)
    expect(onStallCalls).toHaveLength(0)
  })

  it("fires no-progress stall after threshold elapses with retry action on first stall", async () => {
    let t = 0
    const dog = makeWatchdog({ now: () => t, stallThresholdMs: 1000, maxRetries: 1 })
    dog.arm(makeGraph())

    t = 1500
    await dog.tick()

    expect(stallEvents).toHaveLength(1)
    const ev = stallEvents[0]!
    expect(ev.reason).toBe("no-progress")
    expect(ev.action).toBe("retry")
    expect(ev.runningNodeIds).toEqual(["a"])
    expect(ev.stallCount).toBe(1)
  })

  it("escalates to fail-forward after retry budget exhausted", async () => {
    let t = 0
    const dog = makeWatchdog({ now: () => t, stallThresholdMs: 1000, maxRetries: 1 })
    dog.arm(makeGraph())

    t = 1500
    await dog.tick()
    t = 3000
    await dog.tick()

    expect(stallEvents).toHaveLength(2)
    expect(stallEvents[0]!.action).toBe("retry")
    expect(stallEvents[1]!.action).toBe("fail-forward")
    expect(stallEvents[1]!.stallCount).toBe(2)
  })

  it("fires deadline stall when graph deadlineMs is reached, regardless of progress", async () => {
    let t = 0
    const dog = makeWatchdog({ now: () => t, stallThresholdMs: 1_000_000_000 })
    dog.arm(makeGraph(2000))

    t = 1500
    await dog.tick()
    expect(stallEvents).toHaveLength(0)

    dog.notifyProgress("dag-test", 1900)

    t = 2500
    await dog.tick()

    expect(stallEvents).toHaveLength(1)
    expect(stallEvents[0]!.reason).toBe("deadline")
    expect(stallEvents[0]!.action).toBe("fail-forward")
  })

  it("notifyProgress shifts the stall timer but keeps stallCount", async () => {
    let t = 0
    const dog = makeWatchdog({ now: () => t, stallThresholdMs: 1000, maxRetries: 1 })
    dog.arm(makeGraph())

    t = 800
    dog.notifyProgress("dag-test", t)

    t = 1500
    await dog.tick()
    expect(stallEvents).toHaveLength(0)

    t = 1900
    await dog.tick()
    expect(stallEvents).toHaveLength(1)
    expect(stallEvents[0]!.stallCount).toBe(1)

    dog.notifyProgress("dag-test", 1900)

    t = 3000
    await dog.tick()
    expect(stallEvents).toHaveLength(2)
    expect(stallEvents[1]!.stallCount).toBe(2)
    expect(stallEvents[1]!.action).toBe("fail-forward")
  })

  it("notifyResolved resets stallCount so retries are budgeted again", async () => {
    let t = 0
    const dog = makeWatchdog({ now: () => t, stallThresholdMs: 1000, maxRetries: 1 })
    dog.arm(makeGraph())

    t = 1500
    await dog.tick()
    expect(stallEvents.at(-1)!.action).toBe("retry")

    dog.notifyResolved("dag-test", 1500)

    t = 3000
    await dog.tick()
    expect(stallEvents.at(-1)!.action).toBe("retry")
    expect(stallEvents.at(-1)!.stallCount).toBe(1)
  })

  it("disarm stops further stall events for that DAG", async () => {
    let t = 0
    const dog = makeWatchdog({ now: () => t })
    dog.arm(makeGraph())

    dog.disarm("dag-test")

    t = 5000
    await dog.tick()

    expect(stallEvents).toHaveLength(0)
  })

  it("calls onStall handler with the stall event and action", async () => {
    let t = 0
    const dog = makeWatchdog({ now: () => t, stallThresholdMs: 1000 })
    dog.arm(makeGraph())

    t = 1500
    await dog.tick()

    expect(onStallCalls).toHaveLength(1)
    expect(onStallCalls[0]!.event.reason).toBe("no-progress")
    expect(onStallCalls[0]!.action).toBe("retry")
    expect(onStallCalls[0]!.event.graph.id).toBe("dag-test")
  })

  it("does not double-fire while a stall handler is in flight", async () => {
    let t = 0
    let release: (() => void) | undefined
    const dog = makeWatchdog({
      now: () => t,
      stallThresholdMs: 1000,
      onStall: () => new Promise<void>((resolve) => { release = resolve }),
    })
    dog.arm(makeGraph())

    t = 1500
    void dog.tick()
    t = 3000
    await dog.tick()

    expect(stallEvents).toHaveLength(1)
    release?.()
  })
})
