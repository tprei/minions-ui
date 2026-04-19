import type { ApiDagGraph, ApiSession } from '../api/types'

export function buildSessionIndex(sessions: ApiSession[]): Map<string, ApiSession> {
  const index = new Map<string, ApiSession>()
  for (const s of sessions) index.set(s.id, s)
  return index
}

export function collectChildren(
  session: ApiSession,
  sessionById: Map<string, ApiSession>,
  collected: Set<string>,
): void {
  for (const childId of session.childIds) {
    if (collected.has(childId)) continue
    collected.add(childId)
    const child = sessionById.get(childId)
    if (child) collectChildren(child, sessionById, collected)
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

export interface SessionClassification {
  dagOwned: Set<string>
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

  const parentChildMembers = new Set<string>()
  const parentChildRoots: ApiSession[] = []

  for (const s of sessions) {
    if (dagOwned.has(s.id)) continue
    if (parentChildMembers.has(s.id)) continue

    if (s.childIds.length > 0 && !s.parentId) {
      parentChildRoots.push(s)
      parentChildMembers.add(s.id)
      collectChildren(s, sessionById, parentChildMembers)
    }
  }

  const standalone: ApiSession[] = []
  for (const s of sessions) {
    if (dagOwned.has(s.id) || parentChildMembers.has(s.id)) continue

    if (s.parentId && sessionById.has(s.parentId)) {
      const parent = sessionById.get(s.parentId)!
      if (parent.childIds.includes(s.id) && !dagOwned.has(parent.id)) {
        const root = findTreeRoot(parent, sessionById, dagOwned)
        if (!parentChildMembers.has(root.id)) {
          parentChildRoots.push(root)
          parentChildMembers.add(root.id)
          collectChildren(root, sessionById, parentChildMembers)
        }
        parentChildMembers.add(s.id)
        continue
      }
    }
    standalone.push(s)
  }

  return { dagOwned, parentChildRoots, parentChildMembers, standalone, sessionById }
}
