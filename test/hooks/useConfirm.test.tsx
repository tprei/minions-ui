import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup, act } from '@testing-library/preact'

afterEach(() => {
  cleanup()
  vi.resetModules()
})

async function getModule() {
  const mod = await import('../../src/hooks/useConfirm')
  return mod
}

describe('confirm / ConfirmRoot', () => {
  it('resolves true when OK button is clicked', async () => {
    const { confirm, ConfirmRoot } = await getModule()
    render(<ConfirmRoot />)

    let result: boolean | undefined
    act(() => {
      confirm({ message: 'Are you sure?' }).then((v) => { result = v })
    })

    const btn = await screen.findByText('OK')
    fireEvent.click(btn)

    await new Promise((r) => setTimeout(r, 0))
    expect(result).toBe(true)
  })

  it('resolves false when Cancel button is clicked', async () => {
    const { confirm, ConfirmRoot } = await getModule()
    render(<ConfirmRoot />)

    let result: boolean | undefined
    act(() => {
      confirm({ message: 'Are you sure?' }).then((v) => { result = v })
    })

    const btn = await screen.findByText('Cancel')
    fireEvent.click(btn)

    await new Promise((r) => setTimeout(r, 0))
    expect(result).toBe(false)
  })

  it('resolves false on Escape key', async () => {
    const { confirm, ConfirmRoot } = await getModule()
    render(<ConfirmRoot />)

    let result: boolean | undefined
    act(() => {
      confirm({ message: 'Press escape' }).then((v) => { result = v })
    })

    await screen.findByText('Press escape')
    fireEvent.keyDown(document, { key: 'Escape' })

    await new Promise((r) => setTimeout(r, 0))
    expect(result).toBe(false)
  })

  it('resolves false on backdrop click', async () => {
    const { confirm, ConfirmRoot } = await getModule()
    render(<ConfirmRoot />)

    let result: boolean | undefined
    act(() => {
      confirm({ message: 'Click backdrop' }).then((v) => { result = v })
    })

    await screen.findByText('Click backdrop')

    const backdrop = document.querySelector('.absolute.inset-0')
    if (backdrop) fireEvent.click(backdrop)

    await new Promise((r) => setTimeout(r, 0))
    expect(result).toBe(false)
  })

  it('renders title when provided', async () => {
    const { confirm, ConfirmRoot } = await getModule()
    render(<ConfirmRoot />)

    act(() => {
      confirm({ title: 'Confirm Action', message: 'Are you sure?' })
    })

    expect(await screen.findByText('Confirm Action')).toBeTruthy()
  })

  it('uses custom confirm and cancel labels', async () => {
    const { confirm, ConfirmRoot } = await getModule()
    render(<ConfirmRoot />)

    act(() => {
      confirm({ message: 'Delete?', confirmLabel: 'Yes, delete', cancelLabel: 'No' })
    })

    expect(await screen.findByText('Yes, delete')).toBeTruthy()
    expect(screen.getByText('No')).toBeTruthy()
  })

  it('alert mode resolves true on backdrop click', async () => {
    const { confirm, ConfirmRoot } = await getModule()
    render(<ConfirmRoot />)

    let result: boolean | undefined
    act(() => {
      confirm({ message: 'Alert!', mode: 'alert' }).then((v) => { result = v })
    })

    await screen.findByText('Alert!')
    const backdrop = document.querySelector('.absolute.inset-0')
    if (backdrop) fireEvent.click(backdrop)

    await new Promise((r) => setTimeout(r, 0))
    expect(result).toBe(true)
  })

  it('alert mode shows no cancel button', async () => {
    const { confirm, ConfirmRoot } = await getModule()
    render(<ConfirmRoot />)

    act(() => {
      confirm({ message: 'Info message', mode: 'alert' })
    })

    await screen.findByText('Info message')
    expect(screen.queryByText('Cancel')).toBeNull()
  })

  it('destructive mode shows red confirm button class', async () => {
    const { confirm, ConfirmRoot } = await getModule()
    render(<ConfirmRoot />)

    act(() => {
      confirm({ message: 'Delete forever?', destructive: true, confirmLabel: 'Delete' })
    })

    const btn = await screen.findByText('Delete')
    expect(btn.className).toContain('bg-red')
  })
})
