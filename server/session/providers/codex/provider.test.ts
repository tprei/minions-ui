import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { makeCodexProvider } from './provider.js'
import type { SpawnArgsOpts, Image } from '../types.js'

const WORKSPACE = '/test/workspace'
const PARENT_HOME = '/test/home'

function makeOpts(overrides?: Partial<SpawnArgsOpts>): SpawnArgsOpts {
  return {
    sessionId: 'sess-1',
    mode: 'task',
    cwd: '/repo',
    workspaceHome: WORKSPACE,
    parentHome: PARENT_HOME,
    modeConfig: {
      systemPrompt: 'Be helpful',
      model: 'gpt-5.3-codex',
      disallowedTools: [],
      autoExitOnComplete: false,
    },
    ...overrides,
  }
}

const PNG_IMG: Image = {
  mediaType: 'image/png',
  dataBase64: 'iVBORw0KGgo=',
}

// ---------------------------------------------------------------------------
// buildSpawnArgs
// ---------------------------------------------------------------------------

describe('buildSpawnArgs', () => {
  let mkdirSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mkdirSpy = spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
  })

  afterEach(() => {
    mkdirSpy.mockRestore()
  })

  test('returns correct argv', () => {
    const provider = makeCodexProvider()
    const { argv } = provider.buildSpawnArgs(makeOpts())
    expect(argv).toEqual(['codex', 'app-server', '--listen', 'stdio://'])
  })

  test('sets CODEX_HOME to parentHome/.codex', () => {
    const provider = makeCodexProvider()
    const { env } = provider.buildSpawnArgs(makeOpts())
    expect(env['CODEX_HOME']).toBe(path.join(PARENT_HOME, '.codex'))
  })

  test('sets HOME to workspaceHome', () => {
    const provider = makeCodexProvider()
    const { env } = provider.buildSpawnArgs(makeOpts())
    expect(env['HOME']).toBe(WORKSPACE)
  })

  test('creates .codex subdir in workspace', () => {
    const provider = makeCodexProvider()
    provider.buildSpawnArgs(makeOpts())
    const dirs = (mkdirSpy.mock.calls as unknown[][]).map((args) => args[0] as string)
    expect(dirs.some((p) => p === path.join(WORKSPACE, '.codex'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// serializeInitialInput — fresh session
// ---------------------------------------------------------------------------

describe('serializeInitialInput — fresh session', () => {
  function splitFrames(raw: string): Array<{ method: string; jsonrpc: string; id: number; params: Record<string, unknown> }> {
    return raw.split('\n').map((line) => JSON.parse(line) as { method: string; jsonrpc: string; id: number; params: Record<string, unknown> })
  }

  test('emits initialize then thread/start joined by newline', () => {
    const provider = makeCodexProvider()
    const raw = provider.serializeInitialInput('do the thing', undefined, makeOpts())
    const frames = splitFrames(raw)
    expect(frames).toHaveLength(2)
    expect(frames[0]!.method).toBe('initialize')
    expect(frames[0]!.jsonrpc).toBe('2.0')
    expect(frames[1]!.method).toBe('thread/start')
    expect(frames[1]!.jsonrpc).toBe('2.0')
    expect(frames[0]!.id).toBeGreaterThan(0)
    expect(frames[1]!.id).toBeGreaterThan(frames[0]!.id)
  })

  test('initialize frame includes clientInfo with name and version', () => {
    const provider = makeCodexProvider()
    const raw = provider.serializeInitialInput('prompt', undefined, makeOpts())
    const initFrame = splitFrames(raw)[0]!
    const clientInfo = initFrame.params['clientInfo'] as { name: string; version: string } | undefined
    expect(clientInfo).toBeDefined()
    expect(clientInfo!.name.length).toBeGreaterThan(0)
    expect(clientInfo!.version.length).toBeGreaterThan(0)
  })

  test('thread/start params include model, cwd, and approvalPolicy', () => {
    const provider = makeCodexProvider()
    const raw = provider.serializeInitialInput('prompt', undefined, makeOpts())
    const params = splitFrames(raw)[1]!.params as { model: string; cwd: string; approvalPolicy: string }
    expect(params.model).toBe('gpt-5.3-codex')
    expect(params.cwd).toBe('/repo')
    expect(params.approvalPolicy).toBe('never')
  })

  test('defaults sandbox to danger-full-access when no env override and no mode hint', () => {
    delete process.env['CODEX_SANDBOX_MODE']
    const provider = makeCodexProvider()
    const raw = provider.serializeInitialInput('prompt', undefined, makeOpts())
    const params = splitFrames(raw)[1]!.params as { sandbox: string }
    expect(params.sandbox).toBe('danger-full-access')
  })

  test('forwards read-only sandbox when mode hint asks for it', () => {
    delete process.env['CODEX_SANDBOX_MODE']
    const provider = makeCodexProvider()
    const opts = makeOpts({
      modeConfig: { systemPrompt: '', model: 'gpt-5.3-codex', disallowedTools: [], autoExitOnComplete: false, sandbox: 'read-only' },
    })
    const raw = provider.serializeInitialInput('prompt', undefined, opts)
    const params = splitFrames(raw)[1]!.params as { sandbox: string }
    expect(params.sandbox).toBe('read-only')
  })

  test('mode sandbox hint takes precedence over CODEX_SANDBOX_MODE', () => {
    process.env['CODEX_SANDBOX_MODE'] = 'workspace-write'
    try {
      const provider = makeCodexProvider()
      const opts = makeOpts({
        modeConfig: { systemPrompt: '', model: 'gpt-5.3-codex', disallowedTools: [], autoExitOnComplete: false, sandbox: 'read-only' },
      })
      const raw = provider.serializeInitialInput('prompt', undefined, opts)
      const params = splitFrames(raw)[1]!.params as { sandbox: string }
      expect(params.sandbox).toBe('read-only')
    } finally {
      delete process.env['CODEX_SANDBOX_MODE']
    }
  })

  test('CODEX_SANDBOX_MODE env ignores invalid values and falls back to default', () => {
    process.env['CODEX_SANDBOX_MODE'] = 'totally-bogus'
    try {
      const provider = makeCodexProvider()
      const raw = provider.serializeInitialInput('prompt', undefined, makeOpts())
      const params = splitFrames(raw)[1]!.params as { sandbox: string }
      expect(params.sandbox).toBe('danger-full-access')
    } finally {
      delete process.env['CODEX_SANDBOX_MODE']
    }
  })

  test('includes reasoning effort in config when set', () => {
    const provider = makeCodexProvider()
    const opts = makeOpts({
      modeConfig: { systemPrompt: '', model: 'gpt-5.3-codex', disallowedTools: [], autoExitOnComplete: false, reasoningEffort: 'high' },
    })
    const raw = provider.serializeInitialInput('prompt', undefined, opts)
    const params = splitFrames(raw)[1]!.params as { config?: { model_reasoning_effort: string } }
    expect(params.config).toEqual({ model_reasoning_effort: 'high' })
  })

  test('omits config when reasoningEffort not set', () => {
    const provider = makeCodexProvider()
    const raw = provider.serializeInitialInput('prompt', undefined, makeOpts())
    const params = splitFrames(raw)[1]!.params as { config?: unknown }
    expect(params.config).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// onProviderEvent — deferred turn/start
// ---------------------------------------------------------------------------

describe('onProviderEvent — session_id', () => {
  test('returns turn/start frame on session_id event', () => {
    const provider = makeCodexProvider()
    provider.serializeInitialInput('do the thing', undefined, makeOpts())

    const result = provider.onProviderEvent!(
      { kind: 'session_id', sessionId: 'thr_abc' },
      { providerSessionId: 'thr_abc' },
    )

    expect(result).not.toBeNull()
    const frame = JSON.parse(result![0]!) as { method: string; params: { threadId: string; input: Array<{ type: string; text?: string }> } }
    expect(frame.method).toBe('turn/start')
    expect(frame.params.threadId).toBe('thr_abc')
    expect(frame.params.input[0]).toEqual({ type: 'text', text: 'do the thing' })
  })

  test('clears pendingInitialInput so second session_id returns null', () => {
    const provider = makeCodexProvider()
    provider.serializeInitialInput('prompt', undefined, makeOpts())

    provider.onProviderEvent!({ kind: 'session_id', sessionId: 'thr_abc' }, { providerSessionId: 'thr_abc' })
    const second = provider.onProviderEvent!({ kind: 'session_id', sessionId: 'thr_abc' }, { providerSessionId: 'thr_abc' })
    expect(second).toBeNull()
  })

  test('returns null for non-session_id events', () => {
    const provider = makeCodexProvider()
    const result = provider.onProviderEvent!(
      { kind: 'text_delta', text: 'hello' },
      { providerSessionId: 'thr_abc' },
    )
    expect(result).toBeNull()
  })

  test('returns null when providerSessionId is missing', () => {
    const provider = makeCodexProvider()
    provider.serializeInitialInput('prompt', undefined, makeOpts())
    const result = provider.onProviderEvent!(
      { kind: 'session_id', sessionId: 'thr_abc' },
      { providerSessionId: undefined },
    )
    expect(result).toBeNull()
  })

  test('turn/start frame ends with newline for runtime stdin', () => {
    const provider = makeCodexProvider()
    provider.serializeInitialInput('prompt', undefined, makeOpts())
    const result = provider.onProviderEvent!(
      { kind: 'session_id', sessionId: 'thr_abc' },
      { providerSessionId: 'thr_abc' },
    )!
    expect(result[0]!.endsWith('\n')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// serializeInitialInput — resume
// ---------------------------------------------------------------------------

describe('serializeInitialInput — resume', () => {
  test('emits initialize, thread/resume then turn/start joined by newline', () => {
    const provider = makeCodexProvider()
    const raw = provider.serializeInitialInput('continue', undefined, makeOpts({ resumeSessionId: 'thr_existing' }))
    const lines = raw.split('\n')
    expect(lines).toHaveLength(3)
    const init = JSON.parse(lines[0]!) as { method: string }
    const resume = JSON.parse(lines[1]!) as { method: string; params: { threadId: string } }
    const turn = JSON.parse(lines[2]!) as { method: string; params: { threadId: string; input: unknown[] } }

    expect(init.method).toBe('initialize')
    expect(resume.method).toBe('thread/resume')
    expect(resume.params.threadId).toBe('thr_existing')
    expect(turn.method).toBe('turn/start')
    expect(turn.params.threadId).toBe('thr_existing')
    expect(turn.params.input[0]!).toEqual({ type: 'text', text: 'continue' })
  })

  test('does not defer turn/start — onProviderEvent returns null', () => {
    const provider = makeCodexProvider()
    provider.serializeInitialInput('continue', undefined, makeOpts({ resumeSessionId: 'thr_existing' }))
    const result = provider.onProviderEvent!(
      { kind: 'session_id', sessionId: 'thr_existing' },
      { providerSessionId: 'thr_existing' },
    )
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// serializeUserReply
// ---------------------------------------------------------------------------

describe('serializeUserReply', () => {
  test('emits turn/start with correct threadId', () => {
    const provider = makeCodexProvider()
    provider.serializeInitialInput('init', undefined, makeOpts())

    const raw = provider.serializeUserReply('follow-up', undefined, { providerSessionId: 'thr_abc' })
    const parsed = JSON.parse(raw) as { method: string; params: { threadId: string; input: Array<{ type: string; text: string }> } }

    expect(parsed.method).toBe('turn/start')
    expect(parsed.params.threadId).toBe('thr_abc')
    expect(parsed.params.input[0]!).toEqual({ type: 'text', text: 'follow-up' })
  })

  test('throws when providerSessionId is missing', () => {
    const provider = makeCodexProvider()
    expect(() =>
      provider.serializeUserReply('reply', undefined, { providerSessionId: undefined }),
    ).toThrow()
  })

  test('id increments monotonically across calls', () => {
    const provider = makeCodexProvider()
    provider.serializeInitialInput('init', undefined, makeOpts())
    provider.onProviderEvent!({ kind: 'session_id', sessionId: 'thr_1' }, { providerSessionId: 'thr_1' })

    const r1 = JSON.parse(provider.serializeUserReply('msg1', undefined, { providerSessionId: 'thr_1' })) as { id: number }
    const r2 = JSON.parse(provider.serializeUserReply('msg2', undefined, { providerSessionId: 'thr_1' })) as { id: number }

    expect(r2.id).toBeGreaterThan(r1.id)
  })
})

// ---------------------------------------------------------------------------
// Image staging
// ---------------------------------------------------------------------------

describe('image staging', () => {
  let writeSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)
  })

  afterEach(() => {
    writeSpy.mockRestore()
  })

  test('stages image to tmp dir and emits localImage ref in turn/start', () => {
    const provider = makeCodexProvider()
    provider.serializeInitialInput('prompt', [PNG_IMG], makeOpts())

    const mkdirSpy = spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
    const result = provider.onProviderEvent!(
      { kind: 'session_id', sessionId: 'thr_abc' },
      { providerSessionId: 'thr_abc' },
    )!
    mkdirSpy.mockRestore()

    const frame = JSON.parse(result[0]!) as { params: { input: Array<{ type: string; path?: string }> } }
    const localImage = frame.params.input.find((i) => i.type === 'localImage')

    expect(localImage).toBeDefined()
    expect(localImage!.path).toContain(path.join(WORKSPACE, 'tmp'))
    expect(localImage!.path).toMatch(/\.png$/)
  })

  test('writeFileSync called with base64-decoded Buffer', () => {
    const provider = makeCodexProvider()
    provider.serializeInitialInput('prompt', [PNG_IMG], makeOpts())

    spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
    provider.onProviderEvent!(
      { kind: 'session_id', sessionId: 'thr_abc' },
      { providerSessionId: 'thr_abc' },
    )

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const [, data] = writeSpy.mock.calls[0]! as [string, Buffer]
    expect(data).toBeInstanceOf(Buffer)
  })

  test('jpeg image gets .jpg extension', () => {
    const jpegImg: Image = { mediaType: 'image/jpeg', dataBase64: '/9j/4AAQ' }
    const provider = makeCodexProvider()
    provider.serializeInitialInput('prompt', [jpegImg], makeOpts())

    spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
    const result = provider.onProviderEvent!(
      { kind: 'session_id', sessionId: 'thr_abc' },
      { providerSessionId: 'thr_abc' },
    )!

    const frame = JSON.parse(result[0]!) as { params: { input: Array<{ type: string; path?: string }> } }
    const localImage = frame.params.input.find((i) => i.type === 'localImage')
    expect(localImage!.path).toMatch(/\.jpg$/)
  })
})

// ---------------------------------------------------------------------------
// parseLine
// ---------------------------------------------------------------------------

describe('parseLine', () => {
  test('thread/started notification emits session_id event', () => {
    const provider = makeCodexProvider()
    const line = JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thr_xyz' } } })
    const { events, sessionId } = provider.parseLine(line, {})
    expect(events).toEqual([{ kind: 'session_id', sessionId: 'thr_xyz' }])
    expect(sessionId).toBe('thr_xyz')
  })

  test('empty line returns no events', () => {
    const provider = makeCodexProvider()
    const { events } = provider.parseLine('', {})
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// resumeArgs
// ---------------------------------------------------------------------------

describe('resumeArgs', () => {
  test('returns empty array (Codex resumes via RPC, not argv)', () => {
    const provider = makeCodexProvider()
    expect(provider.resumeArgs('any-id')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// isQuotaError
// ---------------------------------------------------------------------------

describe('isQuotaError', () => {
  test.each([
    ['plan limit reached', true],
    ['quota exceeded', true],
    ['rate limit exceeded', true],
    ['rate-limit exceeded', true],
    ['too many requests', true],
    ['exhausted your credits', true],
    ['plan_limit_reached', true],
    ['normal stderr output', false],
    ['error: file not found', false],
    ['', false],
  ] as const)('isQuotaError(%s) === %s', (input, expected) => {
    const provider = makeCodexProvider()
    expect(provider.isQuotaError(input)).toBe(expected)
  })
})
