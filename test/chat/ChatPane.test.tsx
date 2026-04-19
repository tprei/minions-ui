import { render, screen, fireEvent, within } from '@testing-library/preact'
import { describe, it, expect, vi } from 'vitest'
import { ChatPane } from '../../src/chat/ChatPane'
import type { ApiSession, ApiDagGraph, ApiDagNode } from '../../src/api/types'

function makeSession(over: Partial<ApiSession> = {}): ApiSession {
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

function makeDagNode(over: Partial<ApiDagNode> & Pick<ApiDagNode, 'id' | 'slug'>): ApiDagNode {
  return {
    status: 'pending',
    dependencies: [],
    dependents: [],
    ...over,
  }
}

function renderPane(
  session: ApiSession,
  sessions: ApiSession[] = [session],
  dags: ApiDagGraph[] = [],
  overrides: Partial<Parameters<typeof ChatPane>[0]> = {},
) {
  const onNavigate = vi.fn()
  const onSend = vi.fn().mockResolvedValue(undefined)
  const onCommand = vi.fn().mockResolvedValue(undefined)
  const result = render(
    <ChatPane
      session={session}
      sessions={sessions}
      dags={dags}
      onNavigate={onNavigate}
      onSend={onSend}
      onCommand={onCommand}
      {...overrides}
    />,
  )
  return { ...result, onNavigate, onSend, onCommand }
}

describe('ChatPane header', () => {
  describe('branch chip', () => {
    it('renders branch name when session.branch is set', () => {
      renderPane(makeSession({ branch: 'feat/improve-dag' }))
      const chip = screen.getByTestId('chat-branch-chip')
      expect(chip.textContent).toContain('feat/improve-dag')
    })

    it('does not render branch chip when session.branch is missing', () => {
      renderPane(makeSession({ branch: undefined }))
      expect(screen.queryByTestId('chat-branch-chip')).toBeNull()
    })
  })

  describe('parent chip', () => {
    it('renders and navigates to parent when clicked', () => {
      const parent = makeSession({ id: 'p1', slug: 'wise-owl', status: 'completed' })
      const child = makeSession({ id: 's1', slug: 'brave-fox', parentId: 'p1' })
      const { onNavigate } = renderPane(child, [parent, child])
      const chip = screen.getByTestId('chat-parent-chip')
      expect(chip.textContent).toContain('wise-owl')
      fireEvent.click(chip)
      expect(onNavigate).toHaveBeenCalledWith('p1')
    })

    it('does not render when session has no parentId', () => {
      renderPane(makeSession({ parentId: undefined }))
      expect(screen.queryByTestId('chat-parent-chip')).toBeNull()
    })

    it('does not render when parentId references a missing session', () => {
      const child = makeSession({ parentId: 'ghost' })
      renderPane(child, [child])
      expect(screen.queryByTestId('chat-parent-chip')).toBeNull()
    })
  })

  describe('children chip', () => {
    it('shows singular "1 child" for one child', () => {
      const parent = makeSession({ id: 's1', childIds: ['c1'] })
      const c1 = makeSession({ id: 'c1', slug: 'sly-cat' })
      renderPane(parent, [parent, c1])
      expect(screen.getByTestId('chat-children-chip').textContent).toContain('1 child')
    })

    it('pluralizes "N children" for more than one child', () => {
      const parent = makeSession({ id: 's1', childIds: ['c1', 'c2'] })
      const c1 = makeSession({ id: 'c1', slug: 'sly-cat' })
      const c2 = makeSession({ id: 'c2', slug: 'swift-dog' })
      renderPane(parent, [parent, c1, c2])
      expect(screen.getByTestId('chat-children-chip').textContent).toContain('2 children')
    })

    it('opens a menu of children and navigates when a child is clicked', () => {
      const parent = makeSession({ id: 's1', childIds: ['c1', 'c2'] })
      const c1 = makeSession({ id: 'c1', slug: 'sly-cat', status: 'completed' })
      const c2 = makeSession({ id: 'c2', slug: 'swift-dog', status: 'failed' })
      const { onNavigate } = renderPane(parent, [parent, c1, c2])

      expect(screen.queryByTestId('chat-children-menu')).toBeNull()
      fireEvent.click(screen.getByTestId('chat-children-chip'))

      const menu = screen.getByTestId('chat-children-menu')
      expect(within(menu).getByText('sly-cat')).toBeTruthy()
      expect(within(menu).getByText('swift-dog')).toBeTruthy()

      fireEvent.click(screen.getByTestId('chat-children-item-c2'))
      expect(onNavigate).toHaveBeenCalledWith('c2')
      expect(screen.queryByTestId('chat-children-menu')).toBeNull()
    })

    it('skips child ids that reference missing sessions', () => {
      const parent = makeSession({ id: 's1', childIds: ['missing'] })
      renderPane(parent, [parent])
      expect(screen.queryByTestId('chat-children-chip')).toBeNull()
    })
  })

  describe('DAG breadcrumb', () => {
    const dag: ApiDagGraph = {
      id: 'dag-1',
      rootTaskId: 'root',
      status: 'running',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      nodes: {
        root: makeDagNode({ id: 'root', slug: 'ship-feature', status: 'completed', dependents: ['s1'] }),
        s1: makeDagNode({ id: 's1', slug: 'brave-fox', status: 'running', dependencies: ['root'], dependents: ['n2'] }),
        n2: makeDagNode({ id: 'n2', slug: 'next-step', status: 'pending', dependencies: ['s1'] }),
      },
    }

    it('shows the DAG breadcrumb with root slug and position counter', () => {
      renderPane(makeSession(), [makeSession()], [dag])
      const bc = screen.getByTestId('chat-dag-breadcrumb')
      expect(bc.textContent).toContain('ship-feature')
      expect(bc.textContent).toContain('2/3')
    })

    it('opens a menu of dependencies and navigates when clicked', () => {
      const { onNavigate } = renderPane(makeSession(), [makeSession()], [dag])
      fireEvent.click(screen.getByTestId('chat-dag-breadcrumb'))
      const menu = screen.getByTestId('chat-dag-menu')
      expect(within(menu).getByText('ship-feature')).toBeTruthy()
      expect(within(menu).getByText('next-step')).toBeTruthy()

      fireEvent.click(screen.getByTestId('chat-dag-dep-root'))
      expect(onNavigate).toHaveBeenCalledWith('root')
    })

    it('is disabled (no menu) when the node has no dependencies or dependents', () => {
      const isolated: ApiDagGraph = {
        ...dag,
        nodes: {
          s1: makeDagNode({ id: 's1', slug: 'brave-fox', status: 'running' }),
        },
        rootTaskId: 's1',
      }
      renderPane(makeSession(), [makeSession()], [isolated])
      const bc = screen.getByTestId('chat-dag-breadcrumb')
      expect((bc as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(bc)
      expect(screen.queryByTestId('chat-dag-menu')).toBeNull()
    })

    it('does not render when session is not part of any DAG', () => {
      renderPane(makeSession({ id: 'solo' }), [makeSession({ id: 'solo' })], [dag])
      expect(screen.queryByTestId('chat-dag-breadcrumb')).toBeNull()
    })
  })

  describe('hierarchy row', () => {
    it('is not rendered when session has no parent, children, or DAG', () => {
      renderPane(makeSession())
      expect(screen.queryByTestId('chat-hierarchy-row')).toBeNull()
    })

    it('is rendered when any hierarchy signal is present', () => {
      const parent = makeSession({ id: 'p', slug: 'root' })
      const child = makeSession({ id: 's1', parentId: 'p' })
      renderPane(child, [parent, child])
      expect(screen.getByTestId('chat-hierarchy-row')).toBeTruthy()
    })
  })
})
