import { describe, it, expect, beforeEach, mock, vi } from "bun:test"
import { Database } from "bun:sqlite"
import { openDatabase, runMigrations, prepared } from "../db/sqlite"
import type { SessionRow } from "../db/sqlite"

mock.module("node:child_process", () => ({
  spawn: vi.fn(),
}))

import { handleExecute, handleSplit, handleStack, handleDag } from "./plan-actions"
import type { PlanActionCtx } from "./plan-actions"
import type { SessionRegistry } from "../session/registry"
import type { SpawnedChild } from "../dag/claude-extract"
import { spawn } from "node:child_process"

const mockSpawn = spawn as ReturnType<typeof vi.fn>

function makeTestDb(): Database {
  const db = openDatabase(":memory:")
  runMigrations(db)
  return db
}

function makeEmptyChild(): SpawnedChild {
  return {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === "data") cb(Buffer.from("[]"))
      }),
    },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === "close") cb(0)
    }),
    kill: vi.fn(),
  }
}

function makeDagItemsChild(items: Array<{ id: string; title: string; description: string; dependsOn: string[] }>): SpawnedChild {
  const output = JSON.stringify(items)
  return {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === "data") cb(Buffer.from(output))
      }),
    },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === "close") cb(0)
    }),
    kill: vi.fn(),
  }
}

function insertSession(db: Database, overrides: Partial<SessionRow> = {}): string {
  const now = Date.now()
  const row: SessionRow = {
    id: `session-${Math.random().toString(36).slice(2)}`,
    slug: `test-slug-${Math.random().toString(36).slice(2)}`,
    status: "running",
    command: "plan something",
    mode: "plan",
    repo: "https://github.com/org/repo",
    branch: null,
    bare_dir: null,
    pr_url: null,
    parent_id: null,
    variant_group_id: null,
    claude_session_id: null,
    workspace_root: null,
    created_at: now,
    updated_at: now,
    needs_attention: false,
    attention_reasons: [],
    quick_actions: [],
    conversation: [],
    quota_sleep_until: null,
    quota_retry_count: 0,
    metadata: {},
    pipeline_advancing: false,
    ...overrides,
  }
  prepared.insertSession(db, row)
  return row.id
}

function makeRegistry(stopCalls: string[]): SessionRegistry {
  return {
    create: async () => { throw new Error("not used") },
    get: () => undefined,
    getBySlug: () => undefined,
    list: () => [],
    snapshot: () => undefined,
    stop: async (sessionId: string) => { stopCalls.push(sessionId) },
    close: async () => {},
    reply: async () => true,
    reconcileOnBoot: async () => {},
    scheduleQuotaResume: async () => {},
  }
}

function makeScheduler(startedDagIds: string[]): { start: (dagId: string) => Promise<void> } {
  return {
    start: async (dagId: string) => { startedDagIds.push(dagId) },
  }
}

describe("plan-actions gating", () => {
  let db: Database

  beforeEach(() => {
    db = makeTestDb()
    vi.clearAllMocks()
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    mockSpawn.mockImplementation(() => makeEmptyChild())
  })

  it("rejects with pipeline already advancing when flag is set", async () => {
    const sessionId = insertSession(db, { pipeline_advancing: true })
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleExecute(sessionId, ctx)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("pipeline already advancing")
    expect(stopCalls).toHaveLength(0)
  })

  it("rejects with session not found for unknown session id", async () => {
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleExecute("nonexistent-session-id", ctx)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("session not found")
  })

  it("calls registry.stop before extracting items", async () => {
    const sessionId = insertSession(db)
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    await handleExecute(sessionId, ctx)

    expect(stopCalls).toContain(sessionId)
  })

  it("returns ok:false with no items when extraction returns empty array", async () => {
    const sessionId = insertSession(db)
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    mockSpawn.mockImplementation(() => makeEmptyChild())

    const result = await handleExecute(sessionId, ctx)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("no items extracted")
    expect(startedDagIds).toHaveLength(0)
  })

  it("includes assistant_text events (final:true) in the extraction conversation", async () => {
    const sessionId = insertSession(db)
    const now = Date.now()
    prepared.insertEvent(db, {
      session_id: sessionId,
      seq: 1,
      turn: 0,
      type: "user_message",
      timestamp: now,
      payload: { text: "please plan the work" },
    })
    prepared.insertEvent(db, {
      session_id: sessionId,
      seq: 2,
      turn: 1,
      type: "assistant_text",
      timestamp: now + 1,
      payload: { text: "DELTA_CHUNK_do_not_include", final: false },
    })
    prepared.insertEvent(db, {
      session_id: sessionId,
      seq: 3,
      turn: 1,
      type: "assistant_text",
      timestamp: now + 2,
      payload: { text: "FINAL_PLAN_build_the_schema", final: true },
    })

    const stdinWrites: string[] = []
    mockSpawn.mockImplementation(() => ({
      stdout: {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === "data") cb(Buffer.from("[]"))
        }),
      },
      stderr: { on: vi.fn() },
      stdin: {
        write: vi.fn((data: string) => { stdinWrites.push(data) }),
        end: vi.fn(),
      },
      on: vi.fn((event: string, cb: (code: number) => void) => {
        if (event === "close") cb(0)
      }),
      kill: vi.fn(),
    }))

    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    await handleExecute(sessionId, ctx)

    const combined = stdinWrites.join("")
    expect(combined).toContain("please plan the work")
    expect(combined).toContain("FINAL_PLAN_build_the_schema")
    expect(combined).not.toContain("DELTA_CHUNK_do_not_include")
  })
})

describe("handleSplit", () => {
  let db: Database

  beforeEach(() => {
    db = makeTestDb()
    vi.clearAllMocks()
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  it("creates a DAG with no dependencies for parallel execution", async () => {
    const items = [
      { id: "a", title: "A", description: "Do A", dependsOn: [] },
      { id: "b", title: "B", description: "Do B", dependsOn: ["a"] },
    ]
    mockSpawn.mockImplementation(() => makeDagItemsChild(items))

    const sessionId = insertSession(db)
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleSplit(sessionId, ctx)

    expect(result.ok).toBe(true)
    expect(result.dagId).toBeTruthy()
    expect(startedDagIds).toHaveLength(1)
  })
})

describe("handleStack", () => {
  let db: Database

  beforeEach(() => {
    db = makeTestDb()
    vi.clearAllMocks()
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  it("creates a linear DAG where each step depends on the previous", async () => {
    const stackItems = [
      { title: "First step", description: "Do first" },
      { title: "Second step", description: "Do second" },
      { title: "Third step", description: "Do third" },
    ]
    mockSpawn.mockImplementation(() => {
      const output = JSON.stringify(stackItems)
      return {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === "data") cb(Buffer.from(output))
          }),
        },
        stderr: { on: vi.fn() },
        stdin: { write: vi.fn(), end: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") cb(0)
        }),
        kill: vi.fn(),
      }
    })

    const sessionId = insertSession(db)
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleStack(sessionId, ctx)

    expect(result.ok).toBe(true)
    expect(result.dagId).toBeTruthy()
    expect(startedDagIds).toHaveLength(1)
  })
})

describe("handleDag", () => {
  let db: Database

  beforeEach(() => {
    db = makeTestDb()
    vi.clearAllMocks()
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  it("parses items from provided markdown and starts a DAG", async () => {
    const markdown = JSON.stringify([
      { id: "task-1", title: "Task 1", description: "Do task 1", dependsOn: [] },
      { id: "task-2", title: "Task 2", description: "Do task 2", dependsOn: ["task-1"] },
    ])

    const sessionId = insertSession(db)
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleDag(markdown, sessionId, ctx)

    expect(result.ok).toBe(true)
    expect(result.dagId).toBeTruthy()
    expect(startedDagIds).toHaveLength(1)
  })

  it("returns ok:false when markdown is invalid and no last assistant message", async () => {
    const sessionId = insertSession(db)
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleDag("not valid json", sessionId, ctx)

    expect(result.ok).toBe(false)
    expect(startedDagIds).toHaveLength(0)
  })

  it("rejects pipeline_advancing sessions", async () => {
    const sessionId = insertSession(db, { pipeline_advancing: true })
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleDag("[]", sessionId, ctx)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("pipeline already advancing")
  })
})
