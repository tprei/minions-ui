import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

export const REPO_CONFIG_FILENAME = 'minions.json'

export const QualityGateSchema = z.object({
  name: z.string().min(1),
  command: z.array(z.string().min(1)).min(1),
  required: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(60 * 60 * 1000).optional(),
  paths: z.array(z.string().min(1)).optional(),
})

export const MergePolicySchema = z.object({
  requirePr: z.boolean().default(true),
  requireMergeable: z.boolean().default(true),
  requireCiPass: z.boolean().default(true),
  requireQualityGates: z.boolean().default(true),
  allowDraft: z.boolean().default(false),
}).default({})

export const AgentModeSchema = z.enum(['task', 'dag-task', 'plan', 'think', 'review', 'ship', 'ci-fix', 'rebase-resolver'])

export const AgentModePolicySchema = z.object({
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  sandbox: z.enum(['read-only', 'workspace-write']).optional(),
  disallowedTools: z.array(z.string().min(1)).optional(),
}).default({})

export const AgentPolicySchema = z.object({
  modes: z.record(AgentModeSchema, AgentModePolicySchema).default({}),
}).default({ modes: {} })

export const RepoConfigSchema = z.object({
  quality: z.object({
    gates: z.array(QualityGateSchema).default([]),
  }).default({ gates: [] }),
  merge: MergePolicySchema,
  agent: AgentPolicySchema,
}).default({})

export type QualityGateConfig = z.infer<typeof QualityGateSchema>
export type AgentModePolicyConfig = z.infer<typeof AgentModePolicySchema>
export type RepoConfig = z.infer<typeof RepoConfigSchema>

export interface RepoConfigResult {
  config: RepoConfig
  source: 'file' | 'default'
  path?: string
  error?: string
}

function defaultConfig(): RepoConfig {
  return RepoConfigSchema.parse({})
}

function formatZodError(err: z.ZodError): string {
  return err.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
}

export function readRepoConfig(cwd: string): RepoConfigResult {
  const configPath = path.join(cwd, REPO_CONFIG_FILENAME)
  if (!fs.existsSync(configPath)) {
    return { config: defaultConfig(), source: 'default' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (err) {
    return {
      config: defaultConfig(),
      source: 'file',
      path: configPath,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const parsed = RepoConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      config: defaultConfig(),
      source: 'file',
      path: configPath,
      error: formatZodError(parsed.error),
    }
  }

  return { config: parsed.data, source: 'file', path: configPath }
}
