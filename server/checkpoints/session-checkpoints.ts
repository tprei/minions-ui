import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import type { SessionCheckpoint, SessionCheckpointKind } from '../../shared/api-types'
import { prepared, type SessionCheckpointRow, type SessionRow } from '../db/sqlite'
import { spawnWithTimeout } from '../workspace/git'

const CHECKPOINT_TIMEOUT_MS = 60_000
const CHECKPOINT_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Minions',
  GIT_AUTHOR_EMAIL: 'minions@example.invalid',
  GIT_COMMITTER_NAME: 'Minions',
  GIT_COMMITTER_EMAIL: 'minions@example.invalid',
}

interface SessionCheckpointMetadata {
  dagId?: string
  dagNodeId?: string
}

function parseMetadata(metadata: Record<string, unknown> | string | null): SessionCheckpointMetadata {
  const raw = typeof metadata === 'string' ? JSON.parse(metadata) as unknown : metadata
  if (!raw || typeof raw !== 'object') return {}
  const record = raw as Record<string, unknown>
  return {
    dagId: typeof record.dagId === 'string' ? record.dagId : undefined,
    dagNodeId: typeof record.dagNodeId === 'string' ? record.dagNodeId : undefined,
  }
}

function checkpointRef(sessionId: string, checkpointId: string): string {
  return `refs/minions/checkpoints/${sessionId}/${checkpointId}`
}

async function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = await spawnWithTimeout('git', args, {
    cwd,
    env: { ...process.env, ...CHECKPOINT_GIT_IDENTITY, ...env },
    timeoutMs: CHECKPOINT_TIMEOUT_MS,
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.exitCode})\n${result.stderr.slice(-1500)}`)
  }
  return result
}

function sessionCwd(row: SessionRow): string {
  if (!row.workspace_root) {
    throw new Error(`Session ${row.id} has no workspace root`)
  }
  return path.join(row.workspace_root, row.slug)
}

export function canCheckpointSession(row: SessionRow): boolean {
  if (!row.workspace_root || !row.branch) return false
  return fs.existsSync(sessionCwd(row))
}

export function checkpointRowToApi(row: SessionCheckpointRow): SessionCheckpoint {
  return {
    id: row.id,
    sessionId: row.session_id,
    turn: row.turn,
    kind: row.kind,
    label: row.label,
    sha: row.sha,
    baseSha: row.base_sha,
    branch: row.branch ?? undefined,
    dagId: row.dag_id ?? undefined,
    dagNodeId: row.dag_node_id ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export async function createSessionCheckpoint(opts: {
  db: Database
  session: SessionRow
  turn: number
  kind: SessionCheckpointKind
  label?: string
}): Promise<SessionCheckpoint> {
  const cwd = sessionCwd(opts.session)
  const id = randomUUID()
  const indexFile = path.join(os.tmpdir(), `minions-checkpoint-${opts.session.id}-${id}.index`)
  const indexEnv = { GIT_INDEX_FILE: indexFile }
  const head = (await runGit(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
  const headTree = (await runGit(cwd, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()

  try {
    await runGit(cwd, ['read-tree', 'HEAD'], indexEnv)
    await runGit(cwd, ['add', '-A', '--', '.'], indexEnv)
    const tree = (await runGit(cwd, ['write-tree'], indexEnv)).stdout.trim()
    const sha = tree === headTree
      ? head
      : (await runGit(cwd, ['commit-tree', tree, '-p', head, '-m', opts.label ?? `${opts.kind} checkpoint`], indexEnv)).stdout.trim()
    await runGit(cwd, ['update-ref', checkpointRef(opts.session.id, id), sha])

    const metadata = parseMetadata(opts.session.metadata)
    const now = Date.now()
    const row: SessionCheckpointRow = {
      id,
      session_id: opts.session.id,
      turn: opts.turn,
      kind: opts.kind,
      label: opts.label ?? (opts.kind === 'turn' ? `Turn ${opts.turn}` : 'Session checkpoint'),
      sha,
      base_sha: head,
      branch: opts.session.branch,
      dag_id: metadata.dagId ?? null,
      dag_node_id: metadata.dagNodeId ?? null,
      created_at: now,
    }
    prepared.insertSessionCheckpoint(opts.db, row)
    return checkpointRowToApi(row)
  } finally {
    if (fs.existsSync(indexFile)) {
      fs.rmSync(indexFile, { force: true })
    }
  }
}

export async function restoreSessionCheckpoint(opts: {
  db: Database
  session: SessionRow
  checkpointId: string
}): Promise<SessionCheckpoint> {
  const checkpoint = prepared.getSessionCheckpoint(opts.db, opts.checkpointId)
  if (!checkpoint || checkpoint.session_id !== opts.session.id) {
    throw new Error('Checkpoint not found')
  }

  const cwd = sessionCwd(opts.session)
  const ref = checkpointRef(opts.session.id, checkpoint.id)
  const refSha = (await runGit(cwd, ['rev-parse', '--verify', ref])).stdout.trim()
  if (refSha !== checkpoint.sha) {
    throw new Error(`Checkpoint ref ${ref} points to ${refSha}, expected ${checkpoint.sha}`)
  }

  await runGit(cwd, ['clean', '-fd'])
  await runGit(cwd, ['restore', '--source', checkpoint.sha, '--staged', '--worktree', '--', '.'])
  await runGit(cwd, ['reset'])

  const metadata = { ...opts.session.metadata, restoredCheckpointId: checkpoint.id, restoredAt: Date.now() }
  prepared.updateSession(opts.db, {
    id: opts.session.id,
    metadata,
    updated_at: Date.now(),
  })

  return checkpointRowToApi(checkpoint)
}
