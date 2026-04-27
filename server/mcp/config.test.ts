import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { buildMcpConfig, shouldAttachMcp } from './config'

type EnvSnapshot = Record<string, string | undefined>

const MCP_ENV_KEYS = [
  'ENABLE_BROWSER_MCP',
  'ENABLE_GITHUB_MCP',
  'ENABLE_CONTEXT7_MCP',
  'ENABLE_SUPABASE_MCP',
  'ENABLE_MEMORY_MCP',
  'GITHUB_TOKEN',
  'GITHUB_PERSONAL_ACCESS_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
  'MINION_API_TOKEN',
  'PORT',
]

let snapshot: EnvSnapshot

beforeEach(() => {
  snapshot = {}
  for (const key of MCP_ENV_KEYS) {
    snapshot[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of MCP_ENV_KEYS) {
    const val = snapshot[key]
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
})

describe('buildMcpConfig', () => {
  test('default toggles with no env vars — playwright + context7 + memory present, github + supabase absent', () => {
    const cfg = buildMcpConfig()
    expect(cfg.mcpServers['playwright']).toBeDefined()
    expect(cfg.mcpServers['context7']).toBeDefined()
    expect(cfg.mcpServers['memory']).toBeDefined()
    expect(cfg.mcpServers['github']).toBeUndefined()
    expect(cfg.mcpServers['supabase']).toBeUndefined()
  })

  test('ENABLE_BROWSER_MCP=false → playwright absent', () => {
    process.env['ENABLE_BROWSER_MCP'] = 'false'
    const cfg = buildMcpConfig()
    expect(cfg.mcpServers['playwright']).toBeUndefined()
    expect(cfg.mcpServers['context7']).toBeDefined()
  })

  test('GITHUB_TOKEN set → github entry present with correct env injection', () => {
    process.env['GITHUB_TOKEN'] = 'ghp_test_token'
    const cfg = buildMcpConfig()
    const github = cfg.mcpServers['github']
    expect(github).toBeDefined()
    expect(github!.command).toBe('github-mcp-server')
    expect(github!.args).toEqual(['stdio'])
    expect(github!.env?.['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe('ghp_test_token')
  })

  test('GITHUB_PERSONAL_ACCESS_TOKEN preferred over GITHUB_TOKEN when both set', () => {
    process.env['GITHUB_TOKEN'] = 'ghp_fallback'
    process.env['GITHUB_PERSONAL_ACCESS_TOKEN'] = 'ghp_preferred'
    const cfg = buildMcpConfig()
    const github = cfg.mcpServers['github']
    expect(github!.env?.['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe('ghp_preferred')
  })

  test('SUPABASE_ACCESS_TOKEN + supabaseProjectRef → supabase entry with --project-ref arg', () => {
    process.env['SUPABASE_ACCESS_TOKEN'] = 'sbp_test_token'
    const cfg = buildMcpConfig({ supabaseProjectRef: 'my-project-ref' })
    const supabase = cfg.mcpServers['supabase']
    expect(supabase).toBeDefined()
    expect(supabase!.command).toBe('npx')
    expect(supabase!.args).toContain('--project-ref')
    expect(supabase!.args).toContain('my-project-ref')
    expect(supabase!.args).toContain('--access-token')
    expect(supabase!.args).toContain('sbp_test_token')
  })

  test('supabase without project ref — no --project-ref arg', () => {
    process.env['SUPABASE_ACCESS_TOKEN'] = 'sbp_test_token'
    const cfg = buildMcpConfig()
    const supabase = cfg.mcpServers['supabase']
    expect(supabase).toBeDefined()
    expect(supabase!.args).not.toContain('--project-ref')
  })

  test('every produced entry has command (string), args (array), and optional env', () => {
    process.env['GITHUB_TOKEN'] = 'ghp_test'
    process.env['SUPABASE_ACCESS_TOKEN'] = 'sbp_test'
    const cfg = buildMcpConfig()
    for (const [, entry] of Object.entries(cfg.mcpServers)) {
      expect(typeof entry.command).toBe('string')
      expect(Array.isArray(entry.args)).toBe(true)
      if (entry.env !== undefined) {
        expect(typeof entry.env).toBe('object')
      }
    }
  })

  test('memory server enabled by default with correct env vars', () => {
    const cfg = buildMcpConfig({
      memoryRepo: 'git@github.com:test/repo.git',
      memorySessionId: 'test-session-123',
    })
    const memory = cfg.mcpServers['memory']
    expect(memory).toBeDefined()
    expect(memory!.command).toBe('bun')
    expect(memory!.args).toEqual(['run', 'server/mcp/memory-server.ts'])
    expect(memory!.env?.['MEMORY_REPO']).toBe('git@github.com:test/repo.git')
    expect(memory!.env?.['MEMORY_SESSION_ID']).toBe('test-session-123')
    expect(memory!.env?.['API_PORT']).toBe('8080')
  })

  test('ENABLE_MEMORY_MCP=false → memory absent', () => {
    process.env['ENABLE_MEMORY_MCP'] = 'false'
    const cfg = buildMcpConfig()
    expect(cfg.mcpServers['memory']).toBeUndefined()
  })

  test('memory server respects PORT env var', () => {
    process.env['PORT'] = '9090'
    const cfg = buildMcpConfig()
    const memory = cfg.mcpServers['memory']
    expect(memory!.env?.['API_PORT']).toBe('9090')
  })

  test('memory server accepts custom apiPort via toggles', () => {
    const cfg = buildMcpConfig({ apiPort: '7777' })
    const memory = cfg.mcpServers['memory']
    expect(memory!.env?.['API_PORT']).toBe('7777')
  })

  test('memory server forwards MINION_API_TOKEN when set', () => {
    process.env['MINION_API_TOKEN'] = 'secret-token-123'
    const cfg = buildMcpConfig()
    const memory = cfg.mcpServers['memory']
    expect(memory!.env?.['MINION_API_TOKEN']).toBe('secret-token-123')
  })

  test('memory server omits MINION_API_TOKEN when unset', () => {
    const cfg = buildMcpConfig()
    const memory = cfg.mcpServers['memory']
    expect(memory!.env?.['MINION_API_TOKEN']).toBeUndefined()
  })
})

describe('shouldAttachMcp', () => {
  test('empty mcpServers → false', () => {
    expect(shouldAttachMcp({ mcpServers: {} })).toBe(false)
  })

  test('non-empty mcpServers → true', () => {
    const cfg = buildMcpConfig()
    expect(shouldAttachMcp(cfg)).toBe(true)
  })
})
