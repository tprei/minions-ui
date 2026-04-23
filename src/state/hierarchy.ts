import type { ApiDagGraph, ApiSession } from '../api/types'

const SHIP_MODE_PREFIX = 'ship-'
const SHIP_MODE_EXACT = 'ship'

export function isShipMode(mode: string): boolean {
  return mode === SHIP_MODE_EXACT || mode.startsWith(SHIP_MODE_PREFIX)
}

export type SessionGroup =
  | { kind: 'dag'; dag: ApiDagGraph; parent: ApiSession | null; children: ApiSession[] }
  | { kind: 'parent-child'; parent: ApiSession; children: ApiSession[] }
  | { kind: 'variant'; groupId: string; sessions: ApiSession[] }
  | { kind: 'standalone'; session: ApiSession }

// Group sessions by their dominant relationship, in display order:
//   1. DAGs (with their parent + child sessions, if the parent is in `sessions`)
//   2. Non-DAG parent/child trees (plain `/split` without a DAG)
//   3. Variant groups (`session.variantGroupId` set, no DAG)
//   4. Standalone sessions
//
// A session only appears in one group — DAG membership wins over parent/child
// which wins over variant group which wins over standalone.
export function buildSessionGroups(sessions: ApiSession[], dags: ApiDagGraph[]): SessionGroup[] {
  const byId = new Map<string, ApiSession>()
  for (const s of sessions) {
    byId.set(s.id, s)
  }

  const consumed = new Set<string>()
  const groups: SessionGroup[] = []

  for (const dag of dags) {
    const parent = byId.get(dag.rootTaskId) ?? null
    const childIds = Object.values(dag.nodes)
      .map((n) => n.session?.id)
      .filter((id): id is string => typeof id === 'string')
    const children = childIds
      .map((id) => byId.get(id))
      .filter((s): s is ApiSession => !!s)
    if (parent) consumed.add(parent.id)
    for (const c of children) consumed.add(c.id)
    groups.push({ kind: 'dag', dag, parent, children: sortByUpdatedAt(children) })
  }

  for (const s of sessions) {
    if (consumed.has(s.id)) continue
    if (s.childIds.length === 0 || s.parentId) continue
    const children: ApiSession[] = []
    for (const cid of s.childIds) {
      const child = byId.get(cid)
      if (child && !consumed.has(child.id)) {
        children.push(child)
        consumed.add(child.id)
      }
    }
    consumed.add(s.id)
    groups.push({ kind: 'parent-child', parent: s, children: sortByUpdatedAt(children) })
  }

  const variantBuckets = new Map<string, ApiSession[]>()
  for (const s of sessions) {
    if (consumed.has(s.id)) continue
    if (!s.variantGroupId) continue
    const list = variantBuckets.get(s.variantGroupId) ?? []
    list.push(s)
    variantBuckets.set(s.variantGroupId, list)
  }
  for (const [groupId, members] of variantBuckets) {
    if (members.length === 0) continue
    for (const m of members) consumed.add(m.id)
    groups.push({ kind: 'variant', groupId, sessions: sortByUpdatedAt(members) })
  }

  const standalone: ApiSession[] = []
  for (const s of sessions) {
    if (consumed.has(s.id)) continue
    standalone.push(s)
  }
  for (const s of sortByUpdatedAt(standalone)) {
    groups.push({ kind: 'standalone', session: s })
  }

  return groups
}

function sortByUpdatedAt(list: ApiSession[]): ApiSession[] {
  return [...list].sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return 0
    return a.updatedAt < b.updatedAt ? 1 : -1
  })
}

export function buildSessionIndex(sessions: ApiSession[]): Map<string, ApiSession> {
  const index = new Map<string, ApiSession>()
  for (const s of sessions) index.set(s.id, s)
  return index
}

export function collectChildren(
  session: ApiSession,
  sessionById: Map<string, ApiSession>,
  collected: Set<string>,
  excluded?: Set<string>,
): void {
  for (const childId of session.childIds) {
    if (collected.has(childId)) continue
    if (excluded?.has(childId)) continue
    collected.add(childId)
    const child = sessionById.get(childId)
    if (child) collectChildren(child, sessionById, collected, excluded)
  }
}

export function collectDescendants(
  session: ApiSession,
  sessionById: Map<string, ApiSession>,
): Set<string> {
  const collected = new Set<string>()
  collectChildren(session, sessionById, collected)
  return collected
}

export function findTreeRoot(
  session: ApiSession,
  sessionById: Map<string, ApiSession>,
  excluded: Set<string> = new Set(),
): ApiSession {
  let root = session
  while (root.parentId && sessionById.has(root.parentId) && !excluded.has(root.parentId)) {
    root = sessionById.get(root.parentId)!
  }
  return root
}

export function findShipRoot(
  session: ApiSession,
  sessionById: Map<string, ApiSession>,
  excluded: Set<string> = new Set(),
): ApiSession {
  let root = session
  while (root.parentId && sessionById.has(root.parentId) && !excluded.has(root.parentId)) {
    const parent = sessionById.get(root.parentId)!
    if (!isShipMode(parent.mode)) break
    root = parent
  }
  return root
}

export function collectShipDescendants(
  session: ApiSession,
  sessionById: Map<string, ApiSession>,
  excluded: Set<string> = new Set(),
): Set<string> {
  const result = new Set<string>()
  function walk(s: ApiSession): void {
    for (const childId of s.childIds) {
      if (result.has(childId)) continue
      if (excluded.has(childId)) continue
      const child = sessionById.get(childId)
      if (!child) continue
      if (!isShipMode(child.mode)) continue
      result.add(childId)
      walk(child)
    }
  }
  walk(session)
  return result
}

export interface SessionClassification {
  dagOwned: Set<string>
  shipRoots: ApiSession[]
  shipMembers: Set<string>
  parentChildRoots: ApiSession[]
  parentChildMembers: Set<string>
  standalone: ApiSession[]
  sessionById: Map<string, ApiSession>
}

export function classifySessions(
  sessions: ApiSession[],
  dags: ApiDagGraph[],
): SessionClassification {
  const dagOwned = new Set<string>()
  for (const dag of dags) {
    for (const node of Object.values(dag.nodes)) {
      if (node.session) dagOwned.add(node.session.id)
    }
  }

  const sessionById = buildSessionIndex(sessions)

  const shipMembers = new Set<string>()
  const shipRoots: ApiSession[] = []

  for (const s of sessions) {
    if (dagOwned.has(s.id)) continue
    if (shipMembers.has(s.id)) continue
    if (!isShipMode(s.mode)) continue

    const root = findShipRoot(s, sessionById, dagOwned)
    if (dagOwned.has(root.id)) continue
    if (shipMembers.has(root.id)) continue

    shipRoots.push(root)
    shipMembers.add(root.id)
    for (const id of collectShipDescendants(root, sessionById, dagOwned)) {
      shipMembers.add(id)
    }
  }

  const excluded = new Set<string>([...dagOwned, ...shipMembers])

  const parentChildMembers = new Set<string>()
  const parentChildRoots: ApiSession[] = []

  for (const s of sessions) {
    if (excluded.has(s.id)) continue
    if (parentChildMembers.has(s.id)) continue

    if (s.childIds.length > 0 && !s.parentId) {
      parentChildRoots.push(s)
      parentChildMembers.add(s.id)
      collectChildren(s, sessionById, parentChildMembers, excluded)
    }
  }

  const standalone: ApiSession[] = []
  for (const s of sessions) {
    if (excluded.has(s.id) || parentChildMembers.has(s.id)) continue

    if (s.parentId && sessionById.has(s.parentId)) {
      const parent = sessionById.get(s.parentId)!
      if (parent.childIds.includes(s.id) && !excluded.has(parent.id)) {
        const root = findTreeRoot(parent, sessionById, excluded)
        if (!parentChildMembers.has(root.id) && !excluded.has(root.id)) {
          parentChildRoots.push(root)
          parentChildMembers.add(root.id)
          collectChildren(root, sessionById, parentChildMembers, excluded)
        }
        if (parentChildMembers.has(s.id)) continue
      }
    }
    standalone.push(s)
  }

  return {
    dagOwned,
    shipRoots,
    shipMembers,
    parentChildRoots,
    parentChildMembers,
    standalone,
    sessionById,
  }
}
