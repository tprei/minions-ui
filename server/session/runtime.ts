import os from 'node:os'
import path from 'node:path'
import type { CreateSessionMode, TranscriptEvent } from '../../shared/api-types'
import { getEventBus } from '../events/bus'
import { getDb as defaultGetDb, prepared } from '../db/sqlite'
import type { Database } from 'bun:sqlite'
import { TranscriptTranslator } from './transcript'
import { parseClaudeLine, translateLine, serializeUserMessage } from './stream-json'
import { MODE_CONFIGS, type AllSessionMode } from './prompts'
import { buildIsolatedEnv } from './env'
import { isQuotaError } from './quota-detection'

export interface SubprocessHandle {
  pid: number
  killed: boolean
  stdin: { write(data: string): Promise<number | void>; flush(): void }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill(signal?: NodeJS.Signals | string): void
}

export type SpawnFn = (argv: string[], opts: {
  cwd: string
  env: NodeJS.ProcessEnv
  stdin: 'pipe'
  stdout: 'pipe'
  stderr: 'pipe'
}) => SubprocessHandle

function defaultSpawn(argv: string[], opts: {
  cwd: string
  env: NodeJS.ProcessEnv
  stdin: 'pipe'
  stdout: 'pipe'
  stderr: 'pipe'
}): SubprocessHandle {
  return Bun.spawn(argv, opts) as SubprocessHandle
}

export interface StartOpts {
  sessionId: string
  mode: CreateSessionMode | AllSessionMode
  cwd: string
  initialPrompt: string
  initialImages?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string }>
  resumeClaudeSessionId?: string
  mcpConfig?: { mcpServers: Record<string, unknown> }
  sessionTimeoutMs?: number
  inactivityTimeoutMs?: number
  spawnFn?: SpawnFn
  getDb?: () => Database
}

type RuntimeState = 'starting' | 'working' | 'idle' | 'stopping' | 'done'

export class SessionRuntime {
  private proc: SubprocessHandle | null = null
  private translator: TranscriptTranslator
  private claudeSessionId: string | undefined
  private readonly bus = getEventBus()
  private state: RuntimeState = 'starting'
  private readonly startedAt = Date.now()
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null
  private hardTimer: ReturnType<typeof setTimeout> | null = null
  private retriedForStall = false
  private stoppedForStall = false
  private stderrChunks: string[] = []
  private totalTokens: number | undefined
  private totalCostUsd: number | undefined
  private readonly spawnFn: SpawnFn
  private readonly getDb: () => Database

  constructor(private readonly opts: StartOpts) {
    this.getDb = opts.getDb ?? defaultGetDb
    const db = this.getDb()
    const startingSeq = prepared.nextSeq(db, opts.sessionId)
    this.translator = new TranscriptTranslator({ sessionId: opts.sessionId, startingSeq })
    this.spawnFn = opts.spawnFn ?? defaultSpawn
  }

  get running(): boolean {
    return this.proc !== null && !this.proc.killed
  }

  get currentClaudeSessionId(): string | undefined {
    return this.claudeSessionId
  }

  async start(): Promise<void> {
    const { sessionId, mode, cwd, initialPrompt, resumeClaudeSessionId, mcpConfig } = this.opts
    const cfg = MODE_CONFIGS[mode as AllSessionMode]

    this.bus.emit({ kind: 'session.spawning', sessionId, mode, cwd })

    const args: string[] = [
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      ...(cfg.disallowedTools.length ? ['--disallowed-tools', ...cfg.disallowedTools] : []),
      ...(mcpConfig && Object.keys(mcpConfig.mcpServers).length
        ? ['--mcp-config', JSON.stringify(mcpConfig)]
        : []),
      '--append-system-prompt', cfg.systemPrompt,
      '--model', cfg.model,
      ...(resumeClaudeSessionId ? ['--resume', resumeClaudeSessionId] : []),
    ]

    const parentHome = process.env['HOME'] ?? os.homedir()
    const workspaceHome = path.join(cwd, '.home')
    const env = buildIsolatedEnv({ workspaceHome, parentHome })

    this.proc = this.spawnFn(['claude', ...args], {
      cwd,
      env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    this.bus.emit({ kind: 'session.started', sessionId, pid: this.proc.pid })

    this.startTimers()

    const turnStartedEvt = this.translator.startTurn(resumeClaudeSessionId ? 'resume' : 'user_message')
    if (turnStartedEvt) {
      this.persistAndEmit(turnStartedEvt)
    }

    const userMsgEvt = this.translator.userMessage(initialPrompt, this.opts.initialImages?.map((img) => img.dataBase64))
    this.persistAndEmit(userMsgEvt)

    const initialLine = serializeUserMessage(initialPrompt, this.opts.initialImages)
    await this.proc.stdin.write(initialLine + '\n')
    this.proc.stdin.flush()

    this.pipeStderr()

    try {
      await this.readStdout()
    } finally {
      await this.onClose()
    }
  }

  async injectInput(
    text: string,
    images?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; dataBase64: string }>,
  ): Promise<boolean> {
    if (!this.proc || !this.proc.stdin) return false
    if (this.state === 'done' || this.state === 'stopping') return false

    if (this.state === 'idle') {
      const turnEvt = this.translator.startTurn('reply_injected')
      if (turnEvt) {
        this.persistAndEmit(turnEvt)
      }
      this.state = 'working'
    }

    const userMsgEvt = this.translator.userMessage(text, images?.map((img) => img.dataBase64))
    this.persistAndEmit(userMsgEvt)

    const line = serializeUserMessage(text, images)
    await this.proc.stdin.write(line + '\n')
    this.proc.stdin.flush()

    this.bus.emit({
      kind: 'session.reply_injected',
      sessionId: this.opts.sessionId,
      chars: text.length,
      imageCount: images?.length ?? 0,
    })

    this.resetInactivityTimer()

    return true
  }

  async stop(reason?: string): Promise<void> {
    if (this.state === 'done' || this.state === 'stopping') return
    if (reason === 'stream_stalled') this.stoppedForStall = true
    this.state = 'stopping'
    this.clearTimers()

    if (!this.proc) return

    this.proc.kill('SIGINT')

    await Promise.race([
      this.proc.exited,
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ])

    if (!this.proc.killed) {
      this.proc.kill('SIGKILL')
    }
  }

  private async readStdout(): Promise<void> {
    if (!this.proc) return
    const reader = this.proc.stdout.getReader()

    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
      this.resetInactivityTimer()

      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '')
        buffer = buffer.slice(newlineIdx + 1)
        if (line.length > 0) {
          this.processLine(line)
        }
      }
    }

    if (buffer.trim().length > 0) {
      this.processLine(buffer.trim())
    }
  }

  private processLine(line: string): void {
    const raw = parseClaudeLine(line)
    if (!raw) return

    const { events, sessionId: nextSid } = translateLine(raw, this.claudeSessionId)
    if (nextSid && nextSid !== this.claudeSessionId) {
      this.claudeSessionId = nextSid
      const db = this.getDb()
      prepared.updateSession(db, {
        id: this.opts.sessionId,
        claude_session_id: nextSid,
        updated_at: Date.now(),
      })
    }

    const db = this.getDb()
    db.transaction(() => {
      for (const event of events) {
        const transcriptEvents = this.translator.handle(event)
        for (const te of transcriptEvents) {
          this.persistAndEmit(te)
        }

        if (event.kind === 'turn_complete') {
          if (event.totalTokens !== null) this.totalTokens = event.totalTokens
          if (event.totalCostUsd !== null) this.totalCostUsd = event.totalCostUsd

          if (this.state !== 'stopping' && this.state !== 'done') {
            this.state = 'idle'
            this.bus.emit({ kind: 'session.idle', sessionId: this.opts.sessionId })
          }

          const cfg = MODE_CONFIGS[this.opts.mode as AllSessionMode]
          if (cfg.autoExitOnComplete && this.state !== 'done') {
            void this.stop('auto_exit')
          }
        }

        if (event.kind === 'error') {
          if (this.state !== 'stopping' && this.state !== 'done') {
            this.state = 'idle'
          }
        }
      }
    })()
  }

  private pipeStderr(): void {
    if (!this.proc) return

    void (async () => {
      if (!this.proc) return
      const reader = this.proc.stderr.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = typeof value === 'string' ? value : Buffer.from(value).toString('utf8')
        this.stderrChunks.push(chunk)
        this.resetInactivityTimer()
      }
    })()
  }

  private async onClose(): Promise<void> {
    this.clearTimers()
    this.state = 'done'

    const closeEvt = this.translator.closeTurn(undefined, undefined, true)
    if (closeEvt) {
      this.persistAndEmit(closeEvt)
    }

    const exitCode = await this.proc?.exited ?? -1
    const stderrText = this.stderrChunks.join('')
    const durationMs = Date.now() - this.startedAt

    let runState: 'completed' | 'errored' | 'quota_exhausted' | 'stream_stalled'

    if (this.stoppedForStall) {
      runState = 'stream_stalled'
    } else if (exitCode === 0) {
      runState = 'completed'
    } else if (isQuotaError(stderrText)) {
      runState = 'quota_exhausted'
    } else {
      runState = 'errored'
    }

    const db = this.getDb()
    const dbStatus = runState === 'completed' ? 'completed' : 'failed'

    prepared.updateSession(db, {
      id: this.opts.sessionId,
      status: dbStatus,
      updated_at: Date.now(),
    })

    this.bus.emit({
      kind: 'session.completed',
      sessionId: this.opts.sessionId,
      state: runState,
      durationMs,
      ...(this.totalTokens !== undefined ? { totalTokens: this.totalTokens } : {}),
      ...(this.totalCostUsd !== undefined ? { totalCostUsd: this.totalCostUsd } : {}),
    })
  }

  private persistAndEmit(event: TranscriptEvent): void {
    const db = this.getDb()
    const payload: Record<string, unknown> = { ...event }
    prepared.insertEvent(db, {
      session_id: event.sessionId,
      seq: event.seq,
      turn: event.turn,
      type: event.type,
      timestamp: event.timestamp,
      payload,
    })
    this.bus.emit({ kind: 'session.stream', sessionId: this.opts.sessionId, event })
  }

  private startTimers(): void {
    const sessionTimeoutMs = this.opts.sessionTimeoutMs ?? 60 * 60 * 1000
    const inactivityTimeoutMs = this.opts.inactivityTimeoutMs ?? 15 * 60 * 1000

    this.hardTimer = setTimeout(() => {
      console.warn(`[runtime] hard session timeout for ${this.opts.sessionId}`)
      void this.stop('hard_timeout')
    }, sessionTimeoutMs)

    this.resetInactivityTimer(inactivityTimeoutMs)
  }

  private resetInactivityTimer(overrideMs?: number): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer)
    const inactivityTimeoutMs = overrideMs ?? this.opts.inactivityTimeoutMs ?? 15 * 60 * 1000

    this.inactivityTimer = setTimeout(() => {
      if (this.state === 'done' || this.state === 'stopping') return
      const sinceMs = Date.now() - this.startedAt

      if (!this.retriedForStall) {
        this.retriedForStall = true
        this.bus.emit({ kind: 'session.stalled', sessionId: this.opts.sessionId, sinceMs })
        void this.stop('stream_stalled')
      }
    }, inactivityTimeoutMs)
  }

  private clearTimers(): void {
    if (this.hardTimer) {
      clearTimeout(this.hardTimer)
      this.hardTimer = null
    }
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer)
      this.inactivityTimer = null
    }
  }
}
