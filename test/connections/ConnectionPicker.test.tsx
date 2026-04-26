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

const matchMediaMock = vi.fn()

function setMobileViewport(mobile: boolean) {
  matchMediaMock.mockImplementation((query: string) => ({
    matches: mobile && query === '(max-width: 767px)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

describe('ConnectionPicker', () => {
  beforeEach(() => {
    vi.resetModules()
    document.documentElement.style.removeProperty('--accent')
    setMobileViewport(false)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
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

  describe('mobile bottom sheet', () => {
    beforeEach(() => {
      setMobileViewport(true)
    })

    it('renders bottom sheet with backdrop on mobile', async () => {
      await setup()
      const trigger = screen.getByTestId('connection-picker-trigger')
      fireEvent.click(trigger)

      expect(screen.getByTestId('picker-backdrop')).toBeTruthy()
      expect(screen.getByTestId('connection-picker-dropdown')).toBeTruthy()
      expect(screen.getByTestId('drag-handle')).toBeTruthy()
    })

    it('clicking backdrop closes bottom sheet', async () => {
      await setup()
      fireEvent.click(screen.getByTestId('connection-picker-trigger'))
      expect(screen.getByTestId('picker-backdrop')).toBeTruthy()

      fireEvent.click(screen.getByTestId('picker-backdrop'))
      expect(screen.queryByTestId('picker-backdrop')).toBeNull()
    })

    it('selecting connection closes bottom sheet on mobile', async () => {
      await setup()
      const { setActive } = await import('../../src/connections/store')
      fireEvent.click(screen.getByTestId('connection-picker-trigger'))
      fireEvent.click(screen.getByTestId('picker-option-c2'))

      expect(setActive).toHaveBeenCalledWith('c2')
      expect(screen.queryByTestId('picker-backdrop')).toBeNull()
    })

    it('manage button closes bottom sheet and calls onManage', async () => {
      const { onManage } = await setup()
      fireEvent.click(screen.getByTestId('connection-picker-trigger'))
      fireEvent.click(screen.getByTestId('picker-manage-btn'))

      expect(onManage).toHaveBeenCalled()
      expect(screen.queryByTestId('picker-backdrop')).toBeNull()
    })

    it('Escape key closes bottom sheet on mobile', async () => {
      await setup()
      fireEvent.click(screen.getByTestId('connection-picker-trigger'))
      expect(screen.getByTestId('picker-backdrop')).toBeTruthy()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByTestId('picker-backdrop')).toBeNull()
    })
  })
})
