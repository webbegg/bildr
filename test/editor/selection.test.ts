import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { selectionAfterDelete } from '#shared/editor/selection'
import { isCanvasMessage } from '#shared/editor/protocol'

describe('selectionAfterDelete', () => {
  const page = createPage('Home')
  const row = createNode('Row')
  const [a, b, c] = [createNode('Text'), createNode('Text'), createNode('Text')]
  row.children.push(a, b, c)
  page.root.children.push(row)

  it('prefers the next sibling, then the previous one, then the parent', () => {
    expect(selectionAfterDelete(page.root, b.id)).toBe(c.id)
    expect(selectionAfterDelete(page.root, c.id)).toBe(b.id)
    expect(selectionAfterDelete(page.root, row.id)).toBe(page.root.id)
  })

  it('returns null for the root or a missing node', () => {
    expect(selectionAfterDelete(page.root, page.root.id)).toBeNull()
    expect(selectionAfterDelete(page.root, 'missing')).toBeNull()
  })
})

describe('isCanvasMessage', () => {
  it('accepts bildr messages and ignores everything else', () => {
    expect(isCanvasMessage({ type: 'bildr:click', nodeId: 'n_1' })).toBe(true)
    expect(isCanvasMessage({ type: 'webpackOk' })).toBe(false)
    expect(isCanvasMessage('bildr:click')).toBe(false)
    expect(isCanvasMessage(null)).toBe(false)
  })
})
