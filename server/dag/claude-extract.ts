import { spawn } from "node:child_process"
import type { TopicMessage } from "./types"
import type { ProviderProfile } from "./types"
import type { Logger } from "./logger"

export const MAX_ASSISTANT_CHARS = 4000

export interface SpawnedChild {
  stdout: { on(event: "data", cb: (data: Buffer) => void): unknown }
  stderr: { on(event: "data", cb: (data: Buffer) => void): unknown }
  stdin: { write(data: string): unknown; end(): unknown }
  on(event: "error" | "close", cb: (payload: unknown) => void): unknown
  kill(signal?: string | number): unknown
}

export interface ExtractionOptions {
  timeoutMs?: number
  profile?: ProviderProfile
  envOverrides?: Record<string, string>
  log: Logger
}

export function runClaudeExtraction(
  task: string,
  systemPrompt: string,
  options: ExtractionOptions,
): Promise<string> {
  const { timeoutMs = 120_000, profile, envOverrides, log } = options

  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--output-format", "text",
      "--model", "haiku",
      "--no-session-persistence",
      "--append-system-prompt", systemPrompt,
    ]

    const child: SpawnedChild = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(profile?.baseUrl && { ANTHROPIC_BASE_URL: profile.baseUrl }),
        ...(profile?.authToken && { ANTHROPIC_AUTH_TOKEN: profile.authToken }),
        ...(profile?.haikuModel && { ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.haikuModel }),
        ...envOverrides,
      },
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.on("error", (err) => {
      clearTimeout(timeout)
      reject(err instanceof Error ? err : new Error(String(err)))
    })

    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        const err = new Error(`claude CLI exited with code ${String(code)}: ${stderr.trim()}`)
        ;(err as NodeJS.ErrnoException).code = typeof code === "number" ? code.toString() : undefined
        reject(err)
      }
    })

    child.stdin.write(task)
    child.stdin.end()

    log.debug("spawned claude CLI")
  })
}

const MAX_RETRIES = 3
const INITIAL_DELAY_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ParseError"
  }
}

function isRetryableSpawnError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return (
    code === "ETIMEDOUT" ||
    code === "ENOENT" ||
    code === "EAGAIN" ||
    (err instanceof Error && err.message.includes("spawn"))
  )
}

function isRetryableError(err: unknown): boolean {
  return isRetryableSpawnError(err) || err instanceof ParseError
}

export interface RetryResult<T> {
  data?: T
  error?: "system" | "parse"
  errorMessage?: string
}

export async function retryClaudeExtraction<T>(
  task: string,
  systemPrompt: string,
  parser: (output: string) => T,
  options: ExtractionOptions,
): Promise<RetryResult<T>> {
  const { log } = options
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.debug({ attempt, maxRetries: MAX_RETRIES }, "attempt")
      const output = await runClaudeExtraction(task, systemPrompt, options)
      log.debug({ outputLength: output.length }, "raw output")

      const data = parser(output)
      return { data }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      if (isRetryableError(err) && attempt < MAX_RETRIES) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1)
        log.warn({ attempt, delay, err }, "retryable error, retrying")
        await sleep(delay)
      } else {
        const errorType = err instanceof ParseError ? "parse" as const : "system" as const
        log.error({ err, errorType }, "extraction failed")
        return { error: errorType, errorMessage: lastError.message }
      }
    }
  }

  return { error: "system", errorMessage: lastError?.message ?? "Unknown error" }
}

export function buildConversationText(
  conversation: TopicMessage[],
  directive?: string,
  maxAssistantChars: number = MAX_ASSISTANT_CHARS,
): string {
  const lines: string[] = ["## Conversation\n"]

  for (const msg of conversation) {
    const label = msg.role === "user" ? "**User**" : "**Agent**"
    lines.push(`${label}:`)
    if (msg.role === "assistant" && msg.text.length > maxAssistantChars) {
      lines.push(`[earlier output truncated]\n…${msg.text.slice(-maxAssistantChars)}`)
    } else {
      lines.push(msg.text)
    }
    lines.push("")
  }

  if (directive) {
    lines.push(`## Directive\n\n${directive}`)
  }

  return lines.join("\n")
}
