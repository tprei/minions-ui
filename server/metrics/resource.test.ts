import { describe, test, expect, beforeEach } from 'bun:test'
import { ResourceMonitor } from './resource'
import { EngineEventBus } from '../events/bus'

describe('ResourceMonitor', () => {
  let bus: EngineEventBus

  beforeEach(() => {
    bus = new EngineEventBus()
  })

  test('sample() returns valid metric shape', () => {
    const monitor = new ResourceMonitor(bus)
    const now = Date.now()
    const metrics = monitor.sample(now)
    expect(typeof metrics.cpuPct).toBe('number')
    expect(metrics.cpuPct).toBeGreaterThanOrEqual(0)
    expect(metrics.cpuPct).toBeLessThanOrEqual(100)
    expect(typeof metrics.memBytes).toBe('number')
    expect(typeof metrics.memMaxBytes).toBe('number')
    expect(metrics.timestamp).toBe(now)
  })

  test('start() emits resource events on tick', async () => {
    const emitted: unknown[] = []
    bus.onKind('resource', (e) => emitted.push(e))

    const monitor = new ResourceMonitor(bus, 10)
    monitor.start()

    await new Promise<void>((r) => setTimeout(r, 35))
    monitor.stop()

    expect(emitted.length).toBeGreaterThanOrEqual(2)
    const first = emitted[0] as { kind: string; cpuPct: number; memBytes: number; timestamp: number }
    expect(first.kind).toBe('resource')
    expect(typeof first.cpuPct).toBe('number')
    expect(typeof first.memBytes).toBe('number')
  })

  test('stop() prevents further ticks', async () => {
    const emitted: unknown[] = []
    bus.onKind('resource', (e) => emitted.push(e))

    const monitor = new ResourceMonitor(bus, 10)
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

    const monitor = new ResourceMonitor(bus, 10)
    monitor.start()
    monitor.start()
    await new Promise<void>((r) => setTimeout(r, 25))
    monitor.stop()

    expect(emitted.length).toBeLessThanOrEqual(4)
  })
})
