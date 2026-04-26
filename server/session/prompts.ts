import type { CreateSessionMode } from '../../shared/api-types'
import type { ModeConfig } from './providers/types'

export type { ModeConfig }

export const DEFAULT_TASK_PROMPT = 'You are executing a coding task. Work autonomously and conclude with a clear summary.'
export const DEFAULT_PLAN_PROMPT = 'You produce a detailed implementation plan without modifying files.'
export const DEFAULT_THINK_PROMPT = 'You think carefully about the problem and respond with analysis.'
export const DEFAULT_REVIEW_PROMPT = 'You perform a thorough code review.'
export const DEFAULT_SHIP_PROMPT = 'You coordinate a multi-stage ship workflow, progressing through think → plan → dag → verify stages.'
export const DEFAULT_CI_FIX_PROMPT = 'You fix failing CI jobs. When all checks pass, announce success and exit.'

const READONLY_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const

export type AllSessionMode = CreateSessionMode | 'ci-fix'

function envModel(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function envReasoningEffort(key: string, fallback: ModeConfig['reasoningEffort']): ModeConfig['reasoningEffort'] {
  const val = process.env[key]
  if (val === 'minimal' || val === 'low' || val === 'medium' || val === 'high') return val
  return fallback
}

export const CLAUDE_MODE_CONFIGS: Record<AllSessionMode, ModeConfig> = {
  task: {
    systemPrompt: DEFAULT_TASK_PROMPT,
    model: envModel('CLAUDE_TASK_MODEL', 'opus'),
    disallowedTools: [],
    autoExitOnComplete: false,
  },
  'dag-task': {
    systemPrompt: DEFAULT_TASK_PROMPT,
    model: envModel('CLAUDE_TASK_MODEL', 'opus'),
    disallowedTools: [],
    autoExitOnComplete: true,
  },
  plan: {
    systemPrompt: DEFAULT_PLAN_PROMPT,
    model: envModel('CLAUDE_PLAN_MODEL', 'opus'),
    disallowedTools: [...READONLY_DISALLOWED_TOOLS],
    autoExitOnComplete: false,
  },
  think: {
    systemPrompt: DEFAULT_THINK_PROMPT,
    model: envModel('CLAUDE_THINK_MODEL', 'opus'),
    disallowedTools: [...READONLY_DISALLOWED_TOOLS],
    autoExitOnComplete: false,
  },
  review: {
    systemPrompt: DEFAULT_REVIEW_PROMPT,
    model: envModel('CLAUDE_REVIEW_MODEL', 'opus'),
    disallowedTools: [...READONLY_DISALLOWED_TOOLS],
    autoExitOnComplete: false,
  },
  ship: {
    systemPrompt: DEFAULT_SHIP_PROMPT,
    model: envModel('CLAUDE_SHIP_MODEL', 'opus'),
    disallowedTools: [],
    autoExitOnComplete: false,
  },
  'ci-fix': {
    systemPrompt: DEFAULT_CI_FIX_PROMPT,
    model: envModel('CLAUDE_CI_FIX_MODEL', 'opus'),
    disallowedTools: [],
    autoExitOnComplete: true,
  },
}

const CODEX_REASONING_EFFORT = envReasoningEffort('CODEX_REASONING_EFFORT', 'high')

export const CODEX_MODE_CONFIGS: Record<AllSessionMode, ModeConfig> = {
  task: {
    systemPrompt: DEFAULT_TASK_PROMPT,
    model: envModel('CODEX_TASK_MODEL', 'gpt-5.3-codex'),
    disallowedTools: [],
    autoExitOnComplete: false,
  },
  'dag-task': {
    systemPrompt: DEFAULT_TASK_PROMPT,
    model: envModel('CODEX_TASK_MODEL', 'gpt-5.3-codex'),
    disallowedTools: [],
    autoExitOnComplete: true,
  },
  plan: {
    systemPrompt: DEFAULT_PLAN_PROMPT,
    model: envModel('CODEX_PLAN_MODEL', 'gpt-5.3-codex'),
    disallowedTools: [],
    autoExitOnComplete: false,
    reasoningEffort: CODEX_REASONING_EFFORT,
  },
  think: {
    systemPrompt: DEFAULT_THINK_PROMPT,
    model: envModel('CODEX_THINK_MODEL', 'gpt-5.3-codex'),
    disallowedTools: [],
    autoExitOnComplete: false,
    reasoningEffort: CODEX_REASONING_EFFORT,
  },
  review: {
    systemPrompt: DEFAULT_REVIEW_PROMPT,
    model: envModel('CODEX_REVIEW_MODEL', 'gpt-5.3-codex'),
    disallowedTools: [],
    autoExitOnComplete: false,
    reasoningEffort: CODEX_REASONING_EFFORT,
  },
  ship: {
    systemPrompt: DEFAULT_SHIP_PROMPT,
    model: envModel('CODEX_SHIP_MODEL', 'gpt-5.3-codex'),
    disallowedTools: [],
    autoExitOnComplete: false,
    reasoningEffort: CODEX_REASONING_EFFORT,
  },
  'ci-fix': {
    systemPrompt: DEFAULT_CI_FIX_PROMPT,
    model: envModel('CODEX_CI_FIX_MODEL', 'gpt-5.3-codex'),
    disallowedTools: [],
    autoExitOnComplete: true,
  },
}

const MODE_CONFIG_MAP: Record<'claude' | 'codex', Record<AllSessionMode, ModeConfig>> = {
  claude: CLAUDE_MODE_CONFIGS,
  codex: CODEX_MODE_CONFIGS,
}

export function getModeConfig(provider: 'claude' | 'codex', mode: AllSessionMode): ModeConfig {
  return MODE_CONFIG_MAP[provider][mode]
}
