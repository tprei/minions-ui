import { z } from 'zod'
import type { RuntimeOverrides } from '../../shared/api-types'

export type { RuntimeOverrides }

export const LoopOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMs: z.number().int().positive().optional(),
})

export const RuntimeOverridesSchema = z.object({
  loops: z.record(z.string(), LoopOverrideSchema).optional(),
  workspace: z
    .object({
      maxConcurrentSessions: z.number().int().positive().optional(),
    })
    .optional(),
  loopsConfig: z
    .object({
      maxConcurrentLoops: z.number().int().positive().optional(),
      reservedInteractiveSlots: z.number().int().nonnegative().optional(),
    })
    .optional(),
  mcp: z
    .object({
      browserEnabled: z.boolean().optional(),
      githubEnabled: z.boolean().optional(),
      context7Enabled: z.boolean().optional(),
      supabaseEnabled: z.boolean().optional(),
      supabaseProjectRef: z.string().optional(),
    })
    .optional(),
  quota: z
    .object({
      retryMax: z.number().int().nonnegative().optional(),
      defaultSleepMs: z.number().int().positive().optional(),
    })
    .optional(),
})

export type ValidatedRuntimeOverrides = z.infer<typeof RuntimeOverridesSchema>
