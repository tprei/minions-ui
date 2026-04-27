import type { ApiSession } from '../api/types'

export interface SlashCommand {
  cmd: string
  label: string
  hint: string
  destructive?: boolean
}

const PLAN_COMMANDS: SlashCommand[] = [
  { cmd: '/execute', label: 'Execute', hint: 'Turn plan into a running task' },
  { cmd: '/split', label: 'Split', hint: 'Spawn parallel sub-tasks' },
  { cmd: '/stack', label: 'Stack', hint: 'Chain sequential PRs' },
  { cmd: '/dag', label: 'DAG', hint: 'Schedule as dependency graph' },
]

const STACK_DAG_COMMANDS: SlashCommand[] = [
  { cmd: '/land', label: 'Land', hint: 'Merge completed PRs in order' },
  { cmd: '/doctor', label: 'Doctor', hint: 'Diagnose coordination failures' },
]

const TASK_COMMANDS: SlashCommand[] = [
  { cmd: '/doctor', label: 'Doctor', hint: 'Diagnose a stuck task' },
  { cmd: '/stop', label: 'Stop', hint: 'Interrupt the running session', destructive: true },
  { cmd: '/close', label: 'Close', hint: 'Close this session permanently', destructive: true },
]

const SHIP_COMMANDS: SlashCommand[] = [
  { cmd: '/dag', label: 'DAG', hint: 'Schedule the ship plan as a dependency graph' },
  { cmd: '/land', label: 'Land', hint: 'Merge the shipped PR' },
  { cmd: '/doctor', label: 'Doctor', hint: 'Diagnose coordination failures' },
  { cmd: '/stop', label: 'Stop', hint: 'Interrupt the running session', destructive: true },
  { cmd: '/close', label: 'Close', hint: 'Close this session permanently', destructive: true },
]

function commandsForMode(mode: string): SlashCommand[] {
  const normalized = mode.toLowerCase()
  if (normalized === 'plan' || normalized === 'think') return PLAN_COMMANDS
  if (normalized === 'stack' || normalized === 'dag') return [...STACK_DAG_COMMANDS, ...TASK_COMMANDS.filter((c) => c.cmd === '/stop' || c.cmd === '/close')]
  if (normalized === 'ship') return SHIP_COMMANDS
  return TASK_COMMANDS
}

interface SlashCommandMenuProps {
  session: ApiSession
  context: string
  onPrefill: (fullText: string) => void
  disabled?: boolean
}

export function SlashCommandMenu({ session, context, onPrefill, disabled }: SlashCommandMenuProps) {
  const commands = commandsForMode(session.mode)
  const trimmed = context.trim()
  const hasContext = trimmed.length > 0

  return (
    <div
      class="flex flex-wrap gap-1.5 px-3 sm:px-4 py-1.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
      data-testid="slash-command-menu"
    >
      {commands.map((c) => {
        const full = hasContext ? `${c.cmd} ${trimmed}` : c.cmd
        const btnClass = c.destructive
          ? 'border-red-300 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/50'
          : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
        return (
          <button
            key={c.cmd}
            type="button"
            disabled={disabled}
            onClick={() => onPrefill(full)}
            title={`${c.cmd} — ${c.hint} (prefills the chat; click Send to run)`}
            class={`rounded-full border px-3 py-1 text-xs font-mono transition-colors disabled:opacity-50 ${btnClass}`}
            data-testid={`slash-cmd-${c.cmd.replace('/', '')}`}
          >
            {c.cmd}
            {hasContext && <span class="ml-1 text-[10px] opacity-70">+ context</span>}
          </button>
        )
      })}
      {commands.length === 0 && (
        <span class="text-xs italic text-slate-500 dark:text-slate-400">No commands for this mode.</span>
      )}
    </div>
  )
}
