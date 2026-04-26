import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { UniverseCanvas } from '../../src/components/UniverseCanvas'
import type { ApiSession } from '../../src/api/types'

vi.mock('@reactflow/core', async () => {
  return {
    ReactFlow: vi.fn(({ nodes, nodeTypes, children, minZoom, maxZoom }) => {
      return (
        <div
          data-testid="react-flow"
          data-node-count={nodes?.length || 0}
          data-min-zoom={minZoom}
          data-max-zoom={maxZoom}
        >
          {nodes?.map((n: { id: string; type: string; data: Record<string, unknown> }) => {
            const Comp = nodeTypes?.[n.type]
            return Comp ? (
              <div key={n.id} data-testid={`flow-node-${n.id}`}>
                <Comp data={n.data} />
              </div>
            ) : (
              <div key={n.id} data-testid={`flow-node-${n.id}`}>
                {String(n.data?.label ?? n.id)}
              </div>
            )
          })}
          {children}
        </div>
      )
    }),
    ReactFlowProvider: vi.fn(({ children }) => <>{children}</>),
    useReactFlow: vi.fn(() => ({
      setCenter: vi.fn(),
      fitBounds: vi.fn(),
      fitView: vi.fn(),
    })),
    useNodesState: vi.fn((initial: unknown[]) => [initial, vi.fn(), vi.fn()]),
    useEdgesState: vi.fn((initial: unknown[]) => [initial, vi.fn(), vi.fn()]),
    MarkerType: { ArrowClosed: 'arrowClosed' },
    Handle: vi.fn(() => null),
    Position: { Top: 'top', Bottom: 'bottom' },
  }
})

vi.mock('@reactflow/background', () => ({
  Background: vi.fn(() => <div data-testid="background" />),
}))

vi.mock('@reactflow/controls', () => ({
  Controls: vi.fn(() => <div data-testid="controls" />),
}))

vi.mock('@reactflow/minimap', () => ({
  MiniMap: vi.fn(() => <div data-testid="minimap" />),
}))

vi.mock('dagre', () => {
  function MockGraph(this: {
    setDefaultEdgeLabel: ReturnType<typeof vi.fn>
    setGraph: ReturnType<typeof vi.fn>
    setNode: ReturnType<typeof vi.fn>
    setEdge: ReturnType<typeof vi.fn>
    node: ReturnType<typeof vi.fn>
    graph: ReturnType<typeof vi.fn>
  }) {
    this.setDefaultEdgeLabel = vi.fn()
    this.setGraph = vi.fn()
    this.setNode = vi.fn()
    this.setEdge = vi.fn()
    this.node = vi.fn(() => ({ x: 100, y: 100 }))
    this.graph = vi.fn(() => ({ width: 400, height: 300 }))
  }

  return {
    default: {
      graphlib: { Graph: MockGraph },
      layout: vi.fn(),
    },
  }
})

const mockVibrate = vi.fn()
vi.mock('../../src/hooks/useHaptics', () => ({
  useHaptics: () => ({
    vibrate: mockVibrate,
    supported: true,
  }),
}))

function createSession(overrides: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 'session-1',
    slug: 'bold-meadow',
    status: 'running',
    command: '/task Add feature',
    repo: 'https://github.com/org/repo',
    branch: 'feature-branch',
    threadId: 123,
    chatId: -1001234567890,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

const defaultProps = {
  sessions: [] as ApiSession[],
  dags: [],
  isLoading: false,
  onSendReply: vi.fn().mockResolvedValue(undefined),
  onStopMinion: vi.fn().mockResolvedValue(undefined),
  onCloseSession: vi.fn().mockResolvedValue(undefined),
  onOpenThread: vi.fn(),
  isActionLoading: false,
}

describe('UniverseCanvas Mobile Improvements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Fit-to-screen FAB', () => {
    it('renders FAB button', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const fab = document.querySelector('[data-testid="fit-to-screen-fab"]')
      expect(fab).toBeTruthy()
    })

    it('FAB triggers haptic feedback on click', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const fab = document.querySelector('[data-testid="fit-to-screen-fab"]')
      if (fab) {
        fireEvent.click(fab)
        expect(mockVibrate).toHaveBeenCalledWith('light')
      }
    })

    it('FAB has accessible label', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const fab = document.querySelector('[data-testid="fit-to-screen-fab"]')
      expect(fab?.getAttribute('aria-label')).toBe('Fit to screen')
    })

    it('FAB shows expand icon', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const fab = document.querySelector('[data-testid="fit-to-screen-fab"]')
      const svg = fab?.querySelector('svg')
      expect(svg).toBeTruthy()
      expect(svg?.getAttribute('width')).toBe('24')
      expect(svg?.getAttribute('height')).toBe('24')
    })

    it('FAB has shadow for elevation', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const fab = document.querySelector('[data-testid="fit-to-screen-fab"]') as HTMLElement
      expect(fab.style.boxShadow).toContain('rgba')
    })
  })

  describe('Responsive node scaling', () => {
    it('applies scale factor to node data', async () => {
      const mockModule = await import('@reactflow/core')
      const sessions = [createSession({ id: 's1', slug: 'scaled' })]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)

      const calls = vi.mocked(mockModule.ReactFlow).mock.calls
      const lastCall = calls[calls.length - 1]
      const nodes = lastCall[0].nodes

      expect(nodes).toBeDefined()
      expect(nodes.length).toBeGreaterThan(0)
      expect(nodes[0].data.scale).toBeDefined()
      expect(typeof nodes[0].data.scale).toBe('number')
    })

    it('scale is within valid range', async () => {
      const mockModule = await import('@reactflow/core')
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)

      const calls = vi.mocked(mockModule.ReactFlow).mock.calls
      const lastCall = calls[calls.length - 1]
      const nodes = lastCall[0].nodes

      if (nodes && nodes.length > 0) {
        const scale = nodes[0].data.scale
        expect(scale).toBeGreaterThan(0)
        expect(scale).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('Improved zoom controls', () => {
    it('disables double-click zoom', async () => {
      const mockModule = await import('@reactflow/core')
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)

      const calls = vi.mocked(mockModule.ReactFlow).mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall[0].zoomOnDoubleClick).toBe(false)
    })

    it('enables pinch zoom', async () => {
      const mockModule = await import('@reactflow/core')
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)

      const calls = vi.mocked(mockModule.ReactFlow).mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall[0].zoomOnPinch).toBe(true)
    })

    it('sets appropriate zoom limits', async () => {
      const mockModule = await import('@reactflow/core')
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)

      const calls = vi.mocked(mockModule.ReactFlow).mock.calls
      const lastCall = calls[calls.length - 1]
      const { minZoom, maxZoom } = lastCall[0]

      expect(minZoom).toBeGreaterThan(0)
      expect(maxZoom).toBeGreaterThan(minZoom)
      expect(maxZoom).toBeLessThanOrEqual(2)
    })
  })

  describe('Haptic feedback', () => {
    it('triggers haptic on node long-press', () => {
      const sessions = [createSession({ id: 's1', slug: 'haptic-test' })]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)

      const node = document.querySelector('[data-testid="universe-node-s1"]')
      if (node) {
        fireEvent.contextMenu(node.parentElement!)
        expect(mockVibrate).toHaveBeenCalledWith('medium')
      }
    })
  })

  describe('Touch interactions', () => {
    it('FAB responds to touch events', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const fab = document.querySelector('[data-testid="fit-to-screen-fab"]') as HTMLElement

      if (fab) {
        fireEvent.touchStart(fab)
        expect(fab.style.transform).toBe('scale(0.95)')

        fireEvent.touchEnd(fab)
        expect(fab.style.transform).toBe('scale(1)')
      }
    })

    it('FAB responds to mouse events', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const fab = document.querySelector('[data-testid="fit-to-screen-fab"]') as HTMLElement

      if (fab) {
        fireEvent.mouseDown(fab)
        expect(fab.style.transform).toBe('scale(0.95)')

        fireEvent.mouseUp(fab)
        expect(fab.style.transform).toBe('scale(1)')
      }
    })

    it('FAB resets scale on mouse leave', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const fab = document.querySelector('[data-testid="fit-to-screen-fab"]') as HTMLElement

      if (fab) {
        fireEvent.mouseDown(fab)
        expect(fab.style.transform).toBe('scale(0.95)')

        fireEvent.mouseLeave(fab)
        expect(fab.style.transform).toBe('scale(1)')
      }
    })
  })

  describe('Canvas positioning', () => {
    it('canvas container has relative positioning for FAB', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const canvas = document.querySelector('[data-testid="universe-canvas"]') as HTMLElement
      expect(canvas.style.position).toBe('relative')
    })

    it('FAB has higher z-index than canvas', () => {
      const sessions = [createSession()]
      render(<UniverseCanvas {...defaultProps} sessions={sessions} />)
      const fab = document.querySelector('[data-testid="fit-to-screen-fab"]') as HTMLElement
      expect(fab.style.zIndex).toBe('5')
    })
  })
})
