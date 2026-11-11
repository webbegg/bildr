import { describe, expect, it } from 'vitest'
import type { ComponentDefinition, DocNode, Project } from '#shared/document/schema'
import { copyName, detachedTree, replacedInstance, replaceProblem } from '#shared/document/instanceEdits'
import { resolveInstance } from '#shared/runtime/instances'

const node = (id: string, type: string, extra: Partial<DocNode> = {}): DocNode => ({ id, type, props: {}, style: {}, children: [], ...extra })

/** A Card: a Heading bound to Title, a slot Body, and a Flat variant that recolours the card. */
const card: ComponentDefinition = {
  id: 'cmp_card',
  name: 'Card',
  root: node('c_root', 'Card', {
    name: 'Shell',
    style: { p: '4', bg: 'muted' },
    children: [
      node('c_title', 'Heading', { name: 'Title text', props: { text: 'Default', level: 'h2' } }),
      node('c_body', 'Container', { children: [node('c_note', 'Text', { props: { text: 'Hi {{ prop.Title }}' } })] })
    ]
  }),
  properties: [
    { id: 'prop_title', name: 'Title', kind: 'text', bindings: [{ nodeId: 'c_title', prop: 'text' }] },
    { id: 'prop_body', name: 'Body', kind: 'slot', bindings: [{ nodeId: 'c_body', prop: 'children' }] }
  ],
  variants: [{ id: 'var_flat', name: 'Flat', overrides: { c_root: { style: { bg: 'default' }, unset: ['p'] } } }]
}

const tile: ComponentDefinition = {
  id: 'cmp_tile',
  name: 'Tile',
  root: node('t_root', 'Column', { children: [node('t_title', 'Text', { props: { text: 'Tile' } }), node('t_body', 'Container')] }),
  properties: [
    { id: 'prop_t_title', name: 'title', kind: 'text', bindings: [{ nodeId: 't_title', prop: 'text' }] },
    { id: 'prop_t_count', name: 'Count', kind: 'number', bindings: [] },
    { id: 'prop_t_body', name: 'Body', kind: 'slot', bindings: [{ nodeId: 't_body', prop: 'children' }] }
  ],
  variants: [{ id: 'var_t_flat', name: 'flat', overrides: {} }]
}

const instance = (extra: Partial<DocNode> = {}): DocNode => node('n_inst', 'Instance', {
  props: { component: 'cmp_card', variant: 'var_flat', prop_title: 'Latte' },
  style: { mt: '2' },
  children: [node('n_fill', 'SlotFill', { props: { slot: 'prop_body' }, children: [node('n_own', 'Text', { name: 'Own', props: { text: 'Mine' } })] })],
  ...extra
})

/** A rendered tree without ids and names, the parts that render. */
function shape(n: DocNode): unknown {
  return { type: n.type, props: n.props, style: n.style, children: n.children.map(shape) }
}

function ids(n: DocNode): string[] {
  return [n.id, ...n.children.flatMap(ids)]
}

describe('detachedTree', () => {
  it('renders the same as the instance did: variant, values and slot fills applied', () => {
    const detached = detachedTree(instance(), [card])!
    expect(shape(detached)).toEqual(shape(resolveInstance(instance(), [card])!))
    expect(detached.type).toBe('Card')
    expect(detached.style).toEqual({ bg: 'default', mt: '2' })
    expect(detached.children[0]!.props.text).toBe('Latte')
    expect(detached.children[1]!.children.map(c => c.props.text)).toEqual(['Mine'])
  })

  it('gives every node a new plain id', () => {
    const detached = detachedTree(instance(), [card])!
    const all = ids(detached)
    expect(new Set(all).size).toBe(all.length)
    for (const id of all) {
      expect(id).toMatch(/^n_[a-z0-9]+$/)
      expect(['n_inst', 'n_own', 'c_root', 'c_title']).not.toContain(id)
    }
  })

  it('keeps the layer name: the instance\'s own, else the component\'s; definition layers keep theirs', () => {
    expect(detachedTree(instance({ name: 'Hero card' }), [card])!.name).toBe('Hero card')
    const unnamed = detachedTree(instance(), [card])!
    expect(unnamed.name).toBe('Card')
    expect(unnamed.children[0]!.name).toBe('Title text')
    expect(unnamed.children[1]!.children[0]!.name).toBe('Own')
  })

  it('uses the property default when the instance sets no value', () => {
    const def = { ...card, properties: card.properties.map(p => (p.id === 'prop_title' ? { ...p, default: 'Mocha' } : p)) }
    const detached = detachedTree(instance({ props: { component: 'cmp_card' }, children: [] }), [def])!
    expect(detached.children[0]!.props.text).toBe('Mocha')
    expect(detached.children[1]!.children[0]!.props.text).toBe('Hi Mocha')
  })

  it('is null for an instance of a missing component', () => {
    expect(detachedTree(instance({ props: { component: 'cmp_gone' } }), [card])).toBeNull()
  })
})

describe('replacedInstance', () => {
  it('swaps the component and keeps the values, variant and slot fills whose names match (ignoring case)', () => {
    const replaced = replacedInstance(instance({ name: 'Hero' }), card, tile, [card, tile])
    expect(replaced).toMatchObject({ id: 'n_inst', name: 'Hero', style: { mt: '2' } })
    expect(replaced.props).toEqual({ component: 'cmp_tile', variant: 'var_t_flat', prop_t_title: 'Latte' })
    expect(replaced.children).toEqual([node('n_fill', 'SlotFill', { props: { slot: 'prop_t_body' }, children: [node('n_own', 'Text', { name: 'Own', props: { text: 'Mine' } })] })])
  })

  it('drops values, the variant and fills with no match', () => {
    const plain: ComponentDefinition = { id: 'cmp_plain', name: 'Plain', root: node('p_root', 'Container'), properties: [], variants: [] }
    const replaced = replacedInstance(instance(), card, plain, [card, plain])
    expect(replaced.props).toEqual({ component: 'cmp_plain' })
    expect(replaced.children).toEqual([])
  })

  it('drops a matching value of another kind, or one the new property refuses', () => {
    const counted: ComponentDefinition = { ...tile, properties: [{ id: 'prop_x', name: 'Title', kind: 'number', bindings: [] }] }
    expect(replacedInstance(instance(), card, counted, [card, counted]).props).toEqual({ component: 'cmp_tile', variant: 'var_t_flat' })
  })
})

describe('replaceProblem', () => {
  const project = (components: ComponentDefinition[]) => ({ components } as unknown as Project)
  const nested = (id: string, uses: string): ComponentDefinition => ({ id, name: id, root: node(`${id}_root`, 'Container', { children: [node(`${id}_i`, 'Instance', { props: { component: uses } })] }), properties: [], variants: [] })

  it('allows any component on a page or in a layout', () => {
    expect(replaceProblem(project([card, tile]), [{ pageId: 'p' }, { layoutId: 'l' }], 'cmp_tile')).toBeUndefined()
  })

  it('refuses a component inside itself, or one that contains the component it would go into', () => {
    const outer = nested('cmp_outer', 'cmp_card')
    const user = nested('cmp_user', 'cmp_outer')
    const components = [card, tile, outer, user]
    expect(replaceProblem(project(components), [{ componentId: 'cmp_outer' }], 'cmp_outer')).toBe('"cmp_outer" cannot contain itself: replacing would create a cycle')
    expect(replaceProblem(project(components), [{ componentId: 'cmp_outer' }], 'cmp_user')).toBe('"cmp_user" contains "cmp_outer": replacing would create a cycle')
    expect(replaceProblem(project(components), [{ componentId: 'cmp_outer' }], 'cmp_tile')).toBeUndefined()
  })
})

describe('copyName', () => {
  it('names a copy "<name> copy", numbered when taken (ignoring case)', () => {
    expect(copyName('Card', [{ name: 'Card' }])).toBe('Card copy')
    expect(copyName('Card', [{ name: 'Card' }, { name: 'card COPY' }])).toBe('Card copy 2')
  })
})
