import { render, screen, fireEvent } from '@testing-library/preact'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/connections/store', async () => {
  const { signal } = await import('@preact/signals')
  const connections = signal([
    { id: 'c1', label: 'Alpha', baseUrl: 'https://a.example.com', token: 'ta', color: '#3b82f6' },
    { id: 'c2', label: 'Beta', baseUrl: 'https://b.example.com', token: 'tb', color: '#10b981' },
  ])
  const activeId = signal<string | null>('c1')
  const setActive = vi.fn((id: string | null) => {
    activeId.value = id
  })
  return { connections, activeId, setActive }
})

vi.mock('../../src/hooks/useHaptics', () => ({
  useHaptics: () => ({
    vibrate: vi.fn(),
    supported: true,
  }),
}))

vi.mock('../../src/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({ current: null }),
}))

describe('ConnectionPicker', () => {
  beforeEach(() => {
    vi.resetModules()
    document.documentElement.style.removeProperty('--accent')
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('min-width: 768px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  async function setup() {
    const { ConnectionPicker } = await import('../../src/connections/ConnectionPicker')
    const onManage = vi.fn()
    render(<ConnectionPicker onManage={onManage} />)
    return { onManage }
  }

  it('trigger button is visible with active connection label', async () => {
    await setup()
    expect(screen.getByTestId('connection-picker-trigger')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('click opens dropdown, Escape closes it', async () => {
    await setup()
    const trigger = screen.getByTestId('connection-picker-trigger')

    fireEvent.click(trigger)
    expect(screen.getByTestId('connection-picker-dropdown')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('connection-picker-dropdown')).toBeNull()
  })

  it('click outside closes dropdown', async () => {
    await setup()
    const trigger = screen.getByTestId('connection-picker-trigger')
    fireEvent.click(trigger)
    expect(screen.getByTestId('connection-picker-dropdown')).toBeTruthy()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('connection-picker-dropdown')).toBeNull()
  })

  it('clicking an option calls setActive and closes', async () => {
    await setup()
    const { setActive } = await import('../../src/connections/store')
    fireEvent.click(screen.getByTestId('connection-picker-trigger'))
    fireEvent.click(screen.getByTestId('picker-option-c2'))
    expect(setActive).toHaveBeenCalledWith('c2')
    expect(screen.queryByTestId('connection-picker-dropdown')).toBeNull()
  })

  it('"Manage connections" footer calls onManage and closes dropdown', async () => {
    const { onManage } = await setup()
    fireEvent.click(screen.getByTestId('connection-picker-trigger'))
    fireEvent.click(screen.getByTestId('picker-manage-btn'))
    expect(onManage).toHaveBeenCalled()
    expect(screen.queryByTestId('connection-picker-dropdown')).toBeNull()
  })

  it('ArrowDown moves focus, Enter selects', async () => {
    await setup()
    const { setActive } = await import('../../src/connections/store')
    fireEvent.click(screen.getByTestId('connection-picker-trigger'))

    const options = screen.getAllByRole('option')
    options[0].focus()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(setActive).toHaveBeenCalled()
  })
})

describe('ConnectionPicker (mobile)', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: !query.includes('min-width: 768px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  async function setup() {
    const { ConnectionPicker } = await import('../../src/connections/ConnectionPicker')
    const onManage = vi.fn()
    render(<ConnectionPicker onManage={onManage} />)
    return { onManage }
  }

  it('shows bottom sheet instead of dropdown on mobile', async () => {
    await setup()
    const trigger = screen.getByTestId('connection-picker-trigger')

    fireEvent.click(trigger)

    expect(screen.queryByTestId('connection-picker-dropdown')).toBeNull()
    expect(screen.getByTestId('connection-picker-sheet')).toBeTruthy()
  })

  it('shows backdrop on mobile', async () => {
    await setup()
    const trigger = screen.getByTestId('connection-picker-trigger')

    fireEvent.click(trigger)

    expect(screen.getByTestId('picker-backdrop')).toBeTruthy()
  })

  it('clicking backdrop closes bottom sheet', async () => {
    await setup()
    const trigger = screen.getByTestId('connection-picker-trigger')

    fireEvent.click(trigger)
    expect(screen.getByTestId('connection-picker-sheet')).toBeTruthy()

    fireEvent.click(screen.getByTestId('picker-backdrop'))
    expect(screen.queryByTestId('connection-picker-sheet')).toBeNull()
  })

  it('selecting connection in bottom sheet closes it', async () => {
    await setup()
    const { setActive } = await import('../../src/connections/store')
    const trigger = screen.getByTestId('connection-picker-trigger')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('picker-option-c2'))

    expect(setActive).toHaveBeenCalledWith('c2')
    expect(screen.queryByTestId('connection-picker-sheet')).toBeNull()
  })

  it('manage button in bottom sheet closes it', async () => {
    const { onManage } = await setup()
    const trigger = screen.getByTestId('connection-picker-trigger')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('picker-manage-btn'))

    expect(onManage).toHaveBeenCalled()
    expect(screen.queryByTestId('connection-picker-sheet')).toBeNull()
  })

  it('Escape key closes bottom sheet on mobile', async () => {
    await setup()
    const trigger = screen.getByTestId('connection-picker-trigger')

    fireEvent.click(trigger)
    expect(screen.getByTestId('connection-picker-sheet')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('connection-picker-sheet')).toBeNull()
  })

  it('shows handle/grip element in bottom sheet', async () => {
    await setup()
    const trigger = screen.getByTestId('connection-picker-trigger')

    fireEvent.click(trigger)

    const sheet = screen.getByTestId('connection-picker-sheet')
    const grip = sheet.querySelector('.w-10.h-1.rounded-full')
    expect(grip).toBeTruthy()
  })
})
