import crypto from 'node:crypto'
import type { TranscriptEvent, TranscriptEventBase, TurnTrigger, StatusSeverity } from '../../shared/api-types'
import type { ParsedStreamEvent } from './stream-json-types'
import { buildToolCallSummary, buildToolResultPayload, classifyTool } from './tool-classifier'

export interface TranscriptTranslatorOpts {
  sessionId: string
  startingSeq: number
  startingTurn?: number
  now?: () => number
  idGen?: () => string
}

export class TranscriptTranslator {
  private seq: number
  private turn: number
  private readonly sessionId: string
  private readonly now: () => number
  private readonly idGen: () => string

  private readonly textBuffers = new Map<string, { blockId: string; text: string }>()
  private readonly thinkingBuffers = new Map<string, { blockId: string; text: string; signature?: string }>()
  private readonly pendingTools = new Map<string, { toolUseId: string; name: string; input: Record<string, unknown> }>()

  private turnOpen = false
  private turnStart = 0

  constructor(opts: TranscriptTranslatorOpts) {
    this.sessionId = opts.sessionId
    this.seq = opts.startingSeq
    this.turn = opts.startingTurn ?? 0
    this.now = opts.now ?? (() => Date.now())
    this.idGen = opts.idGen ?? (() => crypto.randomUUID())
  }

  get currentSeq(): number { return this.seq }
  get currentTurn(): number { return this.turn }

  userMessage(text: string, images?: string[]): TranscriptEvent {
    const evt: TranscriptEvent = {
      ...this.base(),
      type: 'user_message',
      text,
    }
    if (images && images.length > 0) (evt as { images?: string[] }).images = [...images]
    return evt
  }

  startTurn(trigger: TurnTrigger): TranscriptEvent | null {
    if (this.turnOpen) return null
    this.turn += 1
    this.turnOpen = true
    this.turnStart = this.now()
    return { ...this.base(), type: 'turn_started', trigger }
  }

  handle(event: ParsedStreamEvent): TranscriptEvent[] {
    switch (event.kind) {
      case 'text_delta':
        return this.handleTextDelta(event.text, event.parentToolUseId ?? null)

      case 'thinking_block':
        return this.handleThinkingBlock(event.text, event.signature, event.parentToolUseId ?? null)

      case 'tool_use': {
        const out: TranscriptEvent[] = [...this.flushAllBuffers()]
        const summary = buildToolCallSummary({
          toolUseId: event.id,
          name: event.name,
          input: event.input,
          parentToolUseId: event.parentToolUseId,
        })
        this.pendingTools.set(event.id, { toolUseId: event.id, name: event.name, input: event.input })
        out.push({ ...this.base(), type: 'tool_call', call: summary })
        return out
      }

      case 'tool_result': {
        const out: TranscriptEvent[] = [...this.flushAllBuffers()]
        const pending = this.pendingTools.get(event.toolUseId)
        const toolKind = pending ? classifyTool(pending.name) : undefined
        const result = buildToolResultPayload({ content: event.content, toolKind })
        if (pending) this.pendingTools.delete(event.toolUseId)
        out.push({ ...this.base(), type: 'tool_result', toolUseId: event.toolUseId, result })
        return out
      }

      case 'turn_complete': {
        const out: TranscriptEvent[] = [...this.flushAllBuffers()]
        const completed = this.closeTurn(
          event.totalTokens ?? undefined,
          event.totalCostUsd ?? undefined,
          false,
        )
        if (completed) out.push(completed)
        return out
      }

      case 'error':
        return [this.status('session_error', event.error, { severity: 'error' })]

      case 'session_id':
        return []
    }
  }

  closeTurn(totalTokens?: number, totalCostUsd?: number, errored?: boolean): TranscriptEvent | null {
    if (!this.turnOpen) return null
    this.turnOpen = false
    const evt: TranscriptEvent = {
      ...this.base(),
      type: 'turn_completed',
      durationMs: Math.max(0, this.now() - this.turnStart),
    }
    if (totalTokens !== undefined) (evt as { totalTokens?: number }).totalTokens = totalTokens
    if (totalCostUsd !== undefined) (evt as { totalCostUsd?: number }).totalCostUsd = totalCostUsd
    if (errored === true) (evt as { errored?: boolean }).errored = true
    return evt
  }

  status(
    kind: string,
    message: string,
    opts?: { severity?: StatusSeverity; data?: Record<string, unknown> },
  ): TranscriptEvent {
    const evt: TranscriptEvent = {
      ...this.base(),
      type: 'status',
      severity: opts?.severity ?? 'info',
      kind,
      message,
    }
    if (opts?.data) (evt as { data?: Record<string, unknown> }).data = { ...opts.data }
    return evt
  }

  private handleTextDelta(text: string, parentToolUseId: string | null): TranscriptEvent[] {
    const key = parentToolUseId ?? '__root__'
    let buf = this.textBuffers.get(key)
    if (!buf) {
      buf = { blockId: this.idGen(), text: '' }
      this.textBuffers.set(key, buf)
    }
    buf.text += text
    return [{ ...this.base(), type: 'assistant_text', blockId: buf.blockId, text, final: false }]
  }

  private handleThinkingBlock(
    text: string,
    signature: string | undefined,
    parentToolUseId: string | null,
  ): TranscriptEvent[] {
    const key = parentToolUseId ?? '__root__'
    const blockId = this.idGen()
    this.thinkingBuffers.set(key, { blockId, text, signature })
    const evt: TranscriptEvent = {
      ...this.base(),
      type: 'thinking',
      blockId,
      text,
      final: true,
    }
    if (signature) (evt as { signature?: string }).signature = signature
    return [evt]
  }

  private flushAllBuffers(): TranscriptEvent[] {
    const out: TranscriptEvent[] = []
    for (const [, buf] of this.textBuffers) {
      out.push({ ...this.base(), type: 'assistant_text', blockId: buf.blockId, text: buf.text, final: true })
    }
    this.textBuffers.clear()
    for (const [, buf] of this.thinkingBuffers) {
      const evt: TranscriptEvent = {
        ...this.base(),
        type: 'thinking',
        blockId: buf.blockId,
        text: buf.text,
        final: true,
      }
      if (buf.signature) (evt as { signature?: string }).signature = buf.signature
      out.push(evt)
    }
    this.thinkingBuffers.clear()
    return out
  }

  private base(): TranscriptEventBase {
    return {
      seq: this.seq++,
      id: this.idGen(),
      sessionId: this.sessionId,
      turn: this.turn,
      timestamp: this.now(),
    }
  }
}
