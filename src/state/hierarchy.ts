import type { ApiDagGraph, ApiSession } from '../api/types'

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
  const byThreadId = new Map<string, ApiSession>()
  for (const s of sessions) {
    byId.set(s.id, s)
    if (s.threadId !== undefined) byThreadId.set(String(s.threadId), s)
  }

  const consumed = new Set<string>()
  const groups: SessionGroup[] = []

  // 1. DAGs first. rootTaskId is the parent's threadId as a string.
  for (const dag of dags) {
    const parent = byThreadId.get(dag.rootTaskId) ?? null
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

  // 2. Non-DAG parent/child trees.
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

  // 3. Variant groups.
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

  // 4. Standalone.
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
