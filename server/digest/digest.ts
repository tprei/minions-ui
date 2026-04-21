import type { Database } from 'bun:sqlite'
import type { DigestBuilder } from '../handlers/types'

const TOTAL_BUDGET = 3000
const PER_MESSAGE_CAP = 500

interface ConversationMessage {
  role: string
  text: string
}

interface SessionDbRow {
  conversation: string
  parent_id: string | null
  command: string
}

function stripToolNoise(text: string): string {
  let result = text
  result = result.replace(/<tool_use_id>[^<]*<\/tool_use_id>/g, '')
  result = result.replace(/stdout[\s\S]{200,}?(?=\n\n|\n[A-Z]|$)/g, (match) => {
    if (match.length > 300) {
      return match.slice(0, 300) + '\n[stdout truncated]'
    }
    return match
  })
  return result.trim()
}

function capMessage(text: string): string {
  if (text.length <= PER_MESSAGE_CAP) return text
  return text.slice(0, PER_MESSAGE_CAP) + ' …[truncated]'
}

export function buildConversationDigest(conversation: ConversationMessage[]): string {
  const parts: string[] = []
  let budget = TOTAL_BUDGET

  for (const msg of conversation) {
    if (budget <= 0) break

    const cleaned = capMessage(stripToolNoise(msg.text))
    const label = msg.role === 'user' ? 'User' : 'Agent'
    const entry = `**${label}:** ${cleaned}`

    if (entry.length > budget) {
      parts.push(entry.slice(0, budget) + ' …')
      budget = 0
    } else {
      parts.push(entry)
      budget -= entry.length
    }
  }

  if (parts.length === 0) return ''

  const body = parts.join('\n\n')
  return `<details><summary>Conversation digest</summary>\n\n${body}\n\n</details>`
}

export interface ChildDigestOpts {
  childConversation: ConversationMessage[]
  parentConversation?: ConversationMessage[]
  profile?: { haikuModel?: string }
}

export function buildChildSessionDigest(opts: ChildDigestOpts): string {
  const { childConversation, parentConversation } = opts
  const parts: string[] = []

  if (parentConversation && parentConversation.length > 0) {
    const lastParent = parentConversation[parentConversation.length - 1]
    if (lastParent) {
      const cleaned = capMessage(stripToolNoise(lastParent.text))
      parts.push(`**Parent context:** ${cleaned}`)
      parts.push('')
    }
  }

  parts.push(buildConversationDigest(childConversation))

  return parts.join('\n')
}

export function createDigestBuilder(): DigestBuilder {
  return {
    build: async (sessionId: string, db: Database): Promise<string> => {
      const row = db
        .query<SessionDbRow, [string]>(
          'SELECT conversation, parent_id, command FROM sessions WHERE id = ?',
        )
        .get(sessionId)

      if (!row) return ''

      const conversation = JSON.parse(row.conversation) as ConversationMessage[]

      if (row.parent_id) {
        const parentRow = db
          .query<{ conversation: string }, [string]>(
            'SELECT conversation FROM sessions WHERE id = ?',
          )
          .get(row.parent_id)

        const parentConversation = parentRow
          ? (JSON.parse(parentRow.conversation) as ConversationMessage[])
          : undefined

        return buildChildSessionDigest({ childConversation: conversation, parentConversation })
      }

      return buildConversationDigest(conversation)
    },
  }
}
