import { describe, expect, it } from 'vitest'
import type { ModelNode } from '@bildr/codegen/model'
import { draggedNodeId, dropPosition, instancePayload, insertPayload, nodeDragType, nodePayload, resolveDrop } from '../../src/shared/dropTarget.ts'
import { parseDragPayload, parseInstancePayload } from '../../src/editor/drop.ts'

/** Ported from the hosted `test/editor/dropTarget.test.ts` (the layers tree's geometry), over `ModelNode` trees. */

const n = (id: string, type: string, children: ModelNode[] = []): ModelNode => ({ id, type, ...(children.length ? { children } : {}) })
/** root > [heading, card > [a, b]] */
const fixture = () => ({ root: n('root', 'Page', [n('heading', 'Heading'), n('card', 'Card', [n('a', 'Text'), n('b', 'Text')])]) })
const isContainer = (type: string) => ['Page', 'Card', 'Container'].includes(type)

describe('dropPosition', () => {
  const rect = { top: 100, left: 0, width: 200, height: 100 }

  it('splits leaves in halves along the axis', () => {
    expect(dropPosition(rect, { x: 10, y: 120 }, { container: false, horizontal: false })).toBe('before')
    expect(dropPosition(rect, { x: 10, y: 180 }, { container: false, horizontal: false })).toBe('after')
    expect(dropPosition(rect, { x: 150, y: 120 }, { container: false, horizontal: true })).toBe('after')
  })

  it('uses the middle of a container for inside', () => {
    expect(dropPosition(rect, { x: 10, y: 110 }, { container: true, horizontal: false })).toBe('before')
    expect(dropPosition(rect, { x: 10, y: 150 }, { container: true, horizontal: false })).toBe('inside')
    expect(dropPosition(rect, { x: 10, y: 195 }, { container: true, horizontal: false })).toBe('after')
  })
})

describe('resolveDrop', () => {
  it('drops before or after a node in its parent', () => {
    const { root } = fixture()
    expect(resolveDrop(root, 'b', 'before', undefined, isContainer)).toEqual({ parentId: 'card', index: 1 })
    expect(resolveDrop(root, 'b', 'after', undefined, isContainer)).toEqual({ parentId: 'card', index: 2 })
  })

  it('drops inside a container at the end, and anything on the root goes inside it', () => {
    const { root } = fixture()
    expect(resolveDrop(root, 'card', 'inside', undefined, isContainer)).toEqual({ parentId: 'card', index: 2 })
    expect(resolveDrop(root, 'root', 'before', undefined, isContainer)).toEqual({ parentId: 'root', index: 2 })
    // A leaf takes no drop inside: it lands after it.
    expect(resolveDrop(root, 'heading', 'inside', undefined, isContainer)).toEqual({ parentId: 'root', index: 1 })
  })

  it('refuses to drop a node into itself or its descendants', () => {
    const { root } = fixture()
    expect(resolveDrop(root, 'a', 'after', 'card', isContainer)).toBeNull()
    expect(resolveDrop(root, 'card', 'inside', 'card', isContainer)).toBeNull()
    expect(resolveDrop(root, 'a', 'after', 'root', isContainer)).toBeNull()
  })
})

describe('drag payloads', () => {
  it('carry the hosted payload (`kind`) alone, which a drop on the canvas or the layers reads', () => {
    expect(JSON.parse(insertPayload('Text'))).toEqual({ kind: 'component', type: 'Text' })
    expect(parseDragPayload(insertPayload('Text'))).toEqual({ kind: 'component', type: 'Text' })
    expect(JSON.parse(nodePayload('n_h1'))).toEqual({ kind: 'node', id: 'n_h1' })
    expect(parseDragPayload(nodePayload('n_h1'))).toEqual({ kind: 'node', id: 'n_h1' })
    expect(JSON.parse(instancePayload('cmp_x'))).toEqual({ kind: 'instance', componentId: 'cmp_x' })
    expect(parseInstancePayload(instancePayload('cmp_x'))).toBe('cmp_x')
  })

  it('name the dragged node in a type, readable during dragover', () => {
    expect(draggedNodeId(['text/plain', nodeDragType('n_h1')])).toBe('n_h1')
    expect(draggedNodeId(['application/x-bildr'])).toBeUndefined()
  })
})
