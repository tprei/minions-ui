import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VariantGroupView } from '../../src/groups/VariantGroupView'
import {
  recordVariantGroup,
  getVariantGroup,
  resetVariantGroupsForTests,
} from '../../src/groups/store'
import { ConfirmRoot } from '../../src/hooks/useConfirm'
import type { ConnectionStore } from '../../src/state/types'
import type {
  ApiDagGraph,
  ApiSession,
  CommandResult,
  MinionCommand,
  VersionInfo,
} from '../../src/api/types'
import type { VariantGroup } from '../../src/groups/types'

function session(over: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 's1',
    slug: 'brave-fox',
    status: 'running',
    command: '/task x',
    createdAt: '2026-04-19T00:00:00Z',
    updatedAt: '2026-04-19T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...over,
  }
}

function makeStore(opts: {
  features?: string[]
  sessions?: ApiSession[]
  sendCommandImpl?: (cmd: MinionCommand) => Promise<CommandResult>
} = {}): ConnectionStore {
  const version: VersionInfo = {
    apiVersion: '1',
    libraryVersion: '1.111.0',
    features: opts.features ?? ['sessions-create', 'sessions-variants'],
  }
  return {
    connectionId: 'conn-test',
    client: {} as ConnectionStore['client'],
    sessions: signal<ApiSession[]>(opts.sessions ?? []),
    dags: signal<ApiDagGraph[]>([]),
    status: signal('live'),
    error: signal<string | null>(null),
    version: signal<VersionInfo | null>(version),
    stale: signal(false),
    diffStatsBySessionId: signal(new Map()),
    loadDiffStats: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    sendCommand: vi
      .fn<(cmd: MinionCommand) => Promise<CommandResult>>()
      .mockImplementation(opts.sendCommandImpl ?? (async () => ({ success: true }))),
    dispose: vi.fn(),
  }
}

function exampleGroup(over: Partial<VariantGroup> = {}): VariantGroup {
  return {
    groupId: 'g-xyz',
    prompt: 'ship the feature',
    mode: 'task',
    variantSessionIds: ['sv-1', 'sv-2', 'sv-3'],
    createdAt: '2026-04-19T00:00:00Z',
    ...over,
  }
}

describe('VariantGroupView', () => {
  beforeEach(() => {
    resetVariantGroupsForTests()
    localStorage.clear()
  })

  afterEach(() => {
    resetVariantGroupsForTests()
    localStorage.clear()
  })

  it('renders gated message when sessions-variants feature is missing', () => {
    const store = makeStore({ features: ['sessions-create'] })
    recordVariantGroup('conn-test', exampleGroup())
    render(<VariantGroupView store={store} groupId="g-xyz" />)
    expect(screen.getByTestId('variant-group-gated')).toBeTruthy()
    expect(screen.getByTestId('variant-group-gated').textContent).toContain('Needs library ≥ 1.111')
  })

  it('renders a friendly missing state when the group is unknown', () => {
    const store = makeStore()
    render(<VariantGroupView store={store} groupId="g-nope" />)
    expect(screen.getByTestId('variant-group-missing')).toBeTruthy()
    expect(screen.getByTestId('variant-group-missing').textContent).toContain('g-nope')
  })

  it('renders header with prompt, mode, repo and variant count', () => {
    const store = makeStore()
    recordVariantGroup(
      'conn-test',
      exampleGroup({ repo: 'primary', mode: 'plan', prompt: 'build auth service' })
    )
    render(<VariantGroupView store={store} groupId="g-xyz" />)
    const header = screen.getByTestId('variant-group-header')
    expect(header.textContent).toContain('plan')
    expect(header.textContent).toContain('primary')
    expect(header.textContent).toContain('×3')
    expect(screen.getByTestId('variant-group-prompt').textContent).toBe('build auth service')
  })

  it('renders one column per variant id with session status when available', () => {
    const sessions = [
      session({ id: 'sv-1', slug: 'brave-fox', status: 'running' }),
      session({ id: 'sv-2', slug: 'swift-cat', status: 'completed' }),
    ]
    const store = makeStore({ sessions })
    recordVariantGroup(
      'conn-test',
      exampleGroup({ variantSessionIds: ['sv-1', 'sv-2', 'sv-3'] })
    )
    render(<VariantGroupView store={store} groupId="g-xyz" />)
    expect(screen.getByTestId('variant-column-sv-1')).toBeTruthy()
    expect(screen.getByTestId('variant-column-sv-2')).toBeTruthy()
    expect(screen.getByTestId('variant-column-sv-3')).toBeTruthy()

    const col1 = screen.getByTestId('variant-column-sv-1')
    expect(within(col1).getByText('brave-fox')).toBeTruthy()
    expect(within(col1).getByText('running')).toBeTruthy()

    const col3 = screen.getByTestId('variant-column-sv-3')
    expect(col3.textContent).toContain('waiting')
    const pickBtn3 = within(col3).getByTestId('variant-pick-sv-3') as HTMLButtonElement
    expect(pickBtn3.disabled).toBe(true)
  })

  it('pick-winner stops and closes siblings, marks winner, and navigates to the session route', async () => {
    const sessions = [
      session({ id: 'sv-1', slug: 'brave-fox', status: 'running' }),
      session({ id: 'sv-2', slug: 'swift-cat', status: 'running' }),
      session({ id: 'sv-3', slug: 'quiet-owl', status: 'pending' }),
    ]
    const store = makeStore({ sessions })
    const navigate = vi.fn<(hash: string) => void>()
    recordVariantGroup(
      'conn-test',
      exampleGroup({ variantSessionIds: ['sv-1', 'sv-2', 'sv-3'] })
    )

    render(
      <>
        <VariantGroupView store={store} groupId="g-xyz" navigate={navigate} />
        <ConfirmRoot />
      </>
    )

    fireEvent.click(screen.getByTestId('variant-pick-sv-2'))
    await screen.findByRole('dialog')
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('Pick winner'))

    await waitFor(() => expect(store.sendCommand).toHaveBeenCalled())
    const calls = (store.sendCommand as unknown as { mock: { calls: [MinionCommand][] } }).mock.calls.map((c) => c[0])
    const stopTargets = calls.filter((c) => c.action === 'stop').map((c) => c.sessionId)
    const closeTargets = calls.filter((c) => c.action === 'close').map((c) => c.sessionId)
    expect(stopTargets.sort()).toEqual(['sv-1', 'sv-3'])
    expect(closeTargets.sort()).toEqual(['sv-1', 'sv-3'])
    expect(stopTargets).not.toContain('sv-2')
    expect(closeTargets).not.toContain('sv-2')

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('#/s/swift-cat'))

    const after = getVariantGroup('conn-test', 'g-xyz')
    expect(after?.winnerId).toBe('sv-2')
  })

  it('pick-winner aborts when the confirm modal is cancelled', async () => {
    const sessions = [
      session({ id: 'sv-1', slug: 'brave-fox', status: 'running' }),
      session({ id: 'sv-2', slug: 'swift-cat', status: 'running' }),
    ]
    const store = makeStore({ sessions })
    const navigate = vi.fn<(hash: string) => void>()
    recordVariantGroup(
      'conn-test',
      exampleGroup({ variantSessionIds: ['sv-1', 'sv-2'] })
    )

    render(
      <>
        <VariantGroupView store={store} groupId="g-xyz" navigate={navigate} />
        <ConfirmRoot />
      </>
    )

    fireEvent.click(screen.getByTestId('variant-pick-sv-1'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText('Cancel'))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(store.sendCommand).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(getVariantGroup('conn-test', 'g-xyz')?.winnerId).toBeUndefined()
  })

  it('pick-winner skips commands for terminal siblings', async () => {
    const sessions = [
      session({ id: 'sv-1', slug: 'brave-fox', status: 'completed' }),
      session({ id: 'sv-2', slug: 'swift-cat', status: 'running' }),
    ]
    const store = makeStore({ sessions })
    const navigate = vi.fn<(hash: string) => void>()
    recordVariantGroup(
      'conn-test',
      exampleGroup({ variantSessionIds: ['sv-1', 'sv-2'] })
    )

    render(
      <>
        <VariantGroupView store={store} groupId="g-xyz" navigate={navigate} />
        <ConfirmRoot />
      </>
    )

    fireEvent.click(screen.getByTestId('variant-pick-sv-2'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText('Pick winner'))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(store.sendCommand).not.toHaveBeenCalled()
    expect(getVariantGroup('conn-test', 'g-xyz')?.winnerId).toBe('sv-2')
  })

  it('locks out subsequent pick-winner clicks once a winner is set', () => {
    const sessions = [
      session({ id: 'sv-1', slug: 'brave-fox', status: 'running' }),
      session({ id: 'sv-2', slug: 'swift-cat', status: 'running' }),
    ]
    const store = makeStore({ sessions })
    recordVariantGroup(
      'conn-test',
      exampleGroup({ variantSessionIds: ['sv-1', 'sv-2'], winnerId: 'sv-1' })
    )

    render(<VariantGroupView store={store} groupId="g-xyz" />)

    const winnerBtn = screen.getByTestId('variant-pick-sv-1') as HTMLButtonElement
    const loserBtn = screen.getByTestId('variant-pick-sv-2') as HTMLButtonElement
    expect(winnerBtn.textContent).toBe('Winner')
    expect(winnerBtn.disabled).toBe(true)
    expect(loserBtn.disabled).toBe(true)
    expect(screen.getByTestId('variant-column-sv-1').getAttribute('data-winner')).toBe('true')
  })

  it('navigates to the session when the column title is clicked', () => {
    const sessions = [session({ id: 'sv-1', slug: 'brave-fox', status: 'running' })]
    const store = makeStore({ sessions })
    const navigate = vi.fn<(hash: string) => void>()
    recordVariantGroup(
      'conn-test',
      exampleGroup({ variantSessionIds: ['sv-1'] })
    )

    render(<VariantGroupView store={store} groupId="g-xyz" navigate={navigate} />)

    fireEvent.click(screen.getByTestId('variant-open-sv-1'))
    expect(navigate).toHaveBeenCalledWith('#/s/brave-fox')
  })
})
