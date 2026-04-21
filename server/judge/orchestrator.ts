import type { TopicMessage } from "../dag/types"
import { retryClaudeExtraction, ParseError } from "../dag/claude-extract"
import type { ExtractionOptions } from "../dag/claude-extract"
import { buildExtractorPrompt, buildAdvocatePrompt, buildJudgePrompt } from "./prompts"
import { loggers } from "../dag/logger"

const log = loggers.dagExtract

export interface JudgeOptions {
  conversation: TopicMessage[]
  positions?: string[]
}

export interface JudgeResult {
  winnerIdx: number
  rationale: string
}

export interface JudgeOrchestrator {
  run(sessionId: string, options: JudgeOptions, timeoutMs?: number): Promise<JudgeResult>
}

const DEFAULT_TIMEOUT_MS = 120_000

function parsePositions(output: string): string[] {
  let text = output.trim()
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) text = fenceMatch[1]!.trim()
  const arrayMatch = text.match(/\[[\s\S]*\]/)
  if (!arrayMatch) throw new ParseError("no JSON array found in positions output")
  let parsed: unknown
  try {
    parsed = JSON.parse(arrayMatch[0]!)
  } catch (e) {
    throw new ParseError(`JSON parse error in positions output: ${String(e)}`)
  }
  if (!Array.isArray(parsed)) throw new ParseError("positions output is not an array")
  return parsed.filter((p): p is string => typeof p === "string" && p.length > 0)
}

function parseAdvocateOutput(output: string): { position: string; argument: string; score: number } {
  let text = output.trim()
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) text = fenceMatch[1]!.trim()
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (!objMatch) throw new ParseError("no JSON object found in advocate output")
  let parsed: unknown
  try {
    parsed = JSON.parse(objMatch[0]!)
  } catch (e) {
    throw new ParseError(`JSON parse error in advocate output: ${String(e)}`)
  }
  if (typeof parsed !== "object" || parsed === null) throw new ParseError("advocate output is not an object")
  const obj = parsed as Record<string, unknown>
  const position = typeof obj.position === "string" ? obj.position : ""
  const argument = typeof obj.argument === "string" ? obj.argument : ""
  const score = typeof obj.score === "number" ? obj.score : 5
  return { position, argument, score }
}

function parseJudgeOutput(output: string): JudgeResult {
  let text = output.trim()
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) text = fenceMatch[1]!.trim()
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (!objMatch) throw new ParseError("no JSON object found in judge output")
  let parsed: unknown
  try {
    parsed = JSON.parse(objMatch[0]!)
  } catch (e) {
    throw new ParseError(`JSON parse error in judge output: ${String(e)}`)
  }
  if (typeof parsed !== "object" || parsed === null) throw new ParseError("judge output is not an object")
  const obj = parsed as Record<string, unknown>
  if (typeof obj.winnerIdx !== "number") throw new ParseError("judge output missing winnerIdx")
  if (typeof obj.rationale !== "string") throw new ParseError("judge output missing rationale")
  return { winnerIdx: obj.winnerIdx, rationale: obj.rationale }
}

export function createJudgeOrchestrator(): JudgeOrchestrator {
  async function run(
    _sessionId: string,
    options: JudgeOptions,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<JudgeResult> {
    const { conversation } = options
    const extractionOpts: ExtractionOptions = { timeoutMs, log }

    let positions = options.positions ?? []

    if (positions.length === 0) {
      const extractResult = await retryClaudeExtraction(
        buildExtractorPrompt(conversation),
        "Extract positions from the conversation as a JSON array of strings. No surrounding text.",
        parsePositions,
        extractionOpts,
      )
      positions = extractResult.data ?? []
    }

    if (positions.length < 2) {
      return { winnerIdx: 0, rationale: "Only one position available; no comparison possible." }
    }

    const advocateResults = await Promise.all(
      positions.map((position) =>
        retryClaudeExtraction(
          buildAdvocatePrompt(position, conversation),
          "You are an advocate. Respond with a JSON object as instructed.",
          parseAdvocateOutput,
          extractionOpts,
        ),
      ),
    )

    const validAdvocates = advocateResults
      .map((r, i) =>
        r.data
          ? r.data
          : { position: positions[i] ?? `Position ${i}`, argument: "(extraction failed)", score: 0 },
      )

    const judgeTask = buildJudgePrompt(validAdvocates, conversation)
    const judgeResult = await retryClaudeExtraction(
      judgeTask,
      "You are a judge. Respond with a JSON object as instructed.",
      parseJudgeOutput,
      extractionOpts,
    )

    if (!judgeResult.data) {
      const bestIdx = validAdvocates.reduce(
        (best, a, i) => (a.score > (validAdvocates[best]?.score ?? 0) ? i : best),
        0,
      )
      return {
        winnerIdx: bestIdx,
        rationale: `Judge extraction failed (${judgeResult.errorMessage ?? "unknown error"}); fell back to highest self-score.`,
      }
    }

    const result = judgeResult.data
    const clampedIdx = Math.max(0, Math.min(result.winnerIdx, positions.length - 1))
    return { winnerIdx: clampedIdx, rationale: result.rationale }
  }

  return { run }
}
