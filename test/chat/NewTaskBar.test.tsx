import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { signal } from '@preact/signals'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NewTaskBar } from '../../src/chat/NewTaskBar'
import { getVariantGroup, resetVariantGroupsForTests } from '../../src/groups/store'
import type { ConnectionStore } from '../../src/state/types'
import type {
  ApiDagGraph,
  ApiSession,
  CommandResult,
  CreateSessionRequest,
  CreateSessionVariantsRequest,
  CreateSessionVariantsResult,
  MinionCommand,
  VersionInfo,
} from '../../src/api/types'

type StubClient = {
  createSession: ReturnType<typeof vi.fn>
  createSessionVariants: ReturnType<typeof vi.fn>
  sendCommand: ReturnType<typeof vi.fn>
}

function makeSession(over: Partial<ApiSession> = {}): ApiSession {
  return {
    id: 's1',
    slug: 'brave-fox',
    status: 'pending',
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
  repos?: Array<{ alias: string; url: string }>
  createSessionImpl?: (req: CreateSessionRequest) => Promise<ApiSession>
  createVariantsImpl?: (req: CreateSessionVariantsRequest) => Promise<CreateSessionVariantsResult>
}): { store: ConnectionStore; client: StubClient } {
  const version: VersionInfo = {
    apiVersion: '1',
    libraryVersion: '1.111.0',
    features: opts.features ?? [],
    repos: opts.repos,
  }
  const client: StubClient = {
    createSession: vi
      .fn<(req: CreateSessionRequest) => Promise<ApiSession>>()
      .mockImplementation(opts.createSessionImpl ?? (async () => makeSession())),
    createSessionVariants: vi
      .fn<(req: CreateSessionVariantsRequest) => Promise<CreateSessionVariantsResult>>()
      .mockImplementation(
        opts.createVariantsImpl ??
          (async (req) => ({
            sessions: Array.from({ length: req.count }, (_, i) => ({
              sessionId: `sv-${i + 1}`,
              slug: `sv-${i + 1}`,
              threadId: 100 + i,
            })),
          }))
      ),
    sendCommand: vi.fn<(cmd: MinionCommand) => Promise<CommandResult>>(),
  }

  const store: ConnectionStore = {
    connectionId: 'test-conn',
    client: client as unknown as ConnectionStore['client'],
    sessions: signal<ApiSession[]>([]),
    dags: signal<ApiDagGraph[]>([]),
    status: signal('live'),
    reconnectAt: signal<number | null>(null),
    error: signal<string | null>(null),
    version: signal<VersionInfo | null>(version),
    stale: signal(false),
    diffStatsBySessionId: signal(new Map()),
    resourceSnapshot: signal(null),
    runtimeConfig: signal(null),
    loadDiffStats: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    sendCommand: vi.fn(async () => ({ success: true })),
    getTranscript: vi.fn(() => null),
    applySessionCreated: vi.fn(),
    applySessionDeleted: vi.fn(),
    refreshRuntimeConfig: vi.fn(async () => {}),
    updateRuntimeConfig: vi.fn(async () => {}),
    dispose: vi.fn(),
  }
  return { store, client }
}

describe('NewTaskBar', () => {
  beforeEach(() => {
    localStorage.clear()
    resetVariantGroupsForTests()
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
      })
    }
  })

  it('renders disabled gated bar when sessions-create feature is missing', () => {
    const { store, client } = makeStore({ features: [] })
    render(<NewTaskBar store={store} />)
    const bar = screen.getByTestId('new-task-bar')
    expect(bar.getAttribute('data-gated')).toBe('true')
    expect(bar.textContent).toContain('needs library ≥ 1.111')
    expect(screen.queryByTestId('new-task-prompt')).toBeNull()
    expect(client.createSession).not.toHaveBeenCalled()
  })

  it('renders base modes but not ship when ship-coordinator feature is missing', () => {
    const { store } = makeStore({ features: ['sessions-create'] })
    render(<NewTaskBar store={store} />)
    expect(screen.getByTestId('mode-task')).toBeTruthy()
    expect(screen.getByTestId('mode-plan')).toBeTruthy()
    expect(screen.getByTestId('mode-think')).toBeTruthy()
    expect(screen.queryByTestId('mode-ship')).toBeNull()
    expect(screen.getByTestId('mode-task').getAttribute('aria-checked')).toBe('true')
  })

  it('renders all four modes including ship when ship-coordinator feature is enabled', () => {
    const { store } = makeStore({ features: ['sessions-create', 'ship-coordinator'] })
    render(<NewTaskBar store={store} />)
    expect(screen.getByTestId('mode-task')).toBeTruthy()
    expect(screen.getByTestId('mode-plan')).toBeTruthy()
    expect(screen.getByTestId('mode-think')).toBeTruthy()
    expect(screen.getByTestId('mode-ship')).toBeTruthy()
    expect(screen.getByTestId('mode-task').getAttribute('aria-checked')).toBe('true')
  })

  it('switches the selected mode when a mode button is clicked', () => {
    const { store } = makeStore({ features: ['sessions-create'] })
    render(<NewTaskBar store={store} />)
    fireEvent.click(screen.getByTestId('mode-plan'))
    expect(screen.getByTestId('mode-plan').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('mode-task').getAttribute('aria-checked')).toBe('false')
    const textarea = screen.getByTestId('new-task-prompt') as HTMLTextAreaElement
    expect(textarea.placeholder).toContain('plan')
  })

  it('submits a structured createSession payload with prompt, mode, and repo', async () => {
    const { store, client } = makeStore({
      features: ['sessions-create'],
      repos: [
        { alias: 'primary', url: 'https://github.com/org/primary' },
        { alias: 'other', url: 'https://github.com/org/other' },
      ],
    })
    render(<NewTaskBar store={store} />)
    fireEvent.click(screen.getByTestId('mode-plan'))
    const textarea = screen.getByTestId('new-task-prompt') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: 'build the thing' } })
    fireEvent.click(screen.getByTestId('new-task-send'))

    await waitFor(() => expect(client.createSession).toHaveBeenCalled())
    expect(client.createSession).toHaveBeenCalledWith({
      prompt: 'build the thing',
      mode: 'plan',
      repo: 'primary',
    })
    expect(client.createSessionVariants).not.toHaveBeenCalled()
    await waitFor(() => expect(textarea.value).toBe(''))
  })

  it('optimistically inserts the created session via applySessionCreated when POST resolves', async () => {
    const created = makeSession({ id: 'created-1', slug: 'optimism' })
    const { store, client } = makeStore({
      features: ['sessions-create'],
      createSessionImpl: async () => created,
    })
    render(<NewTaskBar store={store} />)
    const textarea = screen.getByTestId('new-task-prompt') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: 'be snappy' } })
    fireEvent.click(screen.getByTestId('new-task-send'))

    await waitFor(() => expect(client.createSession).toHaveBeenCalled())
    await waitFor(() => expect(store.applySessionCreated).toHaveBeenCalledWith(created))
  })

  it('navigates to the new session route after single-task create resolves', async () => {
    const created = makeSession({ id: 'created-2', slug: 'brave-fox' })
    const { store } = makeStore({
      features: ['sessions-create'],
      createSessionImpl: async () => created,
    })
    const navigate = vi.fn<(hash: string) => void>()
    render(<NewTaskBar store={store} navigate={navigate} />)
    const textarea = screen.getByTestId('new-task-prompt') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: 'open thread after launch' } })
    fireEvent.click(screen.getByTestId('new-task-send'))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('#/s/brave-fox'))
  })

  it('omits repo field from payload when no repos are configured', async () => {
    const { store, client } = makeStore({ features: ['sessions-create'], repos: [] })
    render(<NewTaskBar store={store} />)
    const textarea = screen.getByTestId('new-task-prompt') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: 'no repo task' } })
    fireEvent.click(screen.getByTestId('new-task-send'))

    await waitFor(() => expect(client.createSession).toHaveBeenCalled())
    const payload = client.createSession.mock.calls[0][0] as CreateSessionRequest
    expect(payload.repo).toBeUndefined()
    expect(payload.prompt).toBe('no repo task')
    expect(payload.mode).toBe('task')
  })

  it('does not submit when prompt is empty or whitespace', () => {
    const { store, client } = makeStore({ features: ['sessions-create'] })
    render(<NewTaskBar store={store} />)
    const send = screen.getByTestId('new-task-send') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(send)
    expect(client.createSession).not.toHaveBeenCalled()
  })

  it('disables variant options >1 when sessions-variants feature is missing', () => {
    const { store } = makeStore({ features: ['sessions-create'] })
    render(<NewTaskBar store={store} />)
    expect((screen.getByTestId('variant-1') as HTMLOptionElement).disabled).toBe(false)
    expect((screen.getByTestId('variant-2') as HTMLOptionElement).disabled).toBe(true)
    expect((screen.getByTestId('variant-3') as HTMLOptionElement).disabled).toBe(true)
    expect((screen.getByTestId('variant-4') as HTMLOptionElement).disabled).toBe(true)
  })

  it('calls createSessionVariants and navigates to #/g/:groupId when count > 1', async () => {
    const { store, client } = makeStore({
      features: ['sessions-create', 'sessions-variants'],
      repos: [{ alias: 'primary', url: 'https://github.com/org/primary' }],
    })
    const navigate = vi.fn<(hash: string) => void>()
    render(<NewTaskBar store={store} navigate={navigate} generateGroupId={() => 'g-xyz'} />)
    fireEvent.change(screen.getByTestId('variant-count'), { target: { value: '3' } })
    const textarea = screen.getByTestId('new-task-prompt') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: 'split it' } })
    fireEvent.click(screen.getByTestId('new-task-send'))

    await waitFor(() => expect(client.createSessionVariants).toHaveBeenCalled())
    expect(client.createSessionVariants).toHaveBeenCalledWith({
      prompt: 'split it',
      mode: 'task',
      repo: 'primary',
      count: 3,
    })
    expect(client.createSession).not.toHaveBeenCalled()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('#/g/g-xyz'))
  })

  it('shows server error when createSession rejects', async () => {
    const { store } = makeStore({
      features: ['sessions-create'],
      createSessionImpl: async () => {
        throw new Error('bad request')
      },
    })
    render(<NewTaskBar store={store} />)
    const textarea = screen.getByTestId('new-task-prompt') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: 'oops' } })
    fireEvent.click(screen.getByTestId('new-task-send'))

    const err = await screen.findByTestId('new-task-error')
    expect(err.textContent).toContain('bad request')
  })

  it('records the variant group client-side on successful variant creation', async () => {
    const { store } = makeStore({
      features: ['sessions-create', 'sessions-variants'],
      repos: [{ alias: 'primary', url: 'https://github.com/org/primary' }],
    })
    const navigate = vi.fn<(hash: string) => void>()
    render(<NewTaskBar store={store} navigate={navigate} generateGroupId={() => 'g-xyz'} />)
    fireEvent.change(screen.getByTestId('variant-count'), { target: { value: '2' } })
    const textarea = screen.getByTestId('new-task-prompt') as HTMLTextAreaElement
    fireEvent.input(textarea, { target: { value: 'compare approaches' } })
    fireEvent.click(screen.getByTestId('new-task-send'))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    const recorded = getVariantGroup('test-conn', 'g-xyz')
    expect(recorded).not.toBeNull()
    expect(recorded?.prompt).toBe('compare approaches')
    expect(recorded?.mode).toBe('task')
    expect(recorded?.repo).toBe('primary')
    expect(recorded?.variantSessionIds).toEqual(['sv-1', 'sv-2'])
  })

  it('Launch button label reflects variant count', async () => {
    const { store } = makeStore({
      features: ['sessions-create', 'sessions-variants'],
    })
    render(<NewTaskBar store={store} />)
    expect(screen.getByTestId('new-task-send').textContent).toBe('Launch')
    fireEvent.change(screen.getByTestId('variant-count'), { target: { value: '4' } })
    expect(screen.getByTestId('new-task-send').textContent).toBe('Launch ×4')
  })
})
