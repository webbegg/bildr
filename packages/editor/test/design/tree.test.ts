import { describe, expect, it } from 'vitest'
import type { ModelNode } from '@bildr/codegen/model'
import { findNode, findParent, moveTarget, slotIndex } from '../../src/design/tree.ts'

const node = (id: string, children?: ModelNode[]): ModelNode => ({ id, type: children ? 'Container' : 'Text', ...(children ? { children } : {}) })

const root = node('root', [node('a'), node('b', [node('b1'), node('b2')]), node('c')])

describe('design tree helpers', () => {
  it('finds nodes and their parents', () => {
    expect(findNode(root, 'b2')?.id).toBe('b2')
    expect(findNode(root, 'zz')).toBeUndefined()
    expect(findParent(root, 'b2')?.id).toBe('b')
    expect(findParent(root, 'root')).toBeUndefined()
  })

  it('maps a drop on a layer row to the parent and the index node_move takes (after the move)', () => {
    // After c: the dragged node was before it in the same parent, so the index drops by one.
    expect(moveTarget(root, 'a', 'c', 'after')).toEqual({ parentId: 'root', index: 2 })
    // Before a: moving c up.
    expect(moveTarget(root, 'c', 'a', 'before')).toEqual({ parentId: 'root', index: 0 })
    // Inside a container goes last.
    expect(moveTarget(root, 'a', 'b', 'inside')).toEqual({ parentId: 'b', index: 2 })
    // Into another parent keeps the raw index.
    expect(moveTarget(root, 'a', 'b2', 'before')).toEqual({ parentId: 'b', index: 1 })
  })

  it('refuses drops onto itself, its own subtree, the root\'s siblings and leaves', () => {
    expect(moveTarget(root, 'b', 'b', 'before')).toBeNull()
    expect(moveTarget(root, 'b', 'b1', 'after')).toBeNull()
    expect(moveTarget(root, 'a', 'root', 'before')).toBeNull()
    expect(moveTarget(root, 'a', 'c', 'inside')).toBeNull()
  })

  it('turns a canvas drop slot (an index among the current children) into node_move\'s index', () => {
    expect(slotIndex(root, 'a', 'root', 3)).toBe(2)
    expect(slotIndex(root, 'c', 'root', 0)).toBe(0)
    expect(slotIndex(root, 'a', 'b', 1)).toBe(1)
  })
})
