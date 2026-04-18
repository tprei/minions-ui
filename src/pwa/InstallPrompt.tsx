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
      class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg bg-slate-800 text-slate-100 text-sm"
      role="banner"
      data-testid="install-prompt"
    >
      <span>Install minions-ui for quick access</span>
      <button
        onClick={() => void handleInstall()}
        class="font-medium px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
        data-testid="install-btn"
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        class="text-slate-400 hover:text-slate-200 transition-colors"
        aria-label="Dismiss install prompt"
        data-testid="install-dismiss-btn"
      >
        &times;
      </button>
    </div>
  )
}
