#!/usr/bin/env bun

type Tool = {
  name: string
  description: string
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
  }
}

type CallToolRequest = {
  params: {
    name: string
    arguments: unknown
  }
}

type ServerCapabilities = {
  capabilities: {
    tools: Record<string, never>
  }
}

type ServerInfo = {
  name: string
  version: string
}

const MEMORY_REPO = process.env.MEMORY_REPO ?? ''
const MEMORY_SESSION_ID = process.env.MEMORY_SESSION_ID ?? ''
const API_PORT = process.env.API_PORT ?? '8080'
const API_BASE = `http://127.0.0.1:${API_PORT}`

interface RememberInput {
  kind: 'user' | 'feedback' | 'project' | 'reference'
  title: string
  body: string
}

interface RecallByIdInput {
  id: number
}

interface RecallByQueryInput {
  query: string
}

interface SupersedeInput {
  old_id: number
  new_kind: 'user' | 'feedback' | 'project' | 'reference'
  new_title: string
  new_body: string
}

interface ForgetInput {
  id: number
}

async function apiRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API request failed (${res.status}): ${text}`)
  }

  return res.json()
}

const tools: Tool[] = [
  {
    name: 'remember',
    description:
      'Save a new memory. Creates a pending memory proposal that requires user approval before becoming active. Use this when you learn something important about the user, feedback, project, or external references.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['user', 'feedback', 'project', 'reference'],
          description:
            'user: information about the user (role, preferences, knowledge). feedback: guidance about how to approach work. project: ongoing work, goals, initiatives. reference: pointers to external systems.',
        },
        title: {
          type: 'string',
          description: 'Short, descriptive title for the memory (used in the index)',
        },
        body: {
          type: 'string',
          description:
            'Full memory content. For feedback/project types, structure as: fact/rule, then **Why:** and **How to apply:** lines.',
        },
      },
      required: ['kind', 'title', 'body'],
    },
  },
  {
    name: 'recall',
    description:
      'Retrieve memories by ID or search query. Without parameters, returns the full approved memory index. With id, returns a specific memory. With query, performs full-text search across approved memories.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'Specific memory ID to retrieve',
        },
        query: {
          type: 'string',
          description: 'Search query for full-text search across title and body',
        },
      },
    },
  },
  {
    name: 'supersede',
    description:
      'Replace an existing memory with a new one. The old memory is marked as superseded and the new one is created as a pending proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        old_id: {
          type: 'number',
          description: 'ID of the memory to supersede',
        },
        new_kind: {
          type: 'string',
          enum: ['user', 'feedback', 'project', 'reference'],
          description: 'Kind of the new memory',
        },
        new_title: {
          type: 'string',
          description: 'Title of the new memory',
        },
        new_body: {
          type: 'string',
          description: 'Body of the new memory',
        },
      },
      required: ['old_id', 'new_kind', 'new_title', 'new_body'],
    },
  },
  {
    name: 'forget',
    description:
      'Request deletion of a memory. Creates a pending deletion proposal that requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'ID of the memory to forget',
        },
      },
      required: ['id'],
    },
  },
]

async function handleToolCall(request: CallToolRequest): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'remember': {
        const input = args as unknown as RememberInput
        const result = await apiRequest('POST', '/api/memories', {
          repo: MEMORY_REPO,
          kind: input.kind,
          title: input.title,
          body: input.body,
          source_session_id: MEMORY_SESSION_ID || undefined,
        })
        return {
          content: [
            {
              type: 'text',
              text: `Memory saved as pending proposal:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        }
      }

      case 'recall': {
        const input = args as RecallByIdInput | RecallByQueryInput | Record<string, never>

        if ('id' in input && typeof input.id === 'number') {
          const result = await apiRequest('GET', `/api/memories/${input.id}`, undefined)
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        }

        if ('query' in input && typeof input.query === 'string') {
          const params = new URLSearchParams({
            repo: MEMORY_REPO,
            q: input.query,
            status: 'approved',
          })
          const result = await apiRequest('GET', `/api/memories?${params.toString()}`, undefined)
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        }

        const params = new URLSearchParams({
          repo: MEMORY_REPO,
          status: 'approved',
        })
        const result = await apiRequest('GET', `/api/memories?${params.toString()}`, undefined)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      }

      case 'supersede': {
        const input = args as unknown as SupersedeInput
        const result = await apiRequest('POST', `/api/memories/${input.old_id}/supersede`, {
          repo: MEMORY_REPO,
          kind: input.new_kind,
          title: input.new_title,
          body: input.new_body,
          source_session_id: MEMORY_SESSION_ID || undefined,
        })
        return {
          content: [
            {
              type: 'text',
              text: `Memory superseded:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        }
      }

      case 'forget': {
        const input = args as unknown as ForgetInput
        const result = await apiRequest('PATCH', `/api/memories/${input.id}`, {
          status: 'pending_deletion',
        })
        return {
          content: [
            {
              type: 'text',
              text: `Memory marked for deletion (pending approval):\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
    }
  }
}

async function main() {
  // @ts-expect-error - MCP SDK types only available after npm install
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js')
  // @ts-expect-error - MCP SDK types only available after npm install
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  // @ts-expect-error - MCP SDK types only available after npm install
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')

  const server = new Server(
    {
      name: 'memory-server',
      version: '1.0.0',
    } as ServerInfo,
    {
      capabilities: {
        tools: {},
      },
    } as ServerCapabilities
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }))

  server.setRequestHandler(CallToolRequestSchema, handleToolCall)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('[memory-server] started')
}

main().catch((err) => {
  console.error('[memory-server] fatal error:', err)
  process.exit(1)
})
