import { render, screen } from '@testing-library/preact'
import { describe, it, expect } from 'vitest'
import App from '../src/App'

describe('App', () => {
  it('renders the empty state copy', () => {
    render(<App />)
    expect(screen.getByText('Connect a minion')).toBeTruthy()
    expect(screen.getByText("Paste a minion's base URL and token to get started")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add connection' })).toBeTruthy()
  })
})
