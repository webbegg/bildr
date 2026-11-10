import { describe, expect, it } from 'vitest'
import type { ComponentDefinition, DocNode } from '#shared/document/schema'
import { isDefinitionNodeId, pageNodeId, resolveInstance, walkResolved } from '#shared/runtime/instances'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = [], style: DocNode['style'] = {}): DocNode =>
  ({ id, type, props, style, children })

/** A card with a title text, a body slot (default content: one Text) and a variant. */
function card(): ComponentDefinition {
  return {
    id: 'card',
    name: 'Card',
    root: n('root', 'Card', {}, [
      n('title', 'Heading', { text: 'Title: {{ prop.Title }}' }, [], { color: 'default' }),
      n('body', 'Container', {}, [n('hint', 'Text', { text: 'Default body' })])
    ]),
    properties: [
      { id: 'p-title', name: 'Title', kind: 'text', default: 'Hi', bindings: [{ nodeId: 'title', prop: 'text' }] },
      { id: 'p-body', name: 'Body', kind: 'slot', bindings: [{ nodeId: 'body', prop: 'children' }] }
    ],
    variants: [{ id: 'dark', name: 'Dark', overrides: { title: { props: { level: '3' }, style: { color: 'primary' } } } }]
  }
}

const instance = (props: DocNode['props'] = {}, children: DocNode[] = [], id = 'i1', style: DocNode['style'] = {}) =>
  n(id, 'Instance', { component: 'card', ...props }, children, style)
const find = (root: DocNode, id: string): DocNode | undefined => root.id === id ? root : root.children.map(c => find(c, id)).find(Boolean)

describe('resolveInstance', () => {
  it('renders the definition tree with ids prefixed by the instance id', () => {
    const tree = resolveInstance(instance(), [card()])!
    expect(tree.id).toBe('i1/root')
    expect(tree.type).toBe('Card')
    expect(tree.children.map(c => c.id)).toEqual(['i1/title', 'i1/body'])
    expect(find(tree, 'i1/hint')?.props.text).toBe('Default body')
  })

  it('does not change the definition', () => {
    const def = card()
    const before = JSON.stringify(def)
    resolveInstance(instance({ 'p-title': 'X' }, [n('f', 'SlotFill', { slot: 'p-body' }, [n('a', 'Text')])]), [def])
    expect(JSON.stringify(def)).toBe(before)
  })

  it('applies instance values, else the property default, to the bound prop', () => {
    expect(find(resolveInstance(instance({ 'p-title': 'Hello' }), [card()])!, 'i1/title')?.props.text).toBe('Hello')
    expect(find(resolveInstance(instance(), [card()])!, 'i1/title')?.props.text).toBe('Hi')
  })

  it('keeps the bound node\'s own value without an instance value or default', () => {
    const def = card()
    delete def.properties[0]!.default
    def.root.children[0]!.props.text = 'Own'
    expect(find(resolveInstance(instance(), [def])!, 'i1/title')?.props.text).toBe('Own')
  })

  it('merges the variant\'s sparse overrides over the primary', () => {
    const title = find(resolveInstance(instance({ variant: 'dark' }), [card()])!, 'i1/title')!
    expect(title.props.level).toBe('3')
    expect(title.style.color).toBe('primary')
    expect(find(resolveInstance(instance(), [card()])!, 'i1/title')!.style.color).toBe('default')
  })

  it('falls back to the primary variant for an unknown or empty variant', () => {
    expect(find(resolveInstance(instance({ variant: 'nope' }), [card()])!, 'i1/title')!.style.color).toBe('default')
    expect(find(resolveInstance(instance({ variant: '' }), [card()])!, 'i1/title')!.style.color).toBe('default')
  })

  it('replaces the slot container\'s children with the fill, keeping their page ids', () => {
    const fill = n('f', 'SlotFill', { slot: 'p-body' }, [n('a', 'Text', { text: 'A' }), n('b', 'Text', { text: 'B' })])
    const body = find(resolveInstance(instance({}, [fill]), [card()])!, 'i1/body')!
    expect(body.children.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('renders the default content for an unfilled slot', () => {
    const fill = n('f', 'SlotFill', { slot: 'other' }, [n('a', 'Text')])
    expect(find(resolveInstance(instance({}, [fill]), [card()])!, 'i1/body')!.children.map(c => c.id)).toEqual(['i1/hint'])
  })

  it('resolves {{ prop.NAME }} in definition strings, leaving unknown names and other bindings', () => {
    const def = card()
    def.root.children[1]!.children[0]!.props.text = '{{ prop.Title }}|{{ prop.Nope }}|{{ item.name }}|{{ env.X }}'
    const text = find(resolveInstance(instance({ 'p-title': 'T' }), [def])!, 'i1/hint')!.props.text
    expect(text).toBe('T|{{ prop.Nope }}|{{ item.name }}|{{ env.X }}')
  })

  it('renders a known property without a value as empty in prop refs', () => {
    const def = card()
    delete def.properties[0]!.default
    expect(find(resolveInstance(instance(), [def])!, 'i1/hint')).toBeDefined()
    def.root.children[1]!.children[0]!.props.text = '[{{ prop.Title }}]'
    expect(find(resolveInstance(instance(), [def])!, 'i1/hint')!.props.text).toBe('[]')
  })

  it('does not resolve prop refs inside values a property sets', () => {
    expect(find(resolveInstance(instance({ 'p-title': '{{ prop.Title }}' }), [card()])!, 'i1/title')?.props.text).toBe('{{ prop.Title }}')
  })

  it('merges the instance\'s own style over the root\'s', () => {
    const def = card()
    def.root.style = { p: '4', w: 'full' }
    expect(resolveInstance(instance({}, [], 'i1', { w: '1/2' }), [def])!.style).toEqual({ p: '4', w: '1/2' })
  })

  it('resolves nested instances, composing the id prefix', () => {
    const outer: ComponentDefinition = {
      id: 'outer',
      name: 'Outer',
      root: n('o-root', 'Container', {}, [n('inner', 'Instance', { 'component': 'card', 'p-title': '{{ prop.Label }}' })]),
      properties: [{ id: 'p-label', name: 'Label', kind: 'text', default: 'L', bindings: [] }],
      variants: []
    }
    const tree = resolveInstance(n('x', 'Instance', { 'component': 'outer', 'p-label': 'Deep' }), [card(), outer])!
    expect(find(tree, 'x/inner/title')?.props.text).toBe('Deep')
    expect(tree.children[0]!.id).toBe('x/inner/root')
  })

  it('lets an outer slot fill reach into a nested instance\'s slot', () => {
    const outer: ComponentDefinition = {
      id: 'outer',
      name: 'Outer',
      root: n('o-root', 'Container', {}, [n('inner', 'Instance', { component: 'card' }, [n('sf', 'SlotFill', { slot: 'p-body' }, [n('o-text', 'Text')])])]),
      properties: [],
      variants: []
    }
    const tree = resolveInstance(n('x', 'Instance', { component: 'outer' }), [card(), outer])!
    expect(find(tree, 'x/inner/body')!.children.map(c => c.id)).toEqual(['x/o-text'])
  })

  it('leaves page Instances in slot content for the renderer to resolve', () => {
    const nested = instance({}, [], 'inner-page')
    const fill = n('f', 'SlotFill', { slot: 'p-body' }, [nested])
    expect(find(resolveInstance(instance({}, [fill]), [card()])!, 'i1/body')!.children[0]).toBe(nested)
  })

  it('returns null for a missing definition', () => {
    expect(resolveInstance(instance({ component: 'gone' }), [card()])).toBeNull()
  })

  it('drops an instance that would contain itself instead of looping', () => {
    const loop: ComponentDefinition = {
      id: 'loop',
      name: 'Loop',
      root: n('l-root', 'Container', {}, [n('l-text', 'Text'), n('again', 'Instance', { component: 'loop' })]),
      properties: [],
      variants: []
    }
    const tree = resolveInstance(n('x', 'Instance', { component: 'loop' }), [loop])!
    expect(tree.children.map(c => c.id)).toEqual(['x/l-text'])
  })

  it('stops mutual cycles and runaway nesting', () => {
    const a: ComponentDefinition = { id: 'a', name: 'A', root: n('ra', 'Container', {}, [n('ia', 'Instance', { component: 'b' })]), properties: [], variants: [] }
    const b: ComponentDefinition = { id: 'b', name: 'B', root: n('rb', 'Container', {}, [n('ib', 'Instance', { component: 'a' })]), properties: [], variants: [] }
    expect(resolveInstance(n('x', 'Instance', { component: 'a' }), [a, b])).not.toBeNull()
  })
})

describe('instance ids', () => {
  it('maps resolved ids back to the page instance', () => {
    expect(pageNodeId('i1/root')).toBe('i1')
    expect(pageNodeId('i1/inner/title')).toBe('i1')
    expect(pageNodeId('plain')).toBe('plain')
  })

  it('tells definition-derived ids from page ids', () => {
    expect(isDefinitionNodeId('i1/title')).toBe(true)
    expect(isDefinitionNodeId('title')).toBe(false)
  })
})

describe('walkResolved', () => {
  it('visits definition nodes and slot content instead of the Instance and its fills', () => {
    const fill = n('f', 'SlotFill', { slot: 'p-body' }, [n('a', 'Text')])
    const page = n('page', 'Page', {}, [instance({}, [fill])])
    const seen: string[] = []
    walkResolved(page, [card()], node => seen.push(node.id))
    expect(seen).toEqual(['page', 'i1/root', 'i1/title', 'i1/body', 'a'])
  })

  it('expands Instances inside slot content', () => {
    const inner = instance({}, [], 'deep')
    const page = n('page', 'Page', {}, [instance({}, [n('f', 'SlotFill', { slot: 'p-body' }, [inner])])])
    const seen: string[] = []
    walkResolved(page, [card()], node => seen.push(node.id))
    expect(seen).toContain('deep/title')
  })

  it('skips instances that cannot be resolved', () => {
    const seen: string[] = []
    walkResolved(n('page', 'Page', {}, [instance({ component: 'gone' })]), [], node => seen.push(node.id))
    expect(seen).toEqual(['page'])
  })
})
