import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { UserMessageCard } from '../../../src/chat/transcript/UserMessageCard'
import { AssistantTextBlock } from '../../../src/chat/transcript/AssistantTextBlock'
import { ThinkingBlock } from '../../../src/chat/transcript/ThinkingBlock'
import { ToolCallCard } from '../../../src/chat/transcript/ToolCallCard'
import { ToolResultBody } from '../../../src/chat/transcript/ToolResultBody'
import { StatusBanner } from '../../../src/chat/transcript/StatusBanner'
import { TurnSeparator } from '../../../src/chat/transcript/TurnSeparator'
import type {
  AssistantTextEvent,
  StatusEvent,
  ThinkingEvent,
  ToolCallEvent,
  ToolResultEvent,
  TurnCompletedEvent,
  TurnStartedEvent,
  UserMessageEvent,
} from '../../../src/api/types'

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  }
})

const baseEvent = (seq: number, turn = 1) => ({
  seq,
  id: `e${seq}`,
  sessionId: 's1',
  turn,
  timestamp: 1_700_000_000 + seq,
})

describe('UserMessageCard', () => {
  it('renders the text content right-aligned', () => {
    const event: UserMessageEvent = {
      ...baseEvent(1),
      type: 'user_message',
      text: 'please fix the build',
    }
    render(<UserMessageCard event={event} />)
    expect(screen.getByText('please fix the build')).toBeTruthy()
    const card = screen.getByTestId('transcript-user-message')
    expect(card.className).toContain('justify-end')
  })

  it('renders image badges when present', () => {
    const event: UserMessageEvent = {
      ...baseEvent(1),
      type: 'user_message',
      text: 'see screenshot',
      images: ['https://example.com/img.png', 'https://example.com/img2.png'],
    }
    render(<UserMessageCard event={event} />)
    expect(screen.getByText('image 1')).toBeTruthy()
    expect(screen.getByText('image 2')).toBeTruthy()
  })
})

describe('AssistantTextBlock', () => {
  it('renders markdown text without streaming indicator when final', () => {
    const event: AssistantTextEvent = {
      ...baseEvent(1),
      type: 'assistant_text',
      blockId: 'b1',
      text: '**bold** text',
      final: true,
    }
    render(<AssistantTextBlock event={event} />)
    expect(screen.queryByTestId('transcript-streaming-indicator')).toBeNull()
    const block = screen.getByTestId('transcript-assistant-text')
    expect(block.innerHTML).toContain('<strong>bold</strong>')
  })

  it('shows the streaming indicator when not final', () => {
    const event: AssistantTextEvent = {
      ...baseEvent(1),
      type: 'assistant_text',
      blockId: 'b1',
      text: 'Streaming…',
      final: false,
    }
    render(<AssistantTextBlock event={event} />)
    expect(screen.getByTestId('transcript-streaming-indicator')).toBeTruthy()
  })
})

describe('ThinkingBlock', () => {
  it('starts collapsed and shows preview', () => {
    const event: ThinkingEvent = {
      ...baseEvent(1),
      type: 'thinking',
      blockId: 'th1',
      text: 'Considering the trade-offs between A and B carefully',
      final: true,
    }
    render(<ThinkingBlock event={event} />)
    expect(screen.queryByTestId('transcript-thinking-body')).toBeNull()
    const toggle = screen.getByTestId('transcript-thinking-toggle')
    expect(toggle.textContent).toContain('Thinking')
  })

  it('expands when toggled', () => {
    const event: ThinkingEvent = {
      ...baseEvent(1),
      type: 'thinking',
      blockId: 'th1',
      text: 'reasoning content',
      final: true,
    }
    render(<ThinkingBlock event={event} />)
    fireEvent.click(screen.getByTestId('transcript-thinking-toggle'))
    expect(screen.getByTestId('transcript-thinking-body').textContent).toContain('reasoning content')
  })

  it('respects defaultOpen', () => {
    const event: ThinkingEvent = {
      ...baseEvent(1),
      type: 'thinking',
      blockId: 'th1',
      text: 'open by default',
      final: true,
    }
    render(<ThinkingBlock event={event} defaultOpen={true} />)
    expect(screen.getByTestId('transcript-thinking-body').textContent).toContain('open by default')
  })
})

describe('ToolCallCard', () => {
  function makeCall(): ToolCallEvent {
    return {
      ...baseEvent(1),
      type: 'tool_call',
      call: {
        toolUseId: 'tu1',
        name: 'Read',
        kind: 'read',
        title: 'Read /etc/hosts',
        subtitle: '/etc/hosts',
        input: { path: '/etc/hosts', limit: 100 },
      },
    }
  }

  function makeResult(status: 'ok' | 'error' | 'pending', text = 'OK'): ToolResultEvent {
    return {
      ...baseEvent(2),
      type: 'tool_result',
      toolUseId: 'tu1',
      result: { status, text },
    }
  }

  it('renders header with name, title, subtitle, and pending status', () => {
    render(<ToolCallCard call={makeCall()} result={null} />)
    expect(screen.getByText('Read')).toBeTruthy()
    expect(screen.getByText('Read /etc/hosts')).toBeTruthy()
    expect(screen.getByText('/etc/hosts')).toBeTruthy()
    expect(screen.getByTestId('transcript-tool-status-pending')).toBeTruthy()
  })

  it('shows ok badge when result is ok', () => {
    render(<ToolCallCard call={makeCall()} result={makeResult('ok')} />)
    expect(screen.getByTestId('transcript-tool-status-ok')).toBeTruthy()
  })

  it('shows error badge when result is error', () => {
    render(<ToolCallCard call={makeCall()} result={makeResult('error')} />)
    expect(screen.getByTestId('transcript-tool-status-error')).toBeTruthy()
  })

  it('expands to show input and result when toggled', () => {
    render(<ToolCallCard call={makeCall()} result={makeResult('ok', 'file contents')} />)
    fireEvent.click(screen.getByTestId('transcript-tool-call-toggle'))
    const body = screen.getByTestId('transcript-tool-call-body')
    expect(body).toBeTruthy()
    const input = screen.getByTestId('transcript-tool-input')
    expect(input.textContent).toContain('path')
    expect(input.textContent).toContain('/etc/hosts')
    expect(input.textContent).toContain('limit')
    expect(input.textContent).toContain('100')
    expect(screen.getByTestId('transcript-tool-result-ok')).toBeTruthy()
    expect(screen.getByText('file contents')).toBeTruthy()
  })

  it('shows pending placeholder when expanded with no result', () => {
    render(<ToolCallCard call={makeCall()} result={null} />)
    fireEvent.click(screen.getByTestId('transcript-tool-call-toggle'))
    expect(screen.getByTestId('transcript-tool-call-pending')).toBeTruthy()
  })

  it('shows an inline result preview when collapsed', () => {
    render(<ToolCallCard call={makeCall()} result={makeResult('ok', '127.0.0.1 localhost\nanother line')} />)
    const preview = screen.getByTestId('transcript-tool-call-preview')
    expect(preview.textContent).toBe('127.0.0.1 localhost')
  })

  it('hides the inline preview once expanded', () => {
    render(<ToolCallCard call={makeCall()} result={makeResult('ok', 'inline preview text')} />)
    fireEvent.click(screen.getByTestId('transcript-tool-call-toggle'))
    expect(screen.queryByTestId('transcript-tool-call-preview')).toBeNull()
  })
})

describe('ToolResultBody', () => {
  function ev(result: ToolResultEvent['result']): ToolResultEvent {
    return {
      ...baseEvent(1),
      type: 'tool_result',
      toolUseId: 'tu1',
      result,
    }
  }

  it('renders error with message and trailing text', () => {
    render(<ToolResultBody event={ev({ status: 'error', error: 'permission denied', text: 'stack trace' })} />)
    expect(screen.getByTestId('transcript-tool-result-error')).toBeTruthy()
    expect(screen.getByText('permission denied')).toBeTruthy()
    expect(screen.getByText('stack trace')).toBeTruthy()
  })

  it('renders pending placeholder', () => {
    render(<ToolResultBody event={ev({ status: 'pending' })} />)
    expect(screen.getByTestId('transcript-tool-result-pending')).toBeTruthy()
  })

  it('renders text body with format=text by default', () => {
    render(<ToolResultBody event={ev({ status: 'ok', text: 'plain output' })} />)
    expect(screen.getByTestId('transcript-tool-result-text').textContent).toBe('plain output')
  })

  it('renders markdown when format=markdown', () => {
    render(<ToolResultBody event={ev({ status: 'ok', text: '**md**', format: 'markdown' })} />)
    expect(screen.getByTestId('transcript-tool-result-markdown')).toBeTruthy()
  })

  it('renders diff when format=diff', () => {
    render(<ToolResultBody event={ev({ status: 'ok', text: '+ line\n- line', format: 'diff' })} />)
    expect(screen.getByTestId('transcript-tool-result-diff')).toBeTruthy()
  })

  it('syntax highlights diff lines with token classes', () => {
    render(
      <ToolResultBody
        event={ev({
          status: 'ok',
          text: '--- a/foo\n+++ b/foo\n@@ -1,2 +1,2 @@\n-old line\n+new line',
          format: 'diff',
        })}
      />,
    )
    const pre = screen.getByTestId('transcript-tool-result-diff')
    expect(pre.querySelector('.tok-insertion')).toBeTruthy()
    expect(pre.querySelector('.tok-deletion')).toBeTruthy()
    expect(pre.querySelector('.tok-hunk')).toBeTruthy()
  })

  it('pretty-prints JSON', () => {
    render(<ToolResultBody event={ev({ status: 'ok', text: '{"a":1,"b":2}', format: 'json' })} />)
    expect(screen.getByTestId('transcript-tool-result-json').textContent).toContain('"a": 1')
  })

  it('syntax highlights JSON tokens', () => {
    render(<ToolResultBody event={ev({ status: 'ok', text: '{"a":1,"b":"x"}', format: 'json' })} />)
    const pre = screen.getByTestId('transcript-tool-result-json')
    expect(pre.querySelector('.tok-property')).toBeTruthy()
    expect(pre.querySelector('.tok-number')).toBeTruthy()
    expect(pre.querySelector('.tok-string')).toBeTruthy()
  })

  it('syntax highlights plain text when meta.language is set', () => {
    render(
      <ToolResultBody
        event={ev({
          status: 'ok',
          text: 'const x = 1',
          meta: { language: 'typescript' },
        })}
      />,
    )
    const pre = screen.getByTestId('transcript-tool-result-text')
    expect(pre.querySelector('.tok-keyword')).toBeTruthy()
    expect(pre.querySelector('.tok-number')).toBeTruthy()
  })

  it('falls back to plain text when meta.language is unknown', () => {
    render(
      <ToolResultBody
        event={ev({
          status: 'ok',
          text: 'const x = 1',
          meta: { language: 'not-a-real-language' },
        })}
      />,
    )
    const pre = screen.getByTestId('transcript-tool-result-text')
    expect(pre.querySelector('.tok-keyword')).toBeNull()
    expect(pre.textContent).toBe('const x = 1')
  })

  it('shows truncated badge when result.truncated', () => {
    render(<ToolResultBody event={ev({ status: 'ok', text: 'x', truncated: true, originalBytes: 5000 })} />)
    expect(screen.getByText('truncated')).toBeTruthy()
    expect(screen.getByText('4.9 KB')).toBeTruthy()
  })

  it('renders images when result.images is set', () => {
    render(<ToolResultBody event={ev({ status: 'ok', images: ['https://example.com/x.png'] })} />)
    const imgs = screen.getByTestId('transcript-tool-result-images').querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('src')).toBe('https://example.com/x.png')
  })
})

describe('StatusBanner', () => {
  it('renders kind and message and severity attribute', () => {
    const event: StatusEvent = {
      ...baseEvent(1),
      type: 'status',
      severity: 'warn',
      kind: 'rate_limit',
      message: 'API rate limit approaching',
    }
    render(<StatusBanner event={event} />)
    const banner = screen.getByTestId('transcript-status')
    expect(banner.getAttribute('data-severity')).toBe('warn')
    expect(banner.textContent).toContain('rate_limit')
    expect(banner.textContent).toContain('API rate limit approaching')
  })
})

describe('TurnSeparator', () => {
  it('shows turn number when no metadata', () => {
    render(<TurnSeparator turn={3} />)
    const sep = screen.getByTestId('transcript-turn-separator')
    expect(sep.getAttribute('data-turn')).toBe('3')
    expect(sep.textContent).toContain('Turn 3')
  })

  it('renders trigger label and completion stats', () => {
    const started: TurnStartedEvent = {
      ...baseEvent(1),
      type: 'turn_started',
      trigger: 'command',
    }
    const completed: TurnCompletedEvent = {
      ...baseEvent(2),
      type: 'turn_completed',
      totalTokens: 2_500,
      totalCostUsd: 0.12,
      durationMs: 4_500,
    }
    render(<TurnSeparator turn={1} started={started} completed={completed} />)
    const sep = screen.getByTestId('transcript-turn-separator')
    expect(sep.textContent).toContain('Command')
    expect(sep.textContent).toContain('2.5k tok')
    expect(sep.textContent).toContain('$0.12')
    expect(sep.textContent).toContain('4.5s')
  })

  it('marks errored turns', () => {
    const completed: TurnCompletedEvent = {
      ...baseEvent(2),
      type: 'turn_completed',
      errored: true,
    }
    render(<TurnSeparator turn={1} completed={completed} />)
    expect(screen.getByText('errored')).toBeTruthy()
  })
})
