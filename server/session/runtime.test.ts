import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { getEventBus, resetEventBus } from '../events/bus'
import { SessionRuntime, type SubprocessHandle, type SpawnFn, type StartOpts } from './runtime'
import { runMigrations } from '../db/sqlite'
import type { EngineEvent } from '../events/types'
import type { TranscriptEvent } from '../../shared/api-types'
import type { AgentProvider, SpawnArgsOpts } from './providers/types'

// ---------------------------------------------------------------------------
// In-memory DB helpers
// ---------------------------------------------------------------------------

let db: Database

function setupTestDb(): Database {
  const testDb = new Database(':memory:')
  const schemaPath = new URL('../db/schema.sql', import.meta.url).pathname
  const schema = readFileSync(schemaPath, 'utf8')
  testDb.exec(schema)
  runMigrations(testDb)
  const now = Date.now()
  testDb.run(
    `INSERT INTO sessions (id, slug, status, command, mode, repo, branch, pr_url, parent_id, variant_group_id, claude_session_id, workspace_root, created_at, updated_at, needs_attention, attention_reasons, quick_actions, conversation, quota_sleep_until, quota_retry_count, metadata, pipeline_advancing)
     VALUES ('sess-1', 'test-slug', 'running', 'test', 'task', null, null, null, null, null, null, null, ${now}, ${now}, 0, '[]', '[]', '[]', null, 0, '{}', 0)`,
  )
  return testDb
}

// ---------------------------------------------------------------------------
// Fake SubprocessHandle
// ---------------------------------------------------------------------------

interface FakeProc extends SubprocessHandle {
  stdin: { written: string[]; write(d: string): Promise<void>; flush(): void }
}

function makeFakeProc(ndjsonLines: string[], stderrText = '', exitCode = 0): FakeProc {
  const written: string[] = []
  let resolveExit!: (code: number) => void
  const exitedPromise = new Promise<number>((r) => { resolveExit = r })

  let stdoutCtrl!: ReadableStreamDefaultController<Uint8Array>
  let stderrCtrl!: ReadableStreamDefaultController<Uint8Array>

  const sub: FakeProc = {
    pid: 12345,
    killed: false,
    stdin: {
      written,
      async write(d: string) { written.push(d) },
      flush() {},
    },
    stdout: new ReadableStream<Uint8Array>({ start(c) { stdoutCtrl = c } }),
    stderr: new ReadableStream<Uint8Array>({ start(c) { stderrCtrl = c } }),
    exited: exitedPromise,
    kill() {
      this.killed = true
      stderrCtrl.close()
      stdoutCtrl.close()
      resolveExit(exitCode)
    },
  }

  void (async () => {
    await new Promise<void>((r) => setTimeout(r, 5))
    const enc = new TextEncoder()
    for (const line of ndjsonLines) {
      stdoutCtrl.enqueue(enc.encode(line + '\n'))
      await new Promise<void>((r) => setTimeout(r, 1))
    }
    stderrCtrl.enqueue(enc.encode(stderrText))
    stderrCtrl.close()
    stdoutCtrl.close()
    resolveExit(exitCode)
  })()

  return sub
}

// ---------------------------------------------------------------------------
// Captured spawn state
// ---------------------------------------------------------------------------

let capturedArgs: string[] = []
let capturedCwd = ''
let currentProc: FakeProc

function makeSpawnFn(proc: FakeProc): SpawnFn {
  return (argv, opts) => {
    capturedArgs = argv
    capturedCwd = opts.cwd
    return proc
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESS_ID = 'sess-1'

function makeOpts(
  proc: FakeProc,
  overrides: Partial<Omit<StartOpts, 'spawnFn' | 'getDb'>> = {},
): StartOpts {
  return {
    sessionId: SESS_ID,
    mode: 'task',
    cwd: '/tmp/test-cwd',
    initialPrompt: 'do the thing',
    inactivityTimeoutMs: 60_000,
    sessionTimeoutMs: 120_000,
    spawnFn: makeSpawnFn(proc),
    getDb: () => db,
    ...overrides,
  }
}

beforeEach(() => {
  capturedArgs = []
  capturedCwd = ''
  db = setupTestDb()
  resetEventBus()
})

afterEach(() => {
  db.close()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionRuntime', () => {
  describe('spawn and initial prompt', () => {
    test('initial prompt is written to stdin on start', async () => {
      currentProc = makeFakeProc([])
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()
      expect(currentProc.stdin.written.length).toBeGreaterThan(0)
      const firstWrite = currentProc.stdin.written[0] ?? ''
      const parsed = JSON.parse(firstWrite.trim()) as { type: string; message: { content: string } }
      expect(parsed.type).toBe('user')
      expect(parsed.message.content).toBe('do the thing')
    })

    test('argv includes core flags', async () => {
      currentProc = makeFakeProc([])
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()
      expect(capturedArgs).toContain('--print')
      expect(capturedArgs).toContain('--output-format')
      expect(capturedArgs).toContain('stream-json')
      expect(capturedArgs).toContain('--input-format')
      expect(capturedArgs).toContain('--dangerously-skip-permissions')
      expect(capturedArgs).toContain('--append-system-prompt')
      expect(capturedArgs).toContain('--model')
    })

    test('argv does NOT contain --no-session-persistence', async () => {
      currentProc = makeFakeProc([])
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()
      expect(capturedArgs).not.toContain('--no-session-persistence')
    })

    test('spawns with the provided cwd', async () => {
      currentProc = makeFakeProc([])
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()
      expect(capturedCwd).toBe('/tmp/test-cwd')
    })
  })

  describe('stdout parsing → DB + bus', () => {
    test('parsed text_delta events are emitted on session.stream bus', async () => {
      const lines = [
        JSON.stringify({ type: 'system', session_id: 'claude-abc' }),
        JSON.stringify({
          type: 'stream_event',
          session_id: 'claude-abc',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello!' } },
        }),
        JSON.stringify({
          type: 'result',
          session_id: 'claude-abc',
          total_cost_usd: 0.01,
          num_turns: 1,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ]
      const bus = getEventBus()
      const streamEvents: TranscriptEvent[] = []
      bus.onKind('session.stream', (e) => { streamEvents.push(e.event) })

      currentProc = makeFakeProc(lines)
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()

      expect(streamEvents.some((e) => e.type === 'assistant_text')).toBe(true)
    })

    test('parsed events land in session_events table', async () => {
      const lines = [
        JSON.stringify({ type: 'system', session_id: 'claude-abc' }),
        JSON.stringify({
          type: 'stream_event',
          session_id: 'claude-abc',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        }),
        JSON.stringify({
          type: 'result',
          session_id: 'claude-abc',
          usage: { input_tokens: 5, output_tokens: 5 },
        }),
      ]

      currentProc = makeFakeProc(lines)
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()

      const rows = db
        .query<{ type: string; seq: number }, [string]>(
          'SELECT type, seq FROM session_events WHERE session_id = ? ORDER BY seq',
        )
        .all(SESS_ID)

      const types = rows.map((r) => r.type)
      expect(types).toContain('assistant_text')
    })
  })

  describe('injectInput', () => {
    test('returns false when runtime has no proc (not started)', async () => {
      const rt = new SessionRuntime({
        sessionId: SESS_ID,
        mode: 'task',
        cwd: '/tmp',
        initialPrompt: 'hi',
        spawnFn: makeSpawnFn(makeFakeProc([])),
        getDb: () => db,
      })
      expect(await rt.injectInput('hello')).toBe(false)
    })

    test('returns false after process exits (state=done)', async () => {
      currentProc = makeFakeProc([])
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()
      expect(await rt.injectInput('more')).toBe(false)
    })
  })

  describe('session.completed guarantee (try/finally)', () => {
    test('emits session.completed on clean exit (code 0)', async () => {
      const bus = getEventBus()
      const completed: Array<Extract<EngineEvent, { kind: 'session.completed' }>> = []
      bus.onKind('session.completed', (e) => { completed.push(e) })

      currentProc = makeFakeProc([], '', 0)
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()

      expect(completed).toHaveLength(1)
      expect(completed[0]?.state).toBe('completed')
    })

    test('emits session.completed even when stdout contains unparseable lines', async () => {
      const lines = [
        'this is not valid json {{{{',
        JSON.stringify({ type: 'system', session_id: 'x' }),
      ]
      const bus = getEventBus()
      const completed: Array<Extract<EngineEvent, { kind: 'session.completed' }>> = []
      bus.onKind('session.completed', (e) => { completed.push(e) })

      currentProc = makeFakeProc(lines, '', 0)
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()

      expect(completed).toHaveLength(1)
    })

    test('emits session.completed with state=errored on non-zero exit', async () => {
      const bus = getEventBus()
      const completed: Array<Extract<EngineEvent, { kind: 'session.completed' }>> = []
      bus.onKind('session.completed', (e) => { completed.push(e) })

      currentProc = makeFakeProc([], '', 1)
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()

      expect(completed).toHaveLength(1)
      expect(completed[0]?.state).toBe('errored')
    })
  })

  describe('quota detection', () => {
    test('stderr quota pattern → session.completed{state:quota_exhausted}', async () => {
      const bus = getEventBus()
      const completed: Array<Extract<EngineEvent, { kind: 'session.completed' }>> = []
      bus.onKind('session.completed', (e) => { completed.push(e) })

      currentProc = makeFakeProc([], 'You have exceeded your usage limit.', 1)
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()

      expect(completed).toHaveLength(1)
      expect(completed[0]?.state).toBe('quota_exhausted')
    })

    test('stderr without quota pattern + non-zero exit → errored', async () => {
      const bus = getEventBus()
      const completed: Array<Extract<EngineEvent, { kind: 'session.completed' }>> = []
      bus.onKind('session.completed', (e) => { completed.push(e) })

      currentProc = makeFakeProc([], 'some unrelated error', 1)
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()

      expect(completed).toHaveLength(1)
      expect(completed[0]?.state).toBe('errored')
    })
  })

  describe('resume path', () => {
    test('argv includes --resume <id> when resumeSessionId is set', async () => {
      currentProc = makeFakeProc([])
      const rt = new SessionRuntime(
        makeOpts(currentProc, { resumeSessionId: 'resume-session-xyz' }),
      )
      await rt.start()

      const resumeIdx = capturedArgs.indexOf('--resume')
      expect(resumeIdx).toBeGreaterThan(-1)
      expect(capturedArgs[resumeIdx + 1]).toBe('resume-session-xyz')
    })

    test('argv does NOT include --resume when resumeSessionId is absent', async () => {
      currentProc = makeFakeProc([])
      const rt = new SessionRuntime(makeOpts(currentProc))
      await rt.start()
      expect(capturedArgs).not.toContain('--resume')
    })

    test('turn trigger is "resume" when resumeSessionId is set', async () => {
      const bus = getEventBus()
      const streamEvents: TranscriptEvent[] = []
      bus.onKind('session.stream', (e) => { streamEvents.push(e.event) })

      currentProc = makeFakeProc([])
      const rt = new SessionRuntime(
        makeOpts(currentProc, { resumeSessionId: 'old-session-id' }),
      )
      await rt.start()

      const turnStarted = streamEvents.find((e) => e.type === 'turn_started')
      expect(turnStarted).toBeDefined()
      if (turnStarted?.type === 'turn_started') {
        expect(turnStarted.trigger).toBe('resume')
      }
    })
  })

  describe('stream_stalled path', () => {
    test('inactivity timer fires → session.stalled event + session.completed{stream_stalled}', async () => {
      const bus = getEventBus()
      const stalled: Array<Extract<EngineEvent, { kind: 'session.stalled' }>> = []
      bus.onKind('session.stalled', (e) => { stalled.push(e) })
      const completed: Array<Extract<EngineEvent, { kind: 'session.completed' }>> = []
      bus.onKind('session.completed', (e) => { completed.push(e) })

      let stdoutCtrl!: ReadableStreamDefaultController<Uint8Array>
      let stderrCtrl!: ReadableStreamDefaultController<Uint8Array>
      let resolveExit!: (code: number) => void
      const exitedPromise = new Promise<number>((r) => { resolveExit = r })

      const stallProc: SubprocessHandle = {
        pid: 9999,
        killed: false,
        stdin: {
          async write(d: string) { void d },
          flush() {},
        },
        stdout: new ReadableStream<Uint8Array>({ start(c) { stdoutCtrl = c } }),
        stderr: new ReadableStream<Uint8Array>({ start(c) { stderrCtrl = c } }),
        exited: exitedPromise,
        kill() {
          this.killed = true
          stderrCtrl.close()
          stdoutCtrl.close()
          resolveExit(0)
        },
      }

      const rt = new SessionRuntime({
        sessionId: SESS_ID,
        mode: 'task',
        cwd: '/tmp/test-cwd',
        initialPrompt: 'hi',
        inactivityTimeoutMs: 50,
        sessionTimeoutMs: 120_000,
        spawnFn: () => stallProc,
        getDb: () => db,
      })

      await rt.start()

      expect(stalled.length).toBeGreaterThanOrEqual(1)
      expect(completed).toHaveLength(1)
      expect(completed[0]?.state).toBe('stream_stalled')
    }, 5000)
  })

  describe('error event recovery', () => {
    test('result{is_error:true} closes the open turn and stops the subprocess', async () => {
      const bus = getEventBus()
      const streamEvents: TranscriptEvent[] = []
      bus.onKind('session.stream', (e) => { streamEvents.push(e.event) })
      const completed: Array<Extract<EngineEvent, { kind: 'session.completed' }>> = []
      bus.onKind('session.completed', (e) => { completed.push(e) })

      let stdoutCtrl!: ReadableStreamDefaultController<Uint8Array>
      let stderrCtrl!: ReadableStreamDefaultController<Uint8Array>
      let resolveExit!: (code: number) => void
      const exitedPromise = new Promise<number>((r) => { resolveExit = r })

      const errorProc: SubprocessHandle = {
        pid: 777,
        killed: false,
        stdin: {
          async write(d: string) { void d },
          flush() {},
        },
        stdout: new ReadableStream<Uint8Array>({ start(c) { stdoutCtrl = c } }),
        stderr: new ReadableStream<Uint8Array>({ start(c) { stderrCtrl = c } }),
        exited: exitedPromise,
        kill() {
          this.killed = true
          stderrCtrl.close()
          stdoutCtrl.close()
          resolveExit(1)
        },
      }

      const errorLine = JSON.stringify({
        type: 'result',
        is_error: true,
        result: 'API Error: Stream idle timeout - partial response received',
      }) + '\n'

      void (async () => {
        await new Promise<void>((r) => setTimeout(r, 5))
        stdoutCtrl.enqueue(new TextEncoder().encode(errorLine))
      })()

      const rt = new SessionRuntime({
        sessionId: SESS_ID,
        mode: 'task',
        cwd: '/tmp/test-cwd',
        initialPrompt: 'hi',
        inactivityTimeoutMs: 60_000,
        sessionTimeoutMs: 120_000,
        spawnFn: () => errorProc,
        getDb: () => db,
      })

      await rt.start()

      const errorStatus = streamEvents.find(
        (e) => e.type === 'status' && e.kind === 'session_error',
      )
      expect(errorStatus).toBeDefined()

      const errorTurnClose = streamEvents.find(
        (e) => e.type === 'turn_completed' && (e as { errored?: boolean }).errored === true,
      )
      expect(errorTurnClose).toBeDefined()

      expect(errorProc.killed).toBe(true)
      expect(completed).toHaveLength(1)
    })
  })

  describe('ship coordinator inactivity timeout', () => {
    test('uses 24h inactivity timeout for ship mode by default', async () => {
      currentProc = makeFakeProc([
        JSON.stringify({ type: 'session_id', value: 'claude-123' }),
        JSON.stringify({
          type: 'turn_complete',
          totalTokens: 100,
          totalCostUsd: 0.01,
        }),
      ])

      const rt = new SessionRuntime({
        sessionId: SESS_ID,
        mode: 'ship',
        cwd: '/tmp/ship-cwd',
        initialPrompt: 'ship the feature',
        spawnFn: makeSpawnFn(currentProc),
        getDb: () => db,
      })

      await rt.start()

      expect(currentProc.killed).toBe(false)
    })

    test('respects explicit inactivityTimeoutMs override for ship mode', async () => {
      currentProc = makeFakeProc([
        JSON.stringify({ type: 'session_id', value: 'claude-123' }),
        JSON.stringify({
          type: 'turn_complete',
          totalTokens: 100,
          totalCostUsd: 0.01,
        }),
      ])

      const rt = new SessionRuntime({
        sessionId: SESS_ID,
        mode: 'ship',
        cwd: '/tmp/ship-cwd',
        initialPrompt: 'ship the feature',
        inactivityTimeoutMs: 1000,
        spawnFn: makeSpawnFn(currentProc),
        getDb: () => db,
      })

      await rt.start()

      expect(currentProc.killed).toBe(false)
    })
  })

  describe('custom provider injection', () => {
    test('runtime delegates spawn args, serialization, and parsing to injected provider', async () => {
      const calls: string[] = []

      const fakeProvider: AgentProvider = {
        name: 'claude',
        buildSpawnArgs(opts: SpawnArgsOpts) {
          calls.push('buildSpawnArgs')
          return {
            argv: ['claude', '--print', '--output-format', 'stream-json', '--input-format', 'stream-json',
              '--verbose', '--include-partial-messages', '--dangerously-skip-permissions',
              '--append-system-prompt', opts.modeConfig.systemPrompt, '--model', opts.modeConfig.model],
            env: {},
          }
        },
        serializeInitialInput(prompt: string) {
          calls.push('serializeInitialInput')
          return JSON.stringify({ type: 'user', session_id: '', message: { role: 'user', content: prompt }, parent_tool_use_id: null })
        },
        serializeUserReply(prompt: string) {
          calls.push('serializeUserReply')
          return JSON.stringify({ type: 'user', session_id: '', message: { role: 'user', content: prompt }, parent_tool_use_id: null })
        },
        parseLine(line: string) {
          calls.push('parseLine')
          try {
            const raw = JSON.parse(line) as { type?: string; is_error?: boolean }
            if (raw.type === 'result' && !raw.is_error) {
              return { events: [{ kind: 'turn_complete', totalTokens: null, totalCostUsd: null, numTurns: null }] }
            }
          } catch { /* ignore */ }
          return { events: [] }
        },
        resumeArgs: () => [],
        isQuotaError: () => false,
      }

      currentProc = makeFakeProc([JSON.stringify({ type: 'result' })])
      const rt = new SessionRuntime({
        ...makeOpts(currentProc),
        provider: fakeProvider,
      })
      await rt.start()

      expect(calls).toContain('buildSpawnArgs')
      expect(calls).toContain('serializeInitialInput')
      expect(calls).toContain('parseLine')
    })
  })
})
