import { useState } from 'preact/hooks'
import { useTheme, setTheme } from '../hooks/useTheme'

// Cycle: system → light → dark → system. Persisted in localStorage via setTheme.
type ThemePref = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'minions-ui:theme'

function readPref(): ThemePref {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function ThemeToggle() {
  const resolved = useTheme()
  const [pref, setPref] = useState<ThemePref>(readPref)

  function cycle() {
    const next: ThemePref = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system'
    setPref(next)
    setTheme(next)
  }

  const icon = pref === 'system' ? '🖥' : resolved.value === 'dark' ? '🌙' : '☀'
  const label =
    pref === 'system'
      ? `Theme: system (${resolved.value})`
      : `Theme: ${pref}`

  return (
    <button
      type="button"
      onClick={cycle}
      class="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 h-7 w-7 flex items-center justify-center text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
      title={label}
      aria-label={label}
      data-testid="theme-toggle"
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  )
}
