import { test, expect } from '@playwright/test'
import { createMockMinion } from '../fixtures/mock-minion'
import { connectToMinion } from '../helpers/connect'
import type { ApiSession, MinionCommand } from '../../src/api/types'

const SESSION_ID = 'feedback-source-1'
const BLOCK_ID = 'block-abc'

function makeSourceSession(): ApiSession {
  const now = new Date().toISOString()
  return {
    id: SESSION_ID,
    slug: 'source-task',
    status: 'running',
    command: '/task explain something',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [{ role: 'user', text: 'explain something' }],
    createdAt: now,
    updatedAt: now,
  }
}

test.describe('feedback flow', () => {
  test('thumbs-down opens reason popup, submits, and spawns a feedback minion', async ({ page }) => {
    const mock = await createMockMinion({ token: 'tok' })
    mock.setVersion({ features: ['messages', 'message-feedback', 'transcript'] })
    mock.setSessions([makeSourceSession()])

    try {
      await connectToMinion(page, mock, 'Feedback Minion')

      await expect(page.getByTestId(`session-item-${SESSION_ID}`)).toBeVisible({ timeout: 8_000 })
      await page.getByTestId(`session-item-${SESSION_ID}`).click()
      await expect(page.getByTestId('message-textarea')).toBeVisible({ timeout: 5_000 })

      mock.emit({
        type: 'transcript_event',
        sessionId: SESSION_ID,
        event: {
          seq: 1,
          id: 'evt-1',
          sessionId: SESSION_ID,
          turn: 1,
          timestamp: Date.now(),
          type: 'assistant_text',
          blockId: BLOCK_ID,
          text: 'Here is a confidently incorrect answer.',
          final: true,
        },
      })

      await expect(page.getByTestId('transcript-assistant-text').first()).toBeVisible({ timeout: 5_000 })

      const downBtn = page.getByTestId(`feedback-thumbs-down-${BLOCK_ID}`)
      await expect(downBtn).toBeVisible({ timeout: 5_000 })
      await downBtn.click()

      const popup = page.getByTestId('feedback-reason-popup')
      await expect(popup).toBeVisible({ timeout: 5_000 })

      await popup.getByTestId('feedback-reason-incorrect').click()
      await popup.getByTestId('feedback-submit-btn').click()

      await expect
        .poll(
          () =>
            mock.lastCommands.find(
              (c): c is Extract<MinionCommand, { action: 'submit_feedback' }> =>
                c.action === 'submit_feedback',
            ),
          { timeout: 5_000 },
        )
        .toMatchObject({
          action: 'submit_feedback',
          sessionId: SESSION_ID,
          messageBlockId: BLOCK_ID,
          vote: 'down',
          reason: 'incorrect',
        })

      const feedbackSession = await page.evaluate(async (url) => {
        const res = await fetch(`${url}/api/sessions`, { headers: { Authorization: 'Bearer tok' } })
        const json = (await res.json()) as { data: Array<{ id: string; parentId?: string; mode: string }> }
        return json.data.find((s) => s.parentId && s.mode === 'feedback')
      }, mock.url)
      expect(feedbackSession?.id).toBeTruthy()

      const feedbackId = feedbackSession!.id
      await expect(page.getByTestId(`session-item-${feedbackId}`)).toBeVisible({ timeout: 8_000 })

      const universeNode = page.getByTestId(`universe-node-${feedbackId}`)
      await expect(universeNode).toBeVisible()
      await expect(universeNode.getByTestId('feedback-badge')).toBeVisible()
    } finally {
      await mock.close()
    }
  })

  test('thumbs-up submits immediately without a popup', async ({ page }) => {
    const mock = await createMockMinion({ token: 'tok' })
    mock.setVersion({ features: ['messages', 'message-feedback', 'transcript'] })
    mock.setSessions([makeSourceSession()])

    try {
      await connectToMinion(page, mock, 'Feedback Minion')

      await page.getByTestId(`session-item-${SESSION_ID}`).click()
      await expect(page.getByTestId('message-textarea')).toBeVisible({ timeout: 5_000 })

      mock.emit({
        type: 'transcript_event',
        sessionId: SESSION_ID,
        event: {
          seq: 1,
          id: 'evt-1',
          sessionId: SESSION_ID,
          turn: 1,
          timestamp: Date.now(),
          type: 'assistant_text',
          blockId: BLOCK_ID,
          text: 'A great answer.',
          final: true,
        },
      })

      await expect(page.getByTestId('transcript-assistant-text').first()).toBeVisible({ timeout: 5_000 })

      await page.getByTestId(`feedback-thumbs-up-${BLOCK_ID}`).click()

      await expect(page.getByTestId('feedback-reason-popup')).not.toBeVisible()

      await expect
        .poll(
          () =>
            mock.lastCommands.find(
              (c): c is Extract<MinionCommand, { action: 'submit_feedback' }> =>
                c.action === 'submit_feedback',
            ),
          { timeout: 5_000 },
        )
        .toMatchObject({
          action: 'submit_feedback',
          sessionId: SESSION_ID,
          messageBlockId: BLOCK_ID,
          vote: 'up',
        })
    } finally {
      await mock.close()
    }
  })
})
