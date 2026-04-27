import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/preact'
import {
  CommandPalette,
  buildCommands,
  filterCommands,
  rankCommand,
  fuzzyMatch,
} from '../../src/components/CommandPalette'
import type { ApiSession } from '../../src/api/types'
import type { Connection } from '../../src/connections/types'
import type { ConnectionStore } from '../../src/state/types'

function session(over: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 's1',
    slug: 'brave-fox',
    status: 'running',
    command: '/task foo',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...over,
  }
}

function connection(over: Partial<Connection> = {}): Connection {
  return {
    id: 'c1',
    label: 'Primary',
    baseUrl: 'https://example.com',
    token: 'tok',
    color: '#3b82f6',
    ...over,
  }
}

function makeStore(): ConnectionStore {
  return {
    sendCommand: vi.fn().mockResolvedValue({ success: true }),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConnectionStore
}

const noop = () => {}

function defaultProps(over: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  return {
    open: true,
    store: null,
    sessions: [] as ApiSession[],
    connections: [] as Connection[],
    activeConnectionId: null,
    onClose: noop,
    onShowHelp: noop,
    onSwitchView: noop,
    onSwitchConnection: noop,
    onNewTask: noop,
    onRefresh: noop,
    ...over,
  }
}

describe('fuzzyMatch', () => {
  it('returns true for empty query', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true)
  })
  it('matches sequential characters', () => {
    expect(fuzzyMatch('nt', 'new task')).toBe(true)
    expect(fuzzyMatch('ntsk', 'new task')).toBe(true)
  })
  it('rejects non-matching characters', () => {
    expect(fuzzyMatch('xyz', 'new task')).toBe(false)
  })
  it('is case insensitive', () => {
    expect(fuzzyMatch('NEW', 'new task')).toBe(true)
  })
})

describe('rankCommand', () => {
  const cmd = {
    id: 'x',
    kind: 'view' as const,
    title: 'View: Canvas',
    keywords: 'view canvas dag',
    run: () => {},
  }

  it('returns 0 for empty query', () => {
    expect(rankCommand('', cmd)).toBe(0)
  })
  it('scores exact title higher than prefix', () => {
    const exact = rankCommand('view: canvas', cmd)
    const prefix = rankCommand('view', cmd)
    expect(exact).toBeGreaterThan(prefix)
  })
  it('scores keyword match below title match', () => {
    const titlePrefix = rankCommand('view', cmd)
    const keyword = rankCommand('dag', cmd)
    expect(titlePrefix).toBeGreaterThan(keyword)
  })
  it('returns -1 when nothing matches', () => {
    expect(rankCommand('zzz', cmd)).toBe(-1)
  })
})

describe('buildCommands', () => {
  const ctx = {
    store: null,
    sessions: [
      session({ id: 's1', slug: 'brave-fox', status: 'running', prUrl: 'https://gh.example/pr/1' }),
      session({ id: 's2', slug: 'wise-owl', status: 'completed' }),
    ],
    connections: [
      connection({ id: 'c1', label: 'Primary' }),
      connection({ id: 'c2', label: 'Secondary' }),
    ],
    activeConnectionId: 'c1',
    onClose: noop,
    onShowHelp: noop,
    onSwitchView: noop,
    onSwitchConnection: noop,
    onNewTask: noop,
    onRefresh: noop,
  }

  it('includes baseline commands (new-task, views, refresh, help)', () => {
    const cmds = buildCommands(ctx)
    const ids = cmds.map((c) => c.id)
    expect(ids).toContain('new-task')
    expect(ids).toContain('view-list')
    expect(ids).toContain('view-canvas')
    expect(ids).toContain('view-ship')
    expect(ids).toContain('view-kanban')
    expect(ids).toContain('refresh')
    expect(ids).toContain('help')
  })

  it('excludes the active connection from switch commands', () => {
    const cmds = buildCommands(ctx)
    expect(cmds.find((c) => c.id === 'switch-c1')).toBeUndefined()
    expect(cmds.find((c) => c.id === 'switch-c2')).toBeDefined()
  })

  it('emits a jump command for every session', () => {
    const cmds = buildCommands(ctx)
    expect(cmds.find((c) => c.id === 'jump-s1')).toBeDefined()
    expect(cmds.find((c) => c.id === 'jump-s2')).toBeDefined()
  })

  it('emits a stop command only for running/pending sessions when a store is provided', () => {
    const store = makeStore()
    const cmds = buildCommands({ ...ctx, store })
    expect(cmds.find((c) => c.id === 'stop-s1')).toBeDefined()
    expect(cmds.find((c) => c.id === 'stop-s2')).toBeUndefined()
  })

  it('omits stop commands when no store is provided', () => {
    const cmds = buildCommands(ctx)
    expect(cmds.find((c) => c.kind === 'stop-session')).toBeUndefined()
  })

  it('emits an open-pr command only for sessions with a prUrl', () => {
    const cmds = buildCommands(ctx)
    expect(cmds.find((c) => c.id === 'pr-s1')).toBeDefined()
    expect(cmds.find((c) => c.id === 'pr-s2')).toBeUndefined()
  })
})

describe('filterCommands', () => {
  const cmds = buildCommands({
    store: null,
    sessions: [session({ id: 's1', slug: 'brave-fox' })],
    connections: [connection({ id: 'c1' }), connection({ id: 'c2', label: 'Beta' })],
    activeConnectionId: 'c1',
    onClose: noop,
    onShowHelp: noop,
    onSwitchView: noop,
    onSwitchConnection: noop,
    onNewTask: noop,
    onRefresh: noop,
  })

  it('returns all commands for empty query', () => {
    expect(filterCommands(cmds, '').length).toBe(cmds.length)
  })

  it('narrows results by query', () => {
    const out = filterCommands(cmds, 'canvas')
    expect(out.find((c) => c.id === 'view-canvas')).toBeDefined()
    expect(out.find((c) => c.id === 'view-list')).toBeUndefined()
  })

  it('orders title-prefix matches before keyword-only matches', () => {
    const out = filterCommands(cmds, 'view')
    expect(out[0].id.startsWith('view-')).toBe(true)
  })
})

describe('CommandPalette', () => {
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
  afterEach(() => cleanup())

  it('returns nothing when closed', () => {
    const { container } = render(<CommandPalette {...defaultProps({ open: false })} />)
    expect(container.querySelector('[data-testid="command-palette"]')).toBeNull()
  })

  it('renders the input and command list when open', () => {
    render(<CommandPalette {...defaultProps()} />)
    expect(screen.getByTestId('command-palette-input')).toBeTruthy()
    expect(screen.getByTestId('command-palette-list')).toBeTruthy()
  })

  it('filters list as the user types', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByTestId('command-palette-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'canvas' } })
    expect(screen.getByTestId('command-palette-item-view-canvas')).toBeTruthy()
    expect(screen.queryByTestId('command-palette-item-view-list')).toBeNull()
  })

  it('renders empty state when no commands match', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByTestId('command-palette-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'definitely-no-such-command-zzqq' } })
    expect(screen.getByTestId('command-palette-empty')).toBeTruthy()
  })

  it('runs the first command on Enter and calls onClose', () => {
    const onSwitchView = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps({ onSwitchView, onClose })} />)
    const input = screen.getByTestId('command-palette-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'view: canvas' } })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSwitchView).toHaveBeenCalledWith('canvas')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps({ onClose })} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('moves selection with arrow keys', () => {
    render(<CommandPalette {...defaultProps()} />)
    const list = screen.getByTestId('command-palette-list')
    const firstSelected = list.querySelector('[aria-selected="true"]')
    expect(firstSelected?.getAttribute('data-idx')).toBe('0')
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    const next = list.querySelector('[aria-selected="true"]')
    expect(next?.getAttribute('data-idx')).toBe('1')
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    const back = list.querySelector('[aria-selected="true"]')
    expect(back?.getAttribute('data-idx')).toBe('0')
  })

  it('switches connection when the corresponding command is clicked', () => {
    const onSwitchConnection = vi.fn()
    render(
      <CommandPalette
        {...defaultProps({
          connections: [
            connection({ id: 'c1', label: 'Primary' }),
            connection({ id: 'c2', label: 'Secondary' }),
          ],
          activeConnectionId: 'c1',
          onSwitchConnection,
        })}
      />
    )
    fireEvent.click(screen.getByTestId('command-palette-item-switch-c2'))
    expect(onSwitchConnection).toHaveBeenCalledWith('c2')
  })

  it('jumps to a session via custom handler when provided', () => {
    const onJumpSession = vi.fn()
    render(
      <CommandPalette
        {...defaultProps({
          sessions: [session({ id: 's1', slug: 'brave-fox' })],
          onJumpSession,
        })}
      />
    )
    fireEvent.click(screen.getByTestId('command-palette-item-jump-s1'))
    expect(onJumpSession).toHaveBeenCalledWith('brave-fox')
  })

  it('stops a running session via store.sendCommand', () => {
    const sendCommand = vi.fn().mockResolvedValue({ success: true })
    const store = { sendCommand } as unknown as ConnectionStore
    render(
      <CommandPalette
        {...defaultProps({
          sessions: [session({ id: 's1', slug: 'brave-fox', status: 'running' })],
          store,
        })}
      />
    )
    fireEvent.click(screen.getByTestId('command-palette-item-stop-s1'))
    expect(sendCommand).toHaveBeenCalledWith({ action: 'stop', sessionId: 's1' })
  })

  it('opens a PR in a new window when the PR command runs', () => {
    const open = vi.fn()
    const originalOpen = window.open
    window.open = open as unknown as typeof window.open
    try {
      render(
        <CommandPalette
          {...defaultProps({
            sessions: [
              session({ id: 's1', slug: 'brave-fox', prUrl: 'https://gh.example/pr/1' }),
            ],
          })}
        />
      )
      fireEvent.click(screen.getByTestId('command-palette-item-pr-s1'))
      expect(open).toHaveBeenCalled()
      const args = open.mock.calls[0]
      expect(args[0]).toBe('https://gh.example/pr/1')
      expect(args[1]).toBe('_blank')
    } finally {
      window.open = originalOpen
    }
  })

  it('clicks the backdrop to close', () => {
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps({ onClose })} />)
    fireEvent.click(screen.getByTestId('command-palette-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows N of M counter in footer', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByTestId('command-palette-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'canvas' } })
    const palette = screen.getByTestId('command-palette')
    expect(palette.textContent).toMatch(/1 of \d+/)
  })
})
