import { useCallback, useEffect } from 'preact/hooks'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useBottomSheetSnap } from '../hooks/useBottomSheetSnap'
import { ChatPane } from './ChatPane'
import type { ApiSession, MinionCommand } from '../api/types'
import type { ConnectionStore } from '../state/types'

interface ChatPanelProps {
  session: ApiSession
  store: ConnectionStore
  onSend: (text: string, sessionId: string, images?: Array<{ mediaType: string; dataBase64: string }>) => Promise<void>
  onCommand: (cmd: MinionCommand) => Promise<void>
  onNavigate?: (sessionId: string) => void
}

export function ChatPanel({
  session,
  store,
  onSend,
  onCommand,
  onNavigate,
}: ChatPanelProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const { elementRef, currentSnap, snapTo } = useBottomSheetSnap<HTMLDivElement>({
    enabled: !isDesktop.value,
    initialSnap: 'peek',
  })

  useEffect(() => {
    if (isDesktop.value) return

    const handleResize = () => {
      snapTo(currentSnap, true)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isDesktop.value, currentSnap, snapTo])

  const handleExpandClick = useCallback(() => {
    if (currentSnap === 'peek') {
      snapTo('half')
    } else if (currentSnap === 'half') {
      snapTo('full')
    } else {
      snapTo('peek')
    }
  }, [currentSnap, snapTo])

  if (isDesktop.value) {
    return <ChatPane session={session} store={store} onSend={onSend} onCommand={onCommand} onNavigate={onNavigate} />
  }

  return (
    <div
      ref={elementRef}
      class="fixed bottom-0 left-0 right-0 z-30 rounded-t-2xl shadow-2xl flex flex-col border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      data-testid="chat-panel-sheet"
      data-snap={currentSnap}
    >
      <div
        class="flex flex-col items-center pt-2 pb-1 shrink-0 cursor-grab active:cursor-grabbing"
        data-bottom-sheet-handle
        data-testid="chat-panel-handle"
      >
        <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
        <button
          type="button"
          onClick={handleExpandClick}
          class="mt-1 text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide font-medium px-3 py-1 hover:text-slate-600 dark:hover:text-slate-300 min-h-[24px]"
          data-testid="chat-panel-snap-indicator"
        >
          {currentSnap === 'peek' ? 'Swipe up' : currentSnap === 'half' ? 'Half' : 'Full'}
        </button>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden">
        <ChatPane
          session={session}
          store={store}
          onSend={onSend}
          onCommand={onCommand}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}
