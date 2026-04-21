import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { SessionStreamObserver } from './stream-observer'
import { EngineEventBus } from '../events/bus'
import type { ParsedStreamEvent } from './stream-json-types'
import type { EngineEvent } from '../events/types'

const TMPDIR = Bun.env['TMPDIR'] ?? '/tmp'
const tmpDirs: string[] = []

function trackedDir(): string {
  const dir = path.join(TMPDIR, `stream-obs-test-${crypto.randomBytes(6).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  tmpDirs.push(dir)
  return dir
}

function collectEvents(bus: EngineEventBus): EngineEvent[] {
  const events: EngineEvent[] = []
  bus.on((e) => events.push(e))
  return events
}

describe('SessionStreamObserver', () => {
  test('emits assistant_activity on tool_use event', () => {
    const bus = new EngineEventBus()
    const events = collectEvents(bus)
    const observer = new SessionStreamObserver('sess-1', bus)

    const toolUseEvent: ParsedStreamEvent = {
      kind: 'tool_use',
      id: 'tool-abc',
      name: 'bash',
      input: { command: 'ls' },
    }

    observer.onEvent(toolUseEvent)

    const activityEvents = events.filter((e) => e.kind === 'session.assistant_activity')
    expect(activityEvents).toHaveLength(1)
    const evt = activityEvents[0]!
    if (evt.kind !== 'session.assistant_activity') throw new Error('wrong kind')
    expect(evt.sessionId).toBe('sess-1')
    expect(evt.toolName).toBe('bash')
    expect(evt.toolUseId).toBe('tool-abc')
  })

  test('does not emit assistant_activity for non-tool_use events', () => {
    const bus = new EngineEventBus()
    const events = collectEvents(bus)
    const observer = new SessionStreamObserver('sess-2', bus)

    const textDelta: ParsedStreamEvent = { kind: 'text_delta', text: 'hello' }
    observer.onEvent(textDelta)

    expect(events.filter((e) => e.kind === 'session.assistant_activity')).toHaveLength(0)
  })

  test('onTurnComplete emits screenshot_captured for new PNG files', () => {
    const cwd = trackedDir()
    const screenshotDir = path.join(cwd, '.screenshots')
    fs.mkdirSync(screenshotDir, { recursive: true })
    fs.writeFileSync(path.join(screenshotDir, 'shot1.png'), 'fake-png-data')

    const bus = new EngineEventBus()
    const events = collectEvents(bus)
    const observer = new SessionStreamObserver('sess-3', bus)

    observer.onTurnComplete(cwd, 'test-slug')

    const screenshotEvents = events.filter((e) => e.kind === 'session.screenshot_captured')
    expect(screenshotEvents).toHaveLength(1)
    const evt = screenshotEvents[0]!
    if (evt.kind !== 'session.screenshot_captured') throw new Error('wrong kind')
    expect(evt.sessionId).toBe('sess-3')
    expect(evt.filename).toBe('shot1.png')
    expect(evt.absolutePath).toContain('shot1.png')
    expect(evt.relativeUrl).toBe('/api/sessions/test-slug/screenshots/shot1.png')
    expect(evt.capturedAt).toBeTruthy()
  })

  test('onTurnComplete does not re-emit already sent screenshots', () => {
    const cwd = trackedDir()
    const screenshotDir = path.join(cwd, '.screenshots')
    fs.mkdirSync(screenshotDir, { recursive: true })
    fs.writeFileSync(path.join(screenshotDir, 'shot.png'), 'data')

    const bus = new EngineEventBus()
    const events = collectEvents(bus)
    const observer = new SessionStreamObserver('sess-4', bus)

    observer.onTurnComplete(cwd, 'slug')
    observer.onTurnComplete(cwd, 'slug')

    expect(events.filter((e) => e.kind === 'session.screenshot_captured')).toHaveLength(1)
  })

  test('onTurnComplete emits new screenshots added between turns', () => {
    const cwd = trackedDir()
    const screenshotDir = path.join(cwd, '.screenshots')
    fs.mkdirSync(screenshotDir, { recursive: true })
    fs.writeFileSync(path.join(screenshotDir, 'shot1.png'), 'data')

    const bus = new EngineEventBus()
    const events = collectEvents(bus)
    const observer = new SessionStreamObserver('sess-5', bus)

    observer.onTurnComplete(cwd, 'slug')
    fs.writeFileSync(path.join(screenshotDir, 'shot2.png'), 'data2')
    observer.onTurnComplete(cwd, 'slug')

    expect(events.filter((e) => e.kind === 'session.screenshot_captured')).toHaveLength(2)
  })

  test('onTurnComplete is a no-op when screenshot dir does not exist', () => {
    const cwd = trackedDir()
    const bus = new EngineEventBus()
    const events = collectEvents(bus)
    const observer = new SessionStreamObserver('sess-6', bus)

    expect(() => observer.onTurnComplete(cwd, 'slug')).not.toThrow()
    expect(events.filter((e) => e.kind === 'session.screenshot_captured')).toHaveLength(0)
  })
})
