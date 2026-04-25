import fs from 'node:fs'
import path from 'node:path'
import { buildIsolatedEnv } from '../../env.js'
import { applyCodexEnv } from './env.js'
import { parseCodexLine, translateCodexLine } from './stream.js'
import type { AgentProvider, Image, ProviderEvent, SpawnArgsOpts } from '../types.js'

const MEDIA_EXT: Record<Image['mediaType'], string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

type CodexInput = { type: 'text'; text: string } | { type: 'localImage'; path: string }

export function makeCodexProvider(): AgentProvider {
  let idCounter = 0
  let imageSeq = 0
  let workspaceHome = ''
  let pendingInitialInput: { prompt: string; images: Image[] | undefined } | null = null

  function nextId(): number {
    return ++idCounter
  }

  function stageImages(images: Image[], wHome: string): { type: 'localImage'; path: string }[] {
    const tmpDir = path.join(wHome, 'tmp')
    return images.map((img) => {
      imageSeq++
      const ext = MEDIA_EXT[img.mediaType]
      const filePath = path.join(tmpDir, `codex-${imageSeq}${ext}`)
      fs.writeFileSync(filePath, Buffer.from(img.dataBase64, 'base64'))
      return { type: 'localImage' as const, path: filePath }
    })
  }

  function buildInput(prompt: string, images: Image[] | undefined, wHome: string): CodexInput[] {
    const input: CodexInput[] = [{ type: 'text', text: prompt }]
    if (images && images.length > 0) {
      input.push(...stageImages(images, wHome))
    }
    return input
  }

  function rpcFrame(method: string, params: Record<string, unknown>): string {
    return JSON.stringify({ jsonrpc: '2.0', id: nextId(), method, params })
  }

  return {
    name: 'codex',

    buildSpawnArgs(opts: SpawnArgsOpts): { argv: string[]; env: NodeJS.ProcessEnv } {
      workspaceHome = opts.workspaceHome
      const argv = ['codex', 'app-server', '--listen', 'stdio://']
      const env = buildIsolatedEnv({ workspaceHome: opts.workspaceHome })
      applyCodexEnv(env, { workspaceHome: opts.workspaceHome, parentHome: opts.parentHome })
      return { argv, env }
    },

    serializeInitialInput(prompt: string, images: Image[] | undefined, opts: SpawnArgsOpts): string {
      workspaceHome = opts.workspaceHome

      if (opts.resumeSessionId) {
        const threadId = opts.resumeSessionId
        const resumeFrame = rpcFrame('thread/resume', { threadId })
        const input = buildInput(prompt, images, opts.workspaceHome)
        const turnFrame = rpcFrame('turn/start', { threadId, input })
        return [resumeFrame, turnFrame].join('\n')
      }

      pendingInitialInput = { prompt, images }

      const sandbox = opts.modeConfig.sandbox === 'read-only' ? 'read-only' : 'workspace-write'
      const params: Record<string, unknown> = {
        model: opts.modeConfig.model,
        cwd: opts.cwd,
        approvalPolicy: 'never',
        sandbox,
      }
      if (opts.modeConfig.reasoningEffort) {
        params['config'] = { model_reasoning_effort: opts.modeConfig.reasoningEffort }
      }
      return rpcFrame('thread/start', params)
    },

    serializeUserReply(
      prompt: string,
      images: Image[] | undefined,
      ctx: { providerSessionId: string | undefined },
    ): string {
      const threadId = ctx.providerSessionId
      if (!threadId) {
        throw new Error('[codex-provider] serializeUserReply called before thread/started')
      }
      const input = buildInput(prompt, images, workspaceHome)
      return rpcFrame('turn/start', { threadId, input })
    },

    parseLine(line: string): { events: ProviderEvent[]; sessionId?: string } {
      const raw = parseCodexLine(line)
      if (!raw) return { events: [] }
      return translateCodexLine(raw)
    },

    onProviderEvent(
      event: ProviderEvent,
      ctx: { providerSessionId: string | undefined },
    ): string[] | null {
      if (event.kind !== 'session_id') return null
      const threadId = ctx.providerSessionId
      if (!threadId || !pendingInitialInput) return null
      const { prompt, images } = pendingInitialInput
      pendingInitialInput = null
      const input = buildInput(prompt, images, workspaceHome)
      return [rpcFrame('turn/start', { threadId, input }) + '\n']
    },

    resumeArgs(): string[] {
      return []
    },

    isQuotaError(stderr: string): boolean {
      // Codex quota strings not yet observed in production; tune after real events.
      return /(plan|quota|rate[- ]?limit|exhausted|exceeded|too many requests)/i.test(stderr)
    },
  }
}
