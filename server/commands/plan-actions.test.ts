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
import type { SessionRuntime } from "../session/runtime"
import type { ApiSession } from "../../shared/api-types"
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
    stage: null,
    coordinator_children: [],
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

  it("spawns a new child task session for think/plan/review modes", async () => {
    const sessionId = insertSession(db, { mode: "think" })
    prepared.insertEvent(db, {
      session_id: sessionId,
      seq: 1,
      turn: 1,
      type: "assistant_text",
      timestamp: Date.now(),
      payload: { text: "Here is my analysis of the problem", final: true, blockId: "block-1" },
    })
    const stopCalls: string[] = []
    const createCalls: Array<{ mode: string; prompt: string; parentId?: string }> = []
    const startedDagIds: string[] = []
    const mockRuntime: Partial<SessionRuntime> = {
      running: false,
      currentProviderSessionId: undefined,
      start: async () => {},
      injectInput: async () => false,
      stop: async () => {},
    }
    const mockSession: Partial<ApiSession> = {
      id: "child-session-id",
    }
    const registry: SessionRegistry = {
      ...makeRegistry(stopCalls),
      create: async (opts) => {
        createCalls.push({ mode: opts.mode, prompt: opts.prompt, parentId: opts.parentId })
        return {
          session: mockSession as ApiSession,
          runtime: mockRuntime as SessionRuntime,
        }
      },
    }
    const ctx: PlanActionCtx = {
      db,
      registry,
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleExecute(sessionId, ctx)

    expect(result.ok).toBe(true)
    expect(result.dagId).toBe("child-session-id")
    expect(stopCalls).toHaveLength(1)
    expect(stopCalls[0]).toBe(sessionId)
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.mode).toBe("dag-task")
    expect(createCalls[0]?.parentId).toBe(sessionId)
    expect(createCalls[0]?.prompt).toContain("Here is my analysis of the problem")
    expect(createCalls[0]?.prompt).toContain("gh pr create")
    // think mode gets the "pick the highest-leverage item" directive
    expect(createCalls[0]?.prompt).toContain("highest-leverage item")
    expect(createCalls[0]?.prompt).toContain("research/analysis, not a concrete implementation plan")
  })

  it("uses the guided directive when userContext is provided in think mode (overrides item-picking)", async () => {
    const sessionId = insertSession(db, { mode: "think" })
    prepared.insertEvent(db, {
      session_id: sessionId,
      seq: 1,
      turn: 1,
      type: "assistant_text",
      timestamp: Date.now(),
      payload: { text: "Option 1: Foo. Option 2: Bar.", final: true, blockId: "block-1" },
    })
    const createCalls: Array<{ mode: string; prompt: string }> = []
    const mockRuntime: Partial<SessionRuntime> = {
      running: false,
      currentProviderSessionId: undefined,
      start: async () => {},
      injectInput: async () => false,
      stop: async () => {},
    }
    const registry: SessionRegistry = {
      ...makeRegistry([]),
      create: async (opts) => {
        createCalls.push({ mode: opts.mode, prompt: opts.prompt })
        return {
          session: { id: "child-guided" } as ApiSession,
          runtime: mockRuntime as SessionRuntime,
        }
      },
    }
    const ctx: PlanActionCtx = {
      db,
      registry,
      scheduler: makeScheduler([]),
    }

    const result = await handleExecute(sessionId, ctx, "do option 1")

    expect(result.ok).toBe(true)
    expect(createCalls[0]?.prompt).toContain("Option 1: Foo. Option 2: Bar.")
    expect(createCalls[0]?.prompt).toContain("<user_direction>")
    expect(createCalls[0]?.prompt).toContain("do option 1")
    expect(createCalls[0]?.prompt).toContain("</user_direction>")
    expect(createCalls[0]?.prompt).not.toContain("Pick the SINGLE highest-leverage item")
    expect(createCalls[0]?.prompt).not.toContain("research/analysis, not a concrete implementation plan")
  })

  it("uses the guided directive when userContext is provided in plan mode", async () => {
    const sessionId = insertSession(db, { mode: "plan" })
    prepared.insertEvent(db, {
      session_id: sessionId,
      seq: 1,
      turn: 1,
      type: "assistant_text",
      timestamp: Date.now(),
      payload: { text: "Plan steps here.", final: true, blockId: "block-1" },
    })
    const createCalls: Array<{ prompt: string }> = []
    const mockRuntime: Partial<SessionRuntime> = {
      running: false,
      currentProviderSessionId: undefined,
      start: async () => {},
      injectInput: async () => false,
      stop: async () => {},
    }
    const registry: SessionRegistry = {
      ...makeRegistry([]),
      create: async (opts) => {
        createCalls.push({ prompt: opts.prompt })
        return {
          session: { id: "child" } as ApiSession,
          runtime: mockRuntime as SessionRuntime,
        }
      },
    }
    const ctx: PlanActionCtx = {
      db,
      registry,
      scheduler: makeScheduler([]),
    }

    await handleExecute(sessionId, ctx, "skip step 3")

    expect(createCalls[0]?.prompt).toContain("<user_direction>")
    expect(createCalls[0]?.prompt).toContain("skip step 3")
    expect(createCalls[0]?.prompt).not.toContain("Implement your plan now")
  })

  it("ignores empty/whitespace userContext and falls back to default directive", async () => {
    const sessionId = insertSession(db, { mode: "think" })
    prepared.insertEvent(db, {
      session_id: sessionId,
      seq: 1,
      turn: 1,
      type: "assistant_text",
      timestamp: Date.now(),
      payload: { text: "Analysis here.", final: true, blockId: "block-1" },
    })
    const createCalls: Array<{ prompt: string }> = []
    const mockRuntime: Partial<SessionRuntime> = {
      running: false,
      currentProviderSessionId: undefined,
      start: async () => {},
      injectInput: async () => false,
      stop: async () => {},
    }
    const registry: SessionRegistry = {
      ...makeRegistry([]),
      create: async (opts) => {
        createCalls.push({ prompt: opts.prompt })
        return {
          session: { id: "child" } as ApiSession,
          runtime: mockRuntime as SessionRuntime,
        }
      },
    }
    const ctx: PlanActionCtx = {
      db,
      registry,
      scheduler: makeScheduler([]),
    }

    await handleExecute(sessionId, ctx, "   ")

    expect(createCalls[0]?.prompt).toContain("Pick the SINGLE highest-leverage item")
    expect(createCalls[0]?.prompt).not.toContain("<user_direction>")
  })

  it("injects guided directive (not default) into task-mode session when userContext is provided", async () => {
    const sessionId = insertSession(db, { mode: "task" })
    const replyCalls: Array<{ sessionId: string; text: string }> = []
    const registry = {
      ...makeRegistry([]),
      reply: async (sid: string, text: string) => {
        replyCalls.push({ sessionId: sid, text })
        return true
      },
    }
    const ctx: PlanActionCtx = {
      db,
      registry,
      scheduler: makeScheduler([]),
    }

    const result = await handleExecute(sessionId, ctx, "focus on auth refactor")

    expect(result.ok).toBe(true)
    expect(replyCalls[0]?.text).toContain("<user_direction>")
    expect(replyCalls[0]?.text).toContain("focus on auth refactor")
    expect(replyCalls[0]?.text).not.toContain("Implement your plan now")
  })

  it("uses the plain implementation directive for plan/review modes (not the think variant)", async () => {
    const sessionId = insertSession(db, { mode: "plan" })
    prepared.insertEvent(db, {
      session_id: sessionId,
      seq: 1,
      turn: 1,
      type: "assistant_text",
      timestamp: Date.now(),
      payload: { text: "Step 1: do X. Step 2: do Y.", final: true, blockId: "block-1" },
    })
    const createCalls: Array<{ mode: string; prompt: string }> = []
    const mockRuntime: Partial<SessionRuntime> = {
      running: false,
      currentProviderSessionId: undefined,
      start: async () => {},
      injectInput: async () => false,
      stop: async () => {},
    }
    const registry: SessionRegistry = {
      ...makeRegistry([]),
      create: async (opts) => {
        createCalls.push({ mode: opts.mode, prompt: opts.prompt })
        return {
          session: { id: "child" } as ApiSession,
          runtime: mockRuntime as SessionRuntime,
        }
      },
    }
    const ctx: PlanActionCtx = {
      db,
      registry,
      scheduler: makeScheduler([]),
    }

    await handleExecute(sessionId, ctx)

    expect(createCalls[0]?.prompt).toContain("Implement your plan now")
    expect(createCalls[0]?.prompt).not.toContain("highest-leverage item")
    expect(createCalls[0]?.prompt).not.toContain("research/analysis, not a concrete implementation plan")
  })

  it("returns ok:false when there is no plan to execute for think/plan/review modes", async () => {
    const sessionId = insertSession(db, { mode: "plan" })
    const registry = makeRegistry([])
    const ctx: PlanActionCtx = {
      db,
      registry,
      scheduler: makeScheduler([]),
    }

    const result = await handleExecute(sessionId, ctx)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("no plan/analysis to execute")
  })

  it("replies to the session for task mode (no child session spawn)", async () => {
    const sessionId = insertSession(db, { mode: "task" })
    const replyCalls: Array<{ sessionId: string; text: string }> = []
    const stopCalls: string[] = []
    const registry = {
      ...makeRegistry(stopCalls),
      reply: async (sid: string, text: string) => {
        replyCalls.push({ sessionId: sid, text })
        return true
      },
    }
    const ctx: PlanActionCtx = {
      db,
      registry,
      scheduler: makeScheduler([]),
    }

    const result = await handleExecute(sessionId, ctx)

    expect(result.ok).toBe(true)
    expect(stopCalls).toHaveLength(0)
    expect(replyCalls).toHaveLength(1)
    expect(replyCalls[0]?.sessionId).toBe(sessionId)
    expect(replyCalls[0]?.text).toContain("gh pr create")
  })

  it("ship-plan is rejected as an unsupported legacy mode", async () => {
    const sessionId = insertSession(db, { mode: "ship-plan" })
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleExecute(sessionId, ctx)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("execute not supported for mode ship-plan")
    expect(stopCalls).toHaveLength(0)
    expect(startedDagIds).toHaveLength(0)
  })

  it("ship-plan with no DAG output remains unsupported", async () => {
    const sessionId = insertSession(db, { mode: "ship-plan" })
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleExecute(sessionId, ctx)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("execute not supported for mode ship-plan")
    expect(startedDagIds).toHaveLength(0)
  })

  it("ship-plan does not fall back to DAG extraction", async () => {
    const sessionId = insertSession(db, { mode: "ship-plan" })
    const stopCalls: string[] = []
    const startedDagIds: string[] = []
    const ctx: PlanActionCtx = {
      db,
      registry: makeRegistry(stopCalls),
      scheduler: makeScheduler(startedDagIds),
    }

    const result = await handleExecute(sessionId, ctx)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("execute not supported for mode ship-plan")
    expect(stopCalls).toHaveLength(0)
    expect(startedDagIds).toHaveLength(0)
  })

  it("rejects unknown modes with helpful error message", async () => {
    const sessionId = insertSession(db, { mode: "unknown-mode" })
    const stopCalls: string[] = []
    const replyCalls: Array<{ sessionId: string; text: string }> = []
    const registry = {
      ...makeRegistry(stopCalls),
      reply: async (sid: string, text: string) => {
        replyCalls.push({ sessionId: sid, text })
        return true
      },
    }
    const ctx: PlanActionCtx = {
      db,
      registry,
      scheduler: makeScheduler([]),
    }

    const result = await handleExecute(sessionId, ctx)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("execute not supported")
    expect(result.reason).toContain("unknown-mode")
    expect(replyCalls).toHaveLength(0)
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

  it("does not stop a ship coordinator before scheduling its DAG", async () => {
    const markdown = JSON.stringify([
      { id: "task-1", title: "Task 1", description: "Do task 1", dependsOn: [] },
    ])

    const sessionId = insertSession(db, { mode: "ship", stage: "plan" })
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
    expect(stopCalls).toHaveLength(0)
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
