import { signal, type Signal } from '@preact/signals'

export type Theme = 'light' | 'dark'
type ThemePref = Theme | 'system'

const STORAGE_KEY = 'minions-ui:theme'

const resolvedTheme = signal<Theme>('light')

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  resolvedTheme.value = theme
}

function resolveAndApply(pref: ThemePref): void {
  const resolved = pref === 'system' ? getSystemTheme() : pref
  applyTheme(resolved)
}

function parseThemePref(raw: string | null): ThemePref {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

let currentPref: ThemePref = parseThemePref(localStorage.getItem(STORAGE_KEY))
resolveAndApply(currentPref)

const mq = window.matchMedia('(prefers-color-scheme: dark)')
mq.addEventListener('change', () => {
  if (currentPref === 'system') {
    applyTheme(getSystemTheme())
  }
})

export function useTheme(): Signal<Theme> {
  return resolvedTheme
}

export function setTheme(theme: ThemePref): void {
  currentPref = theme
  if (theme === 'system') {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, theme)
  }
  resolveAndApply(theme)
}
