import type { CreateSessionMode } from '../../shared/api-types'

export const DEFAULT_TASK_PROMPT = 'You are executing a coding task. Work autonomously and conclude with a clear summary.'
export const DEFAULT_PLAN_PROMPT = 'You produce a detailed implementation plan without modifying files.'
export const DEFAULT_THINK_PROMPT = 'You think carefully about the problem and respond with analysis.'
export const DEFAULT_REVIEW_PROMPT = 'You perform a thorough code review.'
export const DEFAULT_SHIP_THINK_PROMPT = 'You produce a design for shipping a feature end-to-end.'
export const DEFAULT_SHIP_PLAN_PROMPT = 'You produce a DAG of tasks for shipping a feature.'
export const DEFAULT_SHIP_VERIFY_PROMPT = 'You verify that the shipped feature meets the acceptance criteria.'
export const DEFAULT_CI_FIX_PROMPT = 'You fix failing CI jobs. When all checks pass, announce success and exit.'

const READONLY_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const

export type AllSessionMode = CreateSessionMode | 'ship-plan' | 'ship-verify' | 'ci-fix'

export interface ModeConfig {
  systemPrompt: string
  model: string
  disallowedTools: string[]
  autoExitOnComplete: boolean
}

// Per-mode env overrides: e.g. CLAUDE_TASK_MODEL, CLAUDE_PLAN_MODEL, etc.
function envModel(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

export const MODE_CONFIGS: Record<AllSessionMode, ModeConfig> = {
  task: {
    systemPrompt: DEFAULT_TASK_PROMPT,
    model: envModel('CLAUDE_TASK_MODEL', 'claude-sonnet-4-5-20250929'),
    disallowedTools: [],
    autoExitOnComplete: false,
  },
  plan: {
    systemPrompt: DEFAULT_PLAN_PROMPT,
    model: envModel('CLAUDE_PLAN_MODEL', 'claude-opus-4-1-20250805'),
    disallowedTools: [...READONLY_DISALLOWED_TOOLS],
    autoExitOnComplete: false,
  },
  think: {
    systemPrompt: DEFAULT_THINK_PROMPT,
    model: envModel('CLAUDE_THINK_MODEL', 'claude-opus-4-1-20250805'),
    disallowedTools: [...READONLY_DISALLOWED_TOOLS],
    autoExitOnComplete: false,
  },
  review: {
    systemPrompt: DEFAULT_REVIEW_PROMPT,
    model: envModel('CLAUDE_REVIEW_MODEL', 'claude-opus-4-1-20250805'),
    disallowedTools: [...READONLY_DISALLOWED_TOOLS],
    autoExitOnComplete: false,
  },
  'ship-think': {
    systemPrompt: DEFAULT_SHIP_THINK_PROMPT,
    model: envModel('CLAUDE_SHIP_THINK_MODEL', 'claude-opus-4-1-20250805'),
    disallowedTools: [...READONLY_DISALLOWED_TOOLS],
    autoExitOnComplete: false,
  },
  'ship-plan': {
    systemPrompt: DEFAULT_SHIP_PLAN_PROMPT,
    model: envModel('CLAUDE_SHIP_PLAN_MODEL', 'claude-opus-4-1-20250805'),
    disallowedTools: [...READONLY_DISALLOWED_TOOLS],
    autoExitOnComplete: false,
  },
  'ship-verify': {
    systemPrompt: DEFAULT_SHIP_VERIFY_PROMPT,
    model: envModel('CLAUDE_SHIP_VERIFY_MODEL', 'claude-sonnet-4-5-20250929'),
    disallowedTools: [],
    autoExitOnComplete: false,
  },
  'ci-fix': {
    systemPrompt: DEFAULT_CI_FIX_PROMPT,
    model: envModel('CLAUDE_CI_FIX_MODEL', 'claude-sonnet-4-5-20250929'),
    disallowedTools: [],
    autoExitOnComplete: true,
  },
}
