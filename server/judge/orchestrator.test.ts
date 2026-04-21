import { describe, it, expect, vi, beforeEach, afterEach, mock } from "bun:test"
import type { SpawnedChild } from "../dag/claude-extract"

mock.module("node:child_process", () => ({
  spawn: vi.fn(),
}))

import { spawn } from "node:child_process"
import { createJudgeOrchestrator } from "./orchestrator"
import type { JudgeOptions } from "./orchestrator"
import type { TopicMessage } from "../dag/types"

const mockSpawn = spawn as ReturnType<typeof vi.fn>

function makeChild(output: string): SpawnedChild {
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

const CONVERSATION: TopicMessage[] = [
  { role: "user", text: "How should we structure the database layer?" },
  { role: "assistant", text: "I see two main options: use an ORM or write raw SQL." },
]

describe("JudgeOrchestrator.run", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns winnerIdx 0 when only one position provided", async () => {
    const orchestrator = createJudgeOrchestrator()
    const options: JudgeOptions = {
      conversation: CONVERSATION,
      positions: ["Use raw SQL for performance"],
    }

    const result = await orchestrator.run("session-1", options)
    expect(result.winnerIdx).toBe(0)
    expect(result.rationale).toContain("Only one position")
  })

  it("picks winner based on judge output with three advocates", async () => {
    const positions = [
      "Use an ORM for developer productivity",
      "Use raw SQL for performance and control",
      "Use a query builder as a middle ground",
    ]

    const advocateOutputs = positions.map((position, i) => ({
      position,
      argument: `Argument for position ${i}: compelling reasons here`,
      score: 6 + i,
    }))

    let callCount = 0
    mockSpawn.mockImplementation(() => {
      const idx = callCount++
      if (idx === 0) {
        return makeChild(JSON.stringify(positions))
      }
      const advocateIdx = idx - 1
      if (advocateIdx < 3) {
        return makeChild(JSON.stringify(advocateOutputs[advocateIdx]!))
      }
      return makeChild(JSON.stringify({ winnerIdx: 2, rationale: "Query builder offers the best balance." }))
    })

    const orchestrator = createJudgeOrchestrator()
    const options: JudgeOptions = {
      conversation: CONVERSATION,
      positions,
    }

    const result = await orchestrator.run("session-1", options)
    expect(result.winnerIdx).toBe(2)
    expect(result.rationale).toContain("best balance")
  })

  it("clamps winnerIdx to valid range", async () => {
    const positions = ["Position A", "Position B"]

    const advocateA = { position: positions[0]!, argument: "Arg A", score: 7 }
    const advocateB = { position: positions[1]!, argument: "Arg B", score: 8 }

    let callCount = 0
    mockSpawn.mockImplementation(() => {
      const idx = callCount++
      if (idx === 0) return makeChild(JSON.stringify(advocateA))
      if (idx === 1) return makeChild(JSON.stringify(advocateB))
      return makeChild(JSON.stringify({ winnerIdx: 99, rationale: "Out of bounds winner." }))
    })

    const orchestrator = createJudgeOrchestrator()
    const options: JudgeOptions = {
      conversation: CONVERSATION,
      positions,
    }

    const result = await orchestrator.run("session-1", options)
    expect(result.winnerIdx).toBe(1)
    expect(result.rationale).toBe("Out of bounds winner.")
  })

  it("falls back to highest self-score when judge extraction fails", async () => {
    const positions = ["Position A", "Position B", "Position C"]

    const advocates = [
      { position: positions[0]!, argument: "Arg A", score: 5 },
      { position: positions[1]!, argument: "Arg B", score: 9 },
      { position: positions[2]!, argument: "Arg C", score: 3 },
    ]

    const makeFailingChild = (): SpawnedChild => ({
      stdout: { on: vi.fn() },
      stderr: {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === "data") cb(Buffer.from("judge service unavailable"))
        }),
      },
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn((event: string, cb: (code: number) => void) => {
        if (event === "close") cb(1)
      }),
      kill: vi.fn(),
    })

    let callCount = 0
    mockSpawn.mockImplementation(() => {
      const idx = callCount++
      if (idx < 3) return makeChild(JSON.stringify(advocates[idx]!))
      return makeFailingChild()
    })

    const orchestrator = createJudgeOrchestrator()
    const options: JudgeOptions = {
      conversation: CONVERSATION,
      positions,
    }

    const result = await orchestrator.run("session-1", options)
    expect(result.winnerIdx).toBe(1)
    expect(result.rationale).toContain("highest self-score")
  })

  it("extracts positions from conversation when none provided", async () => {
    const extractedPositions = ["Use microservices", "Use a monolith"]
    const advocateOutputs = extractedPositions.map((position, i) => ({
      position,
      argument: `Argument ${i}`,
      score: 7,
    }))

    let callCount = 0
    mockSpawn.mockImplementation(() => {
      const idx = callCount++
      if (idx === 0) return makeChild(JSON.stringify(extractedPositions))
      const advocateIdx = idx - 1
      if (advocateIdx < 2) return makeChild(JSON.stringify(advocateOutputs[advocateIdx]!))
      return makeChild(JSON.stringify({ winnerIdx: 0, rationale: "Microservices scale better." }))
    })

    const orchestrator = createJudgeOrchestrator()
    const options: JudgeOptions = {
      conversation: CONVERSATION,
    }

    const result = await orchestrator.run("session-1", options)
    expect(result.winnerIdx).toBe(0)
    expect(result.rationale).toContain("scale better")
  })
})
