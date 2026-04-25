import { describe, it, expectTypeOf } from 'vitest'
import type { AgentProvider, ParserState, ProviderEvent, SpawnArgsOpts, Image } from './types.js'

describe('AgentProvider interface', () => {
  it('is satisfied by a conforming object', () => {
    const provider = {
      name: 'claude' as const,
      buildSpawnArgs: (): { argv: string[]; env: NodeJS.ProcessEnv } => ({ argv: [], env: {} }),
      serializeInitialInput: (): string => '',
      serializeUserReply: (): string => '',
      parseLine: (): { events: ProviderEvent[] } => ({ events: [] }),
      resumeArgs: (): string[] => [],
      isQuotaError: (): boolean => false,
    } satisfies AgentProvider

    expectTypeOf(provider).toMatchTypeOf<AgentProvider>()
    expectTypeOf(provider.name).toMatchTypeOf<'claude' | 'codex'>()
  })

  it('ProviderEvent union covers all kinds', () => {
    const event: ProviderEvent = { kind: 'session_id', sessionId: 'sid' }
    expectTypeOf(event).toMatchTypeOf<ProviderEvent>()
  })

  it('SpawnArgsOpts and Image are structurally sound', () => {
    expectTypeOf<SpawnArgsOpts['modeConfig']['disallowedTools']>().toEqualTypeOf<string[]>()
    expectTypeOf<Image['mediaType']>().toEqualTypeOf<'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'>()
  })

  it('ParserState accepts any object', () => {
    const state: ParserState = { providerSessionId: undefined }
    expectTypeOf(state).toMatchTypeOf<ParserState>()
  })
})
