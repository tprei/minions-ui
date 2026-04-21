export interface McpToggles {
  browserEnabled?: boolean
  githubEnabled?: boolean
  context7Enabled?: boolean
  supabaseEnabled?: boolean
  supabaseProjectRef?: string
}

export interface McpServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface McpConfigJson {
  mcpServers: Record<string, McpServerEntry>
}

export function buildMcpConfig(toggles: McpToggles = {}): McpConfigJson {
  const browserEnabled = toggles.browserEnabled ?? process.env.ENABLE_BROWSER_MCP !== 'false'
  const githubEnabled = toggles.githubEnabled ?? (process.env.ENABLE_GITHUB_MCP !== 'false' && Boolean(process.env.GITHUB_TOKEN ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN))
  const context7Enabled = toggles.context7Enabled ?? process.env.ENABLE_CONTEXT7_MCP !== 'false'
  const supabaseEnabled = toggles.supabaseEnabled ?? (process.env.ENABLE_SUPABASE_MCP !== 'false' && Boolean(process.env.SUPABASE_ACCESS_TOKEN))

  const mcpServers: Record<string, McpServerEntry> = {}

  if (browserEnabled) {
    mcpServers['playwright'] = {
      command: 'playwright-mcp',
      args: ['--browser', 'chromium', '--headless', '--no-sandbox', '--isolated', '--caps', 'vision'],
    }
  }

  if (githubEnabled) {
    const tok = process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? process.env.GITHUB_TOKEN
    if (!tok) {
      console.warn('[mcp] github enabled but GITHUB_TOKEN missing — skipping')
    } else {
      mcpServers['github'] = {
        command: 'github-mcp-server',
        args: ['stdio'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: tok },
      }
    }
  }

  if (context7Enabled) {
    mcpServers['context7'] = { command: 'context7-mcp', args: [] }
  }

  if (supabaseEnabled) {
    const tok = process.env.SUPABASE_ACCESS_TOKEN
    if (!tok) {
      console.warn('[mcp] supabase enabled but SUPABASE_ACCESS_TOKEN missing — skipping')
    } else {
      const args = ['-y', '@supabase/mcp-server-supabase@latest', '--access-token', tok]
      if (toggles.supabaseProjectRef) {
        args.push('--project-ref', toggles.supabaseProjectRef)
      }
      mcpServers['supabase'] = { command: 'npx', args }
    }
  }

  return { mcpServers }
}

export function shouldAttachMcp(cfg: McpConfigJson): boolean {
  return Object.keys(cfg.mcpServers).length > 0
}
