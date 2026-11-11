import { describe, expect, it } from 'vitest'
import type { DocNode } from '#shared/document/schema'
import { colorSwapPlan, selectionColors } from '#shared/editor/selectionColors'

const n = (id: string, style: DocNode['style'] = {}, children: DocNode[] = []): DocNode => ({ id, type: 'Container', props: {}, style, children })

/** A section: a primary card with a primary title and a hex border, and a brand button. */
function section(): DocNode {
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
    const colors = selectionColors([root, root.children[0]!])
    expect(colors.find(c => c.value === 'primary')?.count).toBe(2)
  })

  it('ignores non-colour keys and is empty without colours', () => {
    expect(selectionColors([n('a', { p: '4', rounded: 'lg' })])).toEqual([])
    expect(selectionColors([])).toEqual([])
  })
})

describe('colorSwapPlan', () => {
  it('replaces a colour on every node and key that uses it, grouping nodes by the keys they change', () => {
    expect(colorSwapPlan([section()], 'primary', 'secondary')).toEqual([
      { nodeIds: ['card'], style: { bg: 'secondary' } },
      { nodeIds: ['title'], style: { color: 'secondary' } }
    ])
  })

  it('puts nodes changing the same keys in one group', () => {
    const root = n('r', {}, [n('a', { bg: 'primary' }), n('b', { bg: 'primary', color: 'muted' }), n('c', { bg: 'primary', color: 'primary' })])
    expect(colorSwapPlan([root], 'primary', '#123456')).toEqual([
      { nodeIds: ['a', 'b'], style: { bg: '#123456' } },
      { nodeIds: ['c'], style: { bg: '#123456', color: '#123456' } }
    ])
  })

  it('skips keys the replacement is not a value of, and does nothing for a same-colour swap', () => {
    // `elevated` is a background, not a text colour.
    expect(colorSwapPlan([section()], 'muted', 'elevated')).toEqual([{ nodeIds: ['sec'], style: { bg: 'elevated' } }])
    expect(colorSwapPlan([section()], 'primary', 'primary')).toEqual([])
  })

  it('accepts the theme colours it is given as replacements', () => {
    expect(colorSwapPlan([section()], '#ff6600', 'ink')).toEqual([])
    expect(colorSwapPlan([section()], '#ff6600', 'ink', ['ink'])).toEqual([{ nodeIds: ['card'], style: { borderColor: 'ink' } }])
  })
})
