import { describe, test, expect, beforeEach } from 'bun:test'
import { ResourceMonitor } from './resource'
import { EngineEventBus } from '../events/bus'
import type { ResourceSnapshot } from '../../shared/api-types'

describe('ResourceMonitor', () => {
  let bus: EngineEventBus

  beforeEach(() => {
    bus = new EngineEventBus()
  })

  test('sample() returns a valid ResourceSnapshot', () => {
    const monitor = new ResourceMonitor(bus)
    const now = Date.now()
    const snap = monitor.sample(now)
    expect(snap.ts).toBe(now)
    expect(typeof snap.cpu.usagePercent).toBe('number')
    expect(snap.cpu.usagePercent).toBeGreaterThanOrEqual(0)
    expect(snap.cpu.usagePercent).toBeLessThanOrEqual(100)
    expect(typeof snap.cpu.cpuCount).toBe('number')
    expect(typeof snap.memory.usedBytes).toBe('number')
    expect(typeof snap.memory.limitBytes).toBe('number')
    expect(typeof snap.memory.rssBytes).toBe('number')
    expect(typeof snap.disk.path).toBe('string')
    expect(typeof snap.eventLoopLagMs).toBe('number')
    expect(snap.counts.activeSessions).toBe(0)
    expect(snap.counts.maxSessions).toBe(0)
  })

  test('sample() uses injected countsProvider', () => {
    const monitor = new ResourceMonitor(bus, {
      countsProvider: () => ({ activeSessions: 2, maxSessions: 10, activeLoops: 1, maxLoops: 3 }),
    })
    const snap = monitor.sample(Date.now())
    expect(snap.counts.activeSessions).toBe(2)
    expect(snap.counts.maxSessions).toBe(10)
    expect(snap.counts.activeLoops).toBe(1)
    expect(snap.counts.maxLoops).toBe(3)
  })

  test('start() emits resource events carrying snapshots', async () => {
    const emitted: ResourceSnapshot[] = []
    bus.onKind('resource', (e) => emitted.push(e.snapshot))

    const monitor = new ResourceMonitor(bus, { intervalMs: 10 })
    monitor.start()

    await new Promise<void>((r) => setTimeout(r, 35))
    monitor.stop()

    expect(emitted.length).toBeGreaterThanOrEqual(2)
    const first = emitted[0]!
    expect(typeof first.ts).toBe('number')
    expect(typeof first.cpu.usagePercent).toBe('number')
    expect(typeof first.memory.usedBytes).toBe('number')
  })

  test('stop() prevents further ticks', async () => {
    const emitted: unknown[] = []
    bus.onKind('resource', (e) => emitted.push(e))

    const monitor = new ResourceMonitor(bus, { intervalMs: 10 })
    monitor.start()
    await new Promise<void>((r) => setTimeout(r, 15))
    monitor.stop()
    const countAfterStop = emitted.length

    await new Promise<void>((r) => setTimeout(r, 25))
    expect(emitted.length).toBe(countAfterStop)
  })

  test('second start() call is idempotent', async () => {
    const emitted: unknown[] = []
    bus.onKind('resource', (e) => emitted.push(e))

    const monitor = new ResourceMonitor(bus, { intervalMs: 10 })
    monitor.start()
    monitor.start()
    await new Promise<void>((r) => setTimeout(r, 25))
    monitor.stop()

    expect(emitted.length).toBeLessThanOrEqual(4)
  })
})
