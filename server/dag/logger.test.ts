import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  createLogger,
  setLogLevel,
  getLogLevel,
  setLogSink,
  resetLogSink,
  type LogEntry,
  type Logger,
} from "./logger"

describe("logger", () => {
  let entries: LogEntry[]
  let originalLevel: ReturnType<typeof getLogLevel>

  beforeEach(() => {
    entries = []
    originalLevel = getLogLevel()
    setLogLevel("debug")
    setLogSink((entry) => entries.push(entry))
  })

  afterEach(() => {
    resetLogSink()
    setLogLevel(originalLevel)
  })

  it("emits entries with the component, level, and message", () => {
    const log = createLogger("scheduler")
    log.info("ticked")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.component).toBe("scheduler")
    expect(entries[0]!.level).toBe("info")
    expect(entries[0]!.msg).toBe("ticked")
  })

  it("merges fields from the call site into the entry", () => {
    const log = createLogger("scheduler")
    log.info({ dagId: "dag-1", nodeId: "n1" }, "spawned")
    expect(entries[0]!.fields).toEqual({ dagId: "dag-1", nodeId: "n1" })
    expect(entries[0]!.msg).toBe("spawned")
  })

  it("threads bound context via child()", () => {
    const log = createLogger("restack").child({ dagId: "dag-1", nodeId: "n1" })
    log.error({ err: "boom" }, "rebase failed")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.fields).toEqual({ dagId: "dag-1", nodeId: "n1", err: "boom" })
  })

  it("nested child() merges bindings rather than replacing them", () => {
    const log = createLogger("restack")
      .child({ dagId: "dag-1" })
      .child({ nodeId: "n1" })
      .child({ sessionId: "s1" })

    log.warn("debounced")
    expect(entries[0]!.fields).toEqual({ dagId: "dag-1", nodeId: "n1", sessionId: "s1" })
  })

  it("call-site fields override bindings on collision", () => {
    const log = createLogger("c").child({ dagId: "old" })
    log.info({ dagId: "new" }, "x")
    expect(entries[0]!.fields).toEqual({ dagId: "new" })
  })

  it("respects log levels", () => {
    setLogLevel("warn")
    const log = createLogger("c")
    log.debug("d")
    log.info("i")
    log.warn("w")
    log.error("e")
    expect(entries.map((e) => e.level)).toEqual(["warn", "error"])
  })

  it("silent level suppresses everything", () => {
    setLogLevel("silent")
    const log = createLogger("c")
    log.error({ dagId: "x" }, "e")
    expect(entries).toHaveLength(0)
  })

  it("supports message-only signature", () => {
    const log = createLogger("c").child({ dagId: "d" })
    log.info("plain")
    expect(entries[0]!.msg).toBe("plain")
    expect(entries[0]!.fields).toEqual({ dagId: "d" })
  })

  it("attaches a timestamp", () => {
    const before = Date.now()
    createLogger("c").info("x")
    const after = Date.now()
    expect(entries[0]!.timestamp).toBeGreaterThanOrEqual(before)
    expect(entries[0]!.timestamp).toBeLessThanOrEqual(after)
  })

  it("child loggers do not mutate parent bindings", () => {
    const parent = createLogger("c").child({ dagId: "dag-1" })
    const child = parent.child({ nodeId: "n1" })

    parent.info("parent-msg")
    child.info("child-msg")

    const parentEntry = entries.find((e) => e.msg === "parent-msg")!
    const childEntry = entries.find((e) => e.msg === "child-msg")!

    expect(parentEntry.fields).toEqual({ dagId: "dag-1" })
    expect(childEntry.fields).toEqual({ dagId: "dag-1", nodeId: "n1" })
  })

  it("logger interface satisfies the Logger type at compile time", () => {
    const log: Logger = createLogger("compile-time-check")
    log.info("ok")
    expect(entries).toHaveLength(1)
  })
})
