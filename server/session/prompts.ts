import type { CreateSessionMode } from '../../shared/api-types'
import { readRepoConfig } from '../config/repo-config'
import type { ModeConfig } from './providers/types'

export type { ModeConfig }

export const DEFAULT_TASK_PROMPT = 'You are executing a coding task. Work autonomously and conclude with a clear summary.'
export const DEFAULT_PLAN_PROMPT = 'You produce a detailed implementation plan without modifying files.'
export const DEFAULT_THINK_PROMPT = 'You think carefully about the problem and respond with analysis.'
export const DEFAULT_REVIEW_PROMPT = 'You perform a thorough code review.'
export const DEFAULT_SHIP_PROMPT = 'You coordinate a multi-stage ship workflow, progressing through think → plan → dag → verify stages.'
export const DEFAULT_CI_FIX_PROMPT = 'You fix failing CI jobs. When all checks pass, announce success and exit.'
export const DEFAULT_REBASE_RESOLVER_PROMPT =
  'You resolve git rebase conflicts. Examine conflict markers, understand parent intent, resolve conflicts, then git rebase --continue and push. If resolution is impossible or requires human judgment, abort.'

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
    model: envModel('CLAUDE_TASK_MODEL', 'claude-sonnet-4-5-20250929'),
    disallowedTools: [],
    autoExitOnComplete: false,
  },
  'dag-task': {
    systemPrompt: DEFAULT_TASK_PROMPT,
    model: envModel('CLAUDE_TASK_MODEL', 'claude-sonnet-4-5-20250929'),
    disallowedTools: [],
    autoExitOnComplete: true,
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
  ship: {
    systemPrompt: DEFAULT_SHIP_PROMPT,
    model: envModel('CLAUDE_SHIP_MODEL', 'claude-opus-4-1-20250805'),
    disallowedTools: [],
    autoExitOnComplete: false,
  },
  'ci-fix': {
    systemPrompt: DEFAULT_CI_FIX_PROMPT,
    model: envModel('CLAUDE_CI_FIX_MODEL', 'claude-sonnet-4-5-20250929'),
    disallowedTools: [],
    autoExitOnComplete: true,
  },
  'rebase-resolver': {
    systemPrompt: DEFAULT_REBASE_RESOLVER_PROMPT,
    model: envModel('CLAUDE_REBASE_RESOLVER_MODEL', 'claude-opus-4-1-20250805'),
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
  'rebase-resolver': {
    systemPrompt: DEFAULT_REBASE_RESOLVER_PROMPT,
    model: envModel('CODEX_REBASE_RESOLVER_MODEL', 'gpt-5.3-codex'),
    disallowedTools: [],
    autoExitOnComplete: true,
    reasoningEffort: CODEX_REASONING_EFFORT,
  },
}

const MODE_CONFIG_MAP: Record<'claude' | 'codex', Record<AllSessionMode, ModeConfig>> = {
  claude: CLAUDE_MODE_CONFIGS,
  codex: CODEX_MODE_CONFIGS,
}

export function getModeConfig(provider: 'claude' | 'codex', mode: AllSessionMode): ModeConfig {
  return MODE_CONFIG_MAP[provider][mode]
}

function mergeDisallowedTools(base: string[], extra: string[] | undefined): string[] {
  if (!extra || extra.length === 0) return base
  return Array.from(new Set([...base, ...extra]))
}

export function getResolvedModeConfig(provider: 'claude' | 'codex', mode: AllSessionMode, cwd: string): ModeConfig {
  const base = getModeConfig(provider, mode)
  const repoConfig = readRepoConfig(cwd)
  const policy = repoConfig.config.agent.modes[mode]
  if (!policy) return base

  return {
    ...base,
    model: policy.model ?? base.model,
    reasoningEffort: policy.reasoningEffort ?? base.reasoningEffort,
    sandbox: policy.sandbox ?? base.sandbox,
    disallowedTools: mergeDisallowedTools(base.disallowedTools, policy.disallowedTools),
  }
}
