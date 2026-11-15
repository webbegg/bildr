import { describe, expect, it } from 'vitest'
import type { ModelNode } from '@bildr/codegen/model'
import { colorSwapPlan, selectionColors } from '../../src/shared/selectionColors.ts'

/** The hosted `test/editor/selectionColors.test.ts` over `ModelNode` trees. */

const n = (id: string, style: ModelNode['style'] = {}, children: ModelNode[] = []): ModelNode => ({ id, type: 'Container', style, children })

/** A section: a primary card with a primary title and a hex border, and a brand button. */
function section(): ModelNode {
  return n('sec', { bg: 'muted', p: '4' }, [
    n('card', { bg: 'primary', borderColor: '#ff6600', rounded: 'lg' }, [
      n('title', { color: 'primary' }),
      n('body', { color: 'muted' })
    ]),
    n('cta', { bg: 'brand', color: 'inverted' })
  ])
}

describe('selectionColors', () => {
  it('lists every colour of the subtree with its usage count, most used first', () => {
    expect(selectionColors([section()])).toEqual([
      { value: 'muted', kind: 'token', count: 2, keys: ['bg', 'color'] },
      { value: 'primary', kind: 'token', count: 2, keys: ['bg', 'color'] },
      { value: '#ff6600', kind: 'hex', count: 1, keys: ['borderColor'] },
      { value: 'brand', kind: 'custom', count: 1, keys: ['bg'] },
      { value: 'inverted', kind: 'token', count: 1, keys: ['color'] }
    ])
  })

  it('counts a node once when it and an ancestor are both selected', () => {
    const root = section()
    const colors = selectionColors([root, root.children![0]!])
    expect(colors.find(c => c.value === 'primary')?.count).toBe(2)
  })

  it('ignores non-colour keys, nodes without a style and is empty without colours', () => {
    expect(selectionColors([n('a', { p: '4', rounded: 'lg' })])).toEqual([])
    expect(selectionColors([{ id: 'bare', type: 'Text' }])).toEqual([])
    expect(selectionColors([])).toEqual([])
  })
})

describe('colorSwapPlan', () => {
  it('swaps a colour on every key of the subtree that holds it, one entry per node', () => {
    expect(colorSwapPlan([section()], 'primary', 'success')).toEqual([
      { nodeId: 'card', style: { bg: 'success' } },
      { nodeId: 'title', style: { color: 'success' } }
    ])
  })

  it('leaves a key the new colour is not a value of, and does nothing for the same colour', () => {
    // `inverted` is a text colour and a background, but `highlighted` is a text colour only.
    expect(colorSwapPlan([section()], 'muted', 'highlighted')).toEqual([{ nodeId: 'body', style: { color: 'highlighted' } }])
    expect(colorSwapPlan([section()], 'primary', 'primary')).toEqual([])
  })

  it('takes a theme colour name only when it is one of the theme\'s', () => {
    expect(colorSwapPlan([section()], 'primary', 'ink')).toEqual([])
    expect(colorSwapPlan([section()], 'primary', 'ink', ['ink']).map(entry => entry.nodeId)).toEqual(['card', 'title'])
  })
})
