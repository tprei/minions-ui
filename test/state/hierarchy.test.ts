import { describe, it, expect } from 'vitest'
import type { ApiSession, ApiDagGraph } from '../../src/api/types'
import {
  buildSessionIndex,
  classifySessions,
  collectChildren,
  collectDescendants,
  findTreeRoot,
} from '../../src/state/hierarchy'

function makeSession(overrides: Partial<ApiSession> & { id: string; slug: string }): ApiSession {
  return {
    status: 'running',
    command: '/task test',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    childIds: [],
    needsAttention: false,
    attentionReasons: [],
    quickActions: [],
    mode: 'task',
    conversation: [],
    ...overrides,
  }
}

function makeDag(overrides: Partial<ApiDagGraph> & { id: string }): ApiDagGraph {
  return {
    rootTaskId: 'node-1',
    nodes: {},
    status: 'running',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('hierarchy', () => {
  describe('buildSessionIndex', () => {
    it('indexes sessions by id', () => {
      const sessions = [
        makeSession({ id: 'a', slug: 'alpha' }),
        makeSession({ id: 'b', slug: 'beta' }),
      ]
      const index = buildSessionIndex(sessions)
      expect(index.size).toBe(2)
      expect(index.get('a')?.slug).toBe('alpha')
      expect(index.get('b')?.slug).toBe('beta')
    })

    it('handles empty input', () => {
      expect(buildSessionIndex([]).size).toBe(0)
    })

    it('overwrites earlier entries with later ones when ids collide', () => {
      const sessions = [
        makeSession({ id: 'a', slug: 'first' }),
        makeSession({ id: 'a', slug: 'second' }),
      ]
      const index = buildSessionIndex(sessions)
      expect(index.size).toBe(1)
      expect(index.get('a')?.slug).toBe('second')
    })
  })

  describe('collectChildren', () => {
    it('collects direct children ids', () => {
      const sessions = [
        makeSession({ id: 'root', slug: 'root', childIds: ['c1', 'c2'] }),
        makeSession({ id: 'c1', slug: 'c1', parentId: 'root' }),
        makeSession({ id: 'c2', slug: 'c2', parentId: 'root' }),
      ]
      const index = buildSessionIndex(sessions)
      const collected = new Set<string>()
      collectChildren(sessions[0], index, collected)
      expect([...collected].sort()).toEqual(['c1', 'c2'])
    })

    it('recurses through deep trees', () => {
      const sessions = [
        makeSession({ id: 'root', slug: 'root', childIds: ['mid'] }),
        makeSession({ id: 'mid', slug: 'mid', parentId: 'root', childIds: ['leaf'] }),
        makeSession({ id: 'leaf', slug: 'leaf', parentId: 'mid' }),
      ]
      const index = buildSessionIndex(sessions)
      const collected = new Set<string>()
      collectChildren(sessions[0], index, collected)
      expect([...collected].sort()).toEqual(['leaf', 'mid'])
    })

    it('skips already-collected ids to avoid cycles', () => {
      const a = makeSession({ id: 'a', slug: 'a', childIds: ['b'] })
      const b = makeSession({ id: 'b', slug: 'b', parentId: 'a', childIds: ['a'] })
      const index = buildSessionIndex([a, b])
      const collected = new Set<string>()
      collectChildren(a, index, collected)
      expect([...collected].sort()).toEqual(['a', 'b'].filter((id) => collected.has(id)))
      expect(collected.has('b')).toBe(true)
    })

    it('tolerates missing child entries', () => {
      const root = makeSession({ id: 'root', slug: 'root', childIds: ['missing'] })
      const index = buildSessionIndex([root])
      const collected = new Set<string>()
      collectChildren(root, index, collected)
      expect(collected.has('missing')).toBe(true)
    })
  })

  describe('collectDescendants', () => {
    it('returns a new set of all descendants', () => {
      const sessions = [
        makeSession({ id: 'root', slug: 'root', childIds: ['mid'] }),
        makeSession({ id: 'mid', slug: 'mid', parentId: 'root', childIds: ['leaf'] }),
        makeSession({ id: 'leaf', slug: 'leaf', parentId: 'mid' }),
      ]
      const index = buildSessionIndex(sessions)
      const descendants = collectDescendants(sessions[0], index)
      expect([...descendants].sort()).toEqual(['leaf', 'mid'])
    })

    it('returns empty set for leaf sessions', () => {
      const leaf = makeSession({ id: 'leaf', slug: 'leaf' })
      const index = buildSessionIndex([leaf])
      expect(collectDescendants(leaf, index).size).toBe(0)
    })
  })

  describe('findTreeRoot', () => {
    it('walks up to the topmost ancestor', () => {
      const sessions = [
        makeSession({ id: 'root', slug: 'root', childIds: ['mid'] }),
        makeSession({ id: 'mid', slug: 'mid', parentId: 'root', childIds: ['leaf'] }),
        makeSession({ id: 'leaf', slug: 'leaf', parentId: 'mid' }),
      ]
      const index = buildSessionIndex(sessions)
      expect(findTreeRoot(sessions[2], index).id).toBe('root')
    })

    it('returns the session itself when it has no parent', () => {
      const orphan = makeSession({ id: 'orphan', slug: 'orphan' })
      const index = buildSessionIndex([orphan])
      expect(findTreeRoot(orphan, index).id).toBe('orphan')
    })

    it('stops walking when parent is excluded', () => {
      const sessions = [
        makeSession({ id: 'grand', slug: 'grand', childIds: ['parent'] }),
        makeSession({ id: 'parent', slug: 'parent', parentId: 'grand', childIds: ['child'] }),
        makeSession({ id: 'child', slug: 'child', parentId: 'parent' }),
      ]
      const index = buildSessionIndex(sessions)
      const excluded = new Set<string>(['grand'])
      expect(findTreeRoot(sessions[2], index, excluded).id).toBe('parent')
    })

    it('stops walking when parent is missing from the index', () => {
      const orphan = makeSession({ id: 'orphan', slug: 'orphan', parentId: 'missing' })
      const index = buildSessionIndex([orphan])
      expect(findTreeRoot(orphan, index).id).toBe('orphan')
    })
  })

  describe('classifySessions', () => {
    it('returns empty buckets for empty input', () => {
      const result = classifySessions([], [])
      expect(result.dagOwned.size).toBe(0)
      expect(result.parentChildRoots).toEqual([])
      expect(result.parentChildMembers.size).toBe(0)
      expect(result.standalone).toEqual([])
      expect(result.sessionById.size).toBe(0)
    })

    it('puts solo sessions in the standalone bucket', () => {
      const sessions = [
        makeSession({ id: 's1', slug: 'one' }),
        makeSession({ id: 's2', slug: 'two' }),
      ]
      const result = classifySessions(sessions, [])
      expect(result.standalone).toHaveLength(2)
      expect(result.parentChildRoots).toHaveLength(0)
    })

    it('identifies parent sessions with children as parent-child roots', () => {
      const sessions = [
        makeSession({ id: 'p', slug: 'parent', childIds: ['c1', 'c2'] }),
        makeSession({ id: 'c1', slug: 'c1', parentId: 'p' }),
        makeSession({ id: 'c2', slug: 'c2', parentId: 'p' }),
      ]
      const result = classifySessions(sessions, [])
      expect(result.parentChildRoots.map((s) => s.id)).toEqual(['p'])
      expect(result.parentChildMembers.has('p')).toBe(true)
      expect(result.parentChildMembers.has('c1')).toBe(true)
      expect(result.parentChildMembers.has('c2')).toBe(true)
      expect(result.standalone).toHaveLength(0)
    })

    it('auto-discovers a root from an orphaned child that arrives before its parent', () => {
      const sessions = [
        makeSession({ id: 'orphan-child', slug: 'child', parentId: 'parent' }),
        makeSession({ id: 'parent', slug: 'parent', childIds: ['orphan-child'] }),
      ]
      const result = classifySessions(sessions, [])
      expect(result.parentChildRoots.map((s) => s.id)).toEqual(['parent'])
      expect(result.parentChildMembers.has('orphan-child')).toBe(true)
      expect(result.standalone).toHaveLength(0)
    })

    it('marks DAG-owned sessions and excludes them from other buckets', () => {
      const dagSession = makeSession({ id: 'dag-session', slug: 'dag-owned' })
      const standalone = makeSession({ id: 'solo', slug: 'solo' })
      const dag = makeDag({
        id: 'dag-1',
        nodes: {
          n1: {
            id: 'n1',
            slug: 'node',
            status: 'running',
            dependencies: [],
            dependents: [],
            session: dagSession,
          },
        },
      })

      const result = classifySessions([dagSession, standalone], [dag])
      expect(result.dagOwned.has('dag-session')).toBe(true)
      expect(result.parentChildRoots).toHaveLength(0)
      expect(result.standalone.map((s) => s.id)).toEqual(['solo'])
    })

    it('does not promote a DAG-owned parent into a parent-child root', () => {
      const dagParent = makeSession({ id: 'dp', slug: 'dag-parent', childIds: ['child'] })
      const child = makeSession({ id: 'child', slug: 'child', parentId: 'dp' })
      const dag = makeDag({
        id: 'dag-1',
        nodes: {
          n1: {
            id: 'n1',
            slug: 'node',
            status: 'running',
            dependencies: [],
            dependents: [],
            session: dagParent,
          },
        },
      })
      const result = classifySessions([dagParent, child], [dag])
      expect(result.parentChildRoots).toHaveLength(0)
      expect(result.standalone.map((s) => s.id)).toEqual(['child'])
    })

    it('handles deep trees by placing only the root in parentChildRoots', () => {
      const sessions = [
        makeSession({ id: 'root', slug: 'root', childIds: ['mid'] }),
        makeSession({ id: 'mid', slug: 'mid', parentId: 'root', childIds: ['leaf'] }),
        makeSession({ id: 'leaf', slug: 'leaf', parentId: 'mid' }),
      ]
      const result = classifySessions(sessions, [])
      expect(result.parentChildRoots.map((s) => s.id)).toEqual(['root'])
      expect(result.parentChildMembers.size).toBe(3)
      expect(result.standalone).toHaveLength(0)
    })

    it('exposes a ready-built session index', () => {
      const sessions = [makeSession({ id: 'a', slug: 'alpha' })]
      const result = classifySessions(sessions, [])
      expect(result.sessionById.get('a')?.slug).toBe('alpha')
    })
  })
})
