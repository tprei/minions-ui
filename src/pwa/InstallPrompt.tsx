import { signal } from '@preact/signals'

const DISMISS_KEY = 'minions-ui:install-dismissed'
const INSTALLED_KEY = 'minions-ui:installed'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferredPrompt = signal<BeforeInstallPromptEvent | null>(null)

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  if (localStorage.getItem(DISMISS_KEY) || localStorage.getItem(INSTALLED_KEY)) return
  deferredPrompt.value = e as BeforeInstallPromptEvent
})

window.addEventListener('appinstalled', () => {
  deferredPrompt.value = null
  localStorage.setItem(INSTALLED_KEY, 'true')
})

export function InstallPrompt() {
  const prompt = deferredPrompt.value
  if (!prompt) return null

  const handleInstall = async () => {
    const p = deferredPrompt.value
    if (!p) return
    deferredPrompt.value = null
    await p.prompt()
  }

  const handleDismiss = () => {
    deferredPrompt.value = null
    localStorage.setItem(DISMISS_KEY, 'true')
  }

  return (
    <div
      class="pointer-events-none fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+4rem)] z-50 flex items-center gap-3 rounded-xl bg-slate-800 px-4 py-3 text-sm text-slate-100 shadow-lg sm:left-1/2 sm:right-auto sm:top-16 sm:w-[min(24rem,calc(100vw-2rem))] sm:-translate-x-1/2"
      role="banner"
      data-testid="install-prompt"
    >
      <span>Install minions-ui for quick access</span>
      <button
        onClick={() => void handleInstall()}
        class="pointer-events-auto rounded-lg bg-indigo-600 px-3 py-1 font-medium text-white transition-colors hover:bg-indigo-700"
        data-testid="install-btn"
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        class="pointer-events-auto text-slate-400 transition-colors hover:text-slate-200"
        aria-label="Dismiss install prompt"
        data-testid="install-dismiss-btn"
      >
        &times;
      </button>
    </div>
  )
}
