import { describe, it, expect, mock, beforeEach } from "bun:test"

const mockBuildCompletenessReviewPrompt = mock(() => "verify task prompt")
const mockParseCompletenessResult = mock(() => ({ passed: true, details: "ok" }))

mock.module("./verification", () => ({
  buildCompletenessReviewPrompt: mockBuildCompletenessReviewPrompt,
  parseCompletenessResult: mockParseCompletenessResult,
}))

const mockExtractDagItems = mock(async () => ({
  items: [
    { id: "a", title: "Task A", description: "Do A", dependsOn: [] },
  ],
}))

mock.module("./dag-extract", () => ({
  extractDagItems: mockExtractDagItems,
}))

const mockExtractJudgeOptions = mock(async (): Promise<{ options: { id: string; title: string; description: string }[] }> => ({ options: [] }))

mock.module("./judge-extraction", () => ({
  extractJudgeOptions: mockExtractJudgeOptions,
}))

const mockRunClaudeExtraction = mock(async () => "{}")
const mockRetryClaudeExtraction = mock(async () => "{}")
const mockBuildConversationText = mock(() => "")

mock.module("./claude-extract", () => ({
  runClaudeExtraction: mockRunClaudeExtraction,
  retryClaudeExtraction: mockRetryClaudeExtraction,
  buildConversationText: mockBuildConversationText,
}))

import { ShipPipeline } from "./pipeline"
import type { EngineContext } from "./types"
import type { TopicSession } from "./types"
import type { AutoAdvance } from "./types"
import type { DagGraph, DagNode } from "./types"

function makeMockFn<T extends (...args: never[]) => unknown>(impl?: T) {
  return mock(impl ?? (() => {})) as ReturnType<typeof mock>
}

function createMockContext(overrides: Partial<EngineContext> = {}): EngineContext {
  const sendMessage = makeMockFn(async () => ({ ok: true, messageId: 1 }))
  const postStatusImpl = makeMockFn(async () => ({ ok: true, messageId: null }))

  const ctx: EngineContext = {
    config: {
      claude: {},
      mcp: {},
      workspace: {
        sessionTimeoutMs: 300000,
        sessionInactivityTimeoutMs: 60000,
      },
      sessionEnvPassthrough: [],
      agentDefs: {},
    },
    notifier: {
      send: sendMessage,
    },
    observer: {
      onSessionStart: makeMockFn(async () => {}),
      onEvent: makeMockFn(async () => {}),
      onSessionComplete: makeMockFn(async () => {}),
      flush: makeMockFn(async () => {}),
    } as EngineContext["observer"],
    profileStore: {
      get: makeMockFn(() => undefined),
    },
    sessions: new Map(),
    topicSessions: new Map(),
    dags: new Map(),
    spawnTopicAgent: makeMockFn(async () => true),
    pushToConversation: makeMockFn(),
    postStatus: postStatusImpl,
    persistTopicSessions: makeMockFn(async () => {}),
    persistDags: makeMockFn(async () => {}),
    updateTopicTitle: makeMockFn(async () => {}),
    startDag: makeMockFn(async () => {}),
    handleLandCommand: makeMockFn(async () => {}),
    handleDeadThread: makeMockFn(),
    handleExecuteCommand: makeMockFn(async () => {}),
    ...overrides,
  }

  const originalPostStatus = ctx.postStatus
  ctx.postStatus = mock(async (topicSession: TopicSession, html: string, opts?: Record<string, unknown>) => {
    await ctx.notifier.send(html, topicSession.threadId)
    return originalPostStatus(topicSession, html, opts)
  })

  return ctx
}

function makeAutoAdvance(overrides: Partial<AutoAdvance> = {}): AutoAdvance {
  return {
    phase: "think",
    featureDescription: "Build a cool feature",
    autoLand: false,
    ...overrides,
  }
}

function makeSession(overrides: Partial<TopicSession> = {}): TopicSession {
  return {
    threadId: 100,
    repo: "org/repo",
    repoUrl: "https://github.com/org/repo",
    cwd: "/tmp/workspace",
    slug: "test-slug",
    conversation: [{ role: "user", text: "test task" }],
    pendingFeedback: [],
    mode: "ship-think",
    lastActivityAt: Date.now(),
    childThreadIds: [],
    autoAdvance: makeAutoAdvance(),
    ...overrides,
  }
}

function makeContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return createMockContext(overrides)
}

describe("ShipPipeline", () => {
  let ctx: EngineContext
  let pipeline: ShipPipeline

  beforeEach(() => {
    mockBuildCompletenessReviewPrompt.mockClear()
    mockParseCompletenessResult.mockClear()
    mockExtractDagItems.mockClear()
    mockExtractJudgeOptions.mockClear()
    mockRunClaudeExtraction.mockClear()
    mockRetryClaudeExtraction.mockClear()
    mockBuildConversationText.mockClear()
    mockExtractDagItems.mockImplementation(async () => ({
      items: [
        { id: "a", title: "Task A", description: "Do A", dependsOn: [] },
      ],
    }))
    mockExtractJudgeOptions.mockImplementation(async () => ({ options: [] }))
    mockParseCompletenessResult.mockImplementation(() => ({ passed: true, details: "ok" }))
    mockBuildCompletenessReviewPrompt.mockImplementation(() => "verify task prompt")
    mockRunClaudeExtraction.mockImplementation(async () => "{}")
    mockBuildConversationText.mockImplementation(() => "")
    ctx = makeContext()
    pipeline = new ShipPipeline(ctx)
  })

  describe("handleShipAdvance", () => {
    it("does nothing when autoAdvance is undefined", async () => {
      const session = makeSession({ autoAdvance: undefined })
      await pipeline.handleShipAdvance(session)
      expect(ctx.notifier.send).not.toHaveBeenCalled()
    })

    it("advances from think to plan phase", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "think" }),
        conversation: [{ role: "assistant", text: "research findings here" }],
      })

      await pipeline.handleShipAdvance(session)

      expect(session.autoAdvance!.phase).toBe("plan")
      expect(session.mode).toBe("ship-plan")
      expect(ctx.notifier.send).toHaveBeenCalled()
      expect(ctx.spawnTopicAgent).toHaveBeenCalled()
    })

    it("advances from plan through judge to dag when no options found", async () => {
      mockExtractJudgeOptions.mockImplementationOnce(async () => ({ options: [] }))

      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "plan" }),
      })

      await pipeline.handleShipAdvance(session)

      expect(session.autoAdvance!.phase).toBe("dag")
      expect(ctx.notifier.send).toHaveBeenCalledWith(
        expect.stringContaining("skipping judge arena"),
        session.threadId,
      )
      expect(ctx.startDag).toHaveBeenCalledWith(session, expect.any(Array), false)
    })

    it("advances from plan through judge arena to dag when options found", async () => {
      mockExtractJudgeOptions.mockImplementationOnce(async () => ({
        options: [
          { id: "opt-a", title: "Option A", description: "Use approach A" },
          { id: "opt-b", title: "Option B", description: "Use approach B" },
        ],
      }))

      mockRunClaudeExtraction
        .mockImplementationOnce(async () => JSON.stringify({ argument: "A is great", sources: ["src1"], searchCount: 1 }))
        .mockImplementationOnce(async () => JSON.stringify({ argument: "B is great", sources: ["src2"], searchCount: 1 }))
        .mockImplementationOnce(async () => JSON.stringify({
          chosenOptionId: "opt-a",
          reasoning: "A wins because reasons",
          summary: "Option A chosen",
          tradeoffs: ["tradeoff 1"],
        }))

      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "plan" }),
      })

      await pipeline.handleShipAdvance(session)

      expect(session.autoAdvance!.phase).toBe("dag")
      expect(ctx.pushToConversation).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ text: expect.stringContaining("Judge Arena Verdict") }),
      )
      expect(ctx.startDag).toHaveBeenCalledWith(session, expect.any(Array), false)
    })

    it("advances from plan to dag when judge extraction errors", async () => {
      mockExtractJudgeOptions.mockImplementationOnce(async () => { throw new Error("extraction boom") })

      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "plan" }),
      })

      await pipeline.handleShipAdvance(session)

      expect(session.autoAdvance!.phase).toBe("dag")
      expect(ctx.notifier.send).toHaveBeenCalledWith(
        expect.stringContaining("skipping to DAG"),
        session.threadId,
      )
      expect(ctx.startDag).toHaveBeenCalledWith(session, expect.any(Array), false)
    })

    it("does nothing for judge phase (auto-advances inline)", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "judge" }),
      })

      await pipeline.handleShipAdvance(session)

      expect(ctx.spawnTopicAgent).not.toHaveBeenCalled()
      expect(ctx.startDag).not.toHaveBeenCalled()
    })

    it("does nothing for dag phase (handled by DagOrchestrator)", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "dag" }),
      })

      await pipeline.handleShipAdvance(session)

      expect(ctx.spawnTopicAgent).not.toHaveBeenCalled()
      expect(ctx.startDag).not.toHaveBeenCalled()
    })

    it("does nothing for done phase", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "done" }),
      })

      await pipeline.handleShipAdvance(session)

      expect(ctx.notifier.send).not.toHaveBeenCalled()
    })
  })

  describe("shipAdvanceToDag", () => {
    it("reverts to plan phase on system extraction error with recovery hints", async () => {
      mockExtractDagItems.mockImplementationOnce(async () => ({
        items: [],
        error: "system",
        errorMessage: "API down",
      }))

      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "plan" }),
      })

      await pipeline.shipAdvanceToDag(session)

      expect(session.autoAdvance!.phase).toBe("plan")
      expect(ctx.updateTopicTitle).toHaveBeenCalledWith(session, "⚠️")
      const msg = (ctx.notifier.send as ReturnType<typeof mock>).mock.calls.find(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("DAG extraction failed"),
      )
      expect(msg).toBeDefined()
      expect(msg![0]).toContain("/dag")
      expect(msg![0]).toContain("/execute")
      expect(msg![0]).toContain("/split")
    })

    it("retries with enriched prompt when no items extracted, then succeeds", async () => {
      const retryItems = [
        { id: "a", title: "Task A", description: "Do A", dependsOn: [] },
      ]
      mockExtractDagItems
        .mockImplementationOnce(async () => ({ items: [] }))
        .mockImplementationOnce(async () => ({ items: retryItems }))

      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "plan" }),
      })

      await pipeline.shipAdvanceToDag(session)

      expect(mockExtractDagItems).toHaveBeenCalledTimes(2)
      expect(mockExtractDagItems).toHaveBeenNthCalledWith(2,
        session.conversation,
        expect.stringContaining("previous extraction returned zero items"),
        undefined,
      )
      expect(ctx.notifier.send).toHaveBeenCalledWith(
        expect.stringContaining("retrying with enriched prompt"),
        session.threadId,
      )
      expect(ctx.startDag).toHaveBeenCalledWith(session, retryItems, false)
      expect(ctx.handleExecuteCommand).not.toHaveBeenCalled()
    })

    it("prompts user with options when retry also yields no items and resets phase to plan", async () => {
      mockExtractDagItems
        .mockImplementationOnce(async () => ({ items: [] }))
        .mockImplementationOnce(async () => ({ items: [] }))

      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "plan" }),
      })

      await pipeline.shipAdvanceToDag(session)

      expect(session.autoAdvance!.phase).toBe("plan")
      expect(mockExtractDagItems).toHaveBeenCalledTimes(2)
      expect(ctx.handleExecuteCommand).not.toHaveBeenCalled()
      expect(ctx.startDag).not.toHaveBeenCalled()
      const msg = (ctx.notifier.send as ReturnType<typeof mock>).mock.calls.find(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("Still no work items"),
      )
      expect(msg).toBeDefined()
      expect(msg![0]).toContain("/dag")
      expect(msg![0]).toContain("/execute")
      expect(msg![0]).toContain("/split")
      expect(msg![0]).toContain("/close")
    })

    it("starts DAG with extracted items", async () => {
      const items = [
        { id: "a", title: "Task A", description: "Do A", dependsOn: [] },
      ]
      mockExtractDagItems.mockImplementationOnce(async () => ({ items }))

      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "plan" }),
      })

      await pipeline.shipAdvanceToDag(session)

      expect(session.autoAdvance!.phase).toBe("dag")
      expect(ctx.startDag).toHaveBeenCalledWith(session, items, false)
      expect(ctx.persistTopicSessions).toHaveBeenCalled()
    })
  })

  describe("shipAdvanceToVerification", () => {
    it("skips to finalize when no completed nodes", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "dag" }),
        dagId: "dag-1",
      })
      const graph: DagGraph = {
        id: "dag-1",
        parentThreadId: 100,
        repoUrl: "https://github.com/org/repo",
        nodes: [
          { id: "a", title: "Task A", description: "Do A", dependsOn: [], status: "failed" } as DagNode,
        ],
        isStack: false,
      }

      await pipeline.shipAdvanceToVerification(session, graph)

      expect(session.autoAdvance!.phase).toBe("done")
      expect(ctx.notifier.send).toHaveBeenCalledWith(
        expect.stringContaining("Ship complete"),
        session.threadId,
      )
    })

    it("cleans up session state when onSessionStart rejects", async () => {
      const childSession = makeSession({
        threadId: 200,
        slug: "child-slug",
        repo: "org/repo",
        repoUrl: "https://github.com/org/repo",
        cwd: "/tmp/child-workspace",
        childThreadIds: [],
      })
      ctx.topicSessions.set(200, childSession)

      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "dag" }),
        dagId: "dag-1",
        childThreadIds: [200],
      })
      const graph: DagGraph = {
        id: "dag-1",
        parentThreadId: 100,
        repoUrl: "https://github.com/org/repo",
        nodes: [
          { id: "a", title: "Task A", description: "Do A", dependsOn: [], status: "done", prUrl: "https://github.com/org/repo/pull/1", branch: "feat-a", threadId: 200 } as DagNode,
        ],
        isStack: false,
      }

      ;(ctx.observer.onSessionStart as ReturnType<typeof mock>).mockImplementationOnce(async () => { throw new Error("session start boom") })

      await pipeline.shipAdvanceToVerification(session, graph)

      expect(ctx.sessions.has(200)).toBe(false)
      expect(childSession.activeSessionId).toBeUndefined()
      expect(session.autoAdvance!.phase).toBe("done")
    })

    it("skips child without matching session and decrements pending count", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "dag" }),
        dagId: "dag-1",
        childThreadIds: [200],
      })
      const graph: DagGraph = {
        id: "dag-1",
        parentThreadId: 100,
        repoUrl: "https://github.com/org/repo",
        nodes: [
          { id: "a", title: "Task A", description: "Do A", dependsOn: [], status: "done", prUrl: "https://github.com/org/repo/pull/1", branch: "feat-a", threadId: 200 } as DagNode,
        ],
        isStack: false,
      }

      await pipeline.shipAdvanceToVerification(session, graph)

      expect(session.autoAdvance!.phase).toBe("done")
      expect(ctx.sessions.size).toBe(0)
    })
  })

  describe("shipFinalize", () => {
    it("sends completion message with verification results", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "verify" }),
        dagId: "dag-1",
        verificationState: {
          dagId: "dag-1",
          maxRounds: 1,
          rounds: [{
            round: 1,
            checks: [
              { kind: "completeness-review", status: "passed", nodeId: "a", finishedAt: Date.now() },
              { kind: "completeness-review", status: "passed", nodeId: "b", finishedAt: Date.now() },
            ],
            startedAt: Date.now(),
          }],
          status: "passed",
        },
      })

      await pipeline.shipFinalize(session)

      expect(session.autoAdvance!.phase).toBe("done")
      expect(ctx.notifier.send).toHaveBeenCalledWith(
        expect.stringContaining("Ship complete"),
        session.threadId,
      )
      expect(ctx.updateTopicTitle).toHaveBeenCalledWith(session, "✅")
    })

    it("auto-lands when autoLand is true and all passed", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "verify", autoLand: true }),
        dagId: "dag-1",
        verificationState: {
          dagId: "dag-1",
          maxRounds: 1,
          rounds: [{
            round: 1,
            checks: [
              { kind: "completeness-review", status: "passed", nodeId: "a", finishedAt: Date.now() },
            ],
            startedAt: Date.now(),
          }],
          status: "passed",
        },
      })

      await pipeline.shipFinalize(session)

      expect(ctx.handleLandCommand).toHaveBeenCalledWith(session)
      expect(ctx.updateTopicTitle).toHaveBeenCalledWith(session, "✅")
    })

    it("shows land hint when all passed but autoLand is false", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "verify", autoLand: false }),
        dagId: "dag-1",
        verificationState: {
          dagId: "dag-1",
          maxRounds: 1,
          rounds: [{
            round: 1,
            checks: [
              { kind: "completeness-review", status: "passed", nodeId: "a", finishedAt: Date.now() },
            ],
            startedAt: Date.now(),
          }],
          status: "passed",
        },
      })

      await pipeline.shipFinalize(session)

      expect(ctx.handleLandCommand).not.toHaveBeenCalled()
      expect(ctx.notifier.send).toHaveBeenCalledWith(
        expect.stringContaining("/land"),
        session.threadId,
      )
    })

    it("sets warning emoji when verification has failures", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "verify" }),
        dagId: "dag-1",
        verificationState: {
          dagId: "dag-1",
          maxRounds: 1,
          rounds: [{
            round: 1,
            checks: [
              { kind: "completeness-review", status: "passed", nodeId: "a", finishedAt: Date.now() },
              { kind: "completeness-review", status: "failed", nodeId: "b", finishedAt: Date.now() },
            ],
            startedAt: Date.now(),
          }],
          status: "failed",
        },
      })

      await pipeline.shipFinalize(session)

      expect(ctx.updateTopicTitle).toHaveBeenCalledWith(session, "⚠️")
      expect(ctx.handleLandCommand).not.toHaveBeenCalled()
    })

    it("handles no verification state gracefully", async () => {
      const session = makeSession({
        autoAdvance: makeAutoAdvance({ phase: "verify" }),
      })

      await pipeline.shipFinalize(session)

      expect(session.autoAdvance!.phase).toBe("done")
      expect(ctx.updateTopicTitle).toHaveBeenCalledWith(session, "✅")
    })
  })
})
