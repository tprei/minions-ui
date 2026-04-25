import fs from 'node:fs'
import path from 'node:path'
import type { ProviderEvent } from './providers/types'
import type { EngineEventBus } from '../events/bus'

export class SessionStreamObserver {
  private readonly sentScreenshots = new Set<string>()

  constructor(
    private readonly sessionId: string,
    private readonly bus: EngineEventBus,
  ) {}

  onEvent(event: ProviderEvent): void {
    if (event.kind === 'tool_use') {
      this.bus.emit({
        kind: 'session.assistant_activity',
        sessionId: this.sessionId,
        toolName: event.name,
        toolUseId: event.id,
      })
    }
  }

  onTurnComplete(cwd: string, slug: string): void {
    const screenshotDir = path.join(cwd, '.screenshots')
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(screenshotDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (this.sentScreenshots.has(entry.name)) continue
      const lname = entry.name.toLowerCase()
      if (!lname.endsWith('.png') && !lname.endsWith('.jpg') && !lname.endsWith('.jpeg') && !lname.endsWith('.webp')) continue

      this.sentScreenshots.add(entry.name)
      const absolutePath = path.join(screenshotDir, entry.name)
      this.bus.emit({
        kind: 'session.screenshot_captured',
        sessionId: this.sessionId,
        filename: entry.name,
        absolutePath,
        relativeUrl: `/api/sessions/${slug}/screenshots/${entry.name}`,
        capturedAt: new Date().toISOString(),
      })
    }
  }
}
