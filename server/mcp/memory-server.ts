#!/usr/bin/env bun
// @ts-expect-error - MCP SDK types not available until bun install completes
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
// @ts-expect-error - MCP SDK types not available until bun install completes
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
// @ts-expect-error - MCP SDK types not available until bun install completes
} from '@modelcontextprotocol/sdk/types.js'

const apiBaseUrl = process.env.MEMORY_API_BASE_URL ?? 'http://127.0.0.1:8080'
const token = process.env.MEMORY_API_TOKEN
const repo = process.env.MEMORY_REPO
const sessionId = process.env.MEMORY_SESSION_ID

if (!token) {
  console.error('[memory-mcp] MEMORY_API_TOKEN is required')
  process.exit(1)
}

if (!repo) {
  console.error('[memory-mcp] MEMORY_REPO is required')
  process.exit(1)
}

async function apiCall(method: string, path: string, body?: unknown): Promise<Response> {
  const url = `${apiBaseUrl}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (body) {
    headers['Content-Type'] = 'application/json'
  }
  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

const server = new Server(
  { name: 'memory', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = [
    {
      name: 'memory_propose',
      description: 'Propose a new memory for later review. Used when the agent learns something worth remembering about the user, the project, feedback, or external references.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['user', 'feedback', 'project', 'reference'],
            description: 'Memory type: user (facts about the user), feedback (guidance on how to work), project (initiative/bug/incident context), reference (external resource pointers)',
          },
          name: {
            type: 'string',
            description: 'Short name for this memory (e.g., "user_role", "feedback_testing")',
          },
          description: {
            type: 'string',
            description: 'One-line summary used to decide relevance in future conversations',
          },
          content: {
            type: 'string',
            description: 'Full memory content in markdown. For feedback/project types, lead with the fact/rule, then add **Why:** and **How to apply:** lines.',
          },
        },
        required: ['type', 'name', 'description', 'content'],
      },
    },
    {
      name: 'memory_search',
      description: 'Search approved memories using full-text search. Returns memories that match the query.',
      inputSchema: {
        type: 'object',
        properties: {
          q: {
            type: 'string',
            description: 'Search query for full-text search across memory name, description, and content',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default 20)',
          },
        },
        required: ['q'],
      },
    },
    {
      name: 'memory_list',
      description: 'List approved memories. Use this to load context when memories seem relevant.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of memories to return (default 50)',
          },
        },
      },
    },
    {
      name: 'memory_update',
      description: 'Update an existing memory. Only approved memories can be updated via this tool.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Memory ID to update',
          },
          name: {
            type: 'string',
            description: 'New name (optional)',
          },
          description: {
            type: 'string',
            description: 'New description (optional)',
          },
          content: {
            type: 'string',
            description: 'New content (optional)',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'memory_forget',
      description: 'Propose deletion of a memory. Transitions approved memory to pending_deletion status for user review.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Memory ID to forget',
          },
        },
        required: ['id'],
      },
    },
  ]
  return { tools }
})

server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments: Record<string, unknown> } }) => {
  const { name, arguments: args } = request.params

  try {
    if (name === 'memory_propose') {
      const { type, name: memName, description, content } = args as {
        type: string
        name: string
        description: string
        content: string
      }
      const response = await apiCall('POST', '/api/memories', {
        repo,
        sourceSessionId: sessionId ?? null,
        type,
        name: memName,
        description,
        content,
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to propose memory: ${response.status} ${errorText}`)
      }
      await response.json()
      return {
        content: [
          {
            type: 'text',
            text: `Memory proposed for review: ${memName}\n\nThe memory has been submitted and will appear in the user's memory inbox for approval.`,
          },
        ],
      }
    }

    if (name === 'memory_search') {
      const { q, limit = 20 } = args as { q: string; limit?: number }
      const url = new URL('/api/memories', apiBaseUrl)
      url.searchParams.set('repo', repo)
      url.searchParams.set('status', 'approved')
      url.searchParams.set('q', q)
      url.searchParams.set('limit', String(limit))

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to search memories: ${response.status} ${errorText}`)
      }
      const result = (await response.json()) as { data?: Array<{ name: string; description: string; content: string }> }
      const memories = result.data ?? []
      if (memories.length === 0) {
        return {
          content: [{ type: 'text', text: 'No approved memories found matching the query.' }],
        }
      }
      const text = memories
        .map((m: { name: string; description: string; content: string }) => {
          return `## ${m.name}\n${m.description}\n\n${m.content}`
        })
        .join('\n\n---\n\n')
      return {
        content: [{ type: 'text', text }],
      }
    }

    if (name === 'memory_list') {
      const { limit = 50 } = args as { limit?: number }
      const url = new URL('/api/memories', apiBaseUrl)
      url.searchParams.set('repo', repo)
      url.searchParams.set('status', 'approved')
      url.searchParams.set('limit', String(limit))

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to list memories: ${response.status} ${errorText}`)
      }
      const result = (await response.json()) as { data?: Array<{ name: string; description: string; type: string }> }
      const memories = result.data ?? []
      if (memories.length === 0) {
        return {
          content: [{ type: 'text', text: 'No approved memories found.' }],
        }
      }
      const text = memories
        .map((m) => {
          return `- [${m.type}] ${m.name}: ${m.description}`
        })
        .join('\n')
      return {
        content: [{ type: 'text', text: `Approved memories (${memories.length}):\n\n${text}` }],
      }
    }

    if (name === 'memory_update') {
      const { id, name: newName, description, content } = args as {
        id: string
        name?: string
        description?: string
        content?: string
      }
      const response = await apiCall('PATCH', `/api/memories/${id}`, {
        name: newName,
        description,
        content,
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to update memory: ${response.status} ${errorText}`)
      }
      await response.json()
      return {
        content: [{ type: 'text', text: `Memory updated: ${id}` }],
      }
    }

    if (name === 'memory_forget') {
      const { id } = args as { id: string }
      const response = await apiCall('PATCH', `/api/memories/${id}`, {
        status: 'pending_deletion',
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to mark memory for deletion: ${response.status} ${errorText}`)
      }
      return {
        content: [
          {
            type: 'text',
            text: `Memory marked for deletion: ${id}\n\nThe memory has been moved to pending_deletion status and will appear in the user's inbox for final approval.`,
          },
        ],
      }
    }

    throw new Error(`Unknown tool: ${name}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[memory-mcp] Server running on stdio')
}

main().catch((err) => {
  console.error('[memory-mcp] Fatal error:', err)
  process.exit(1)
})
