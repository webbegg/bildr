import { describe, expect, it } from 'vitest'
import type { ComponentFile, LayoutFile, Model, ModelNode, PageFile, PropertyDef } from '@bildr/codegen/model'
import { bindingLabel, entityAddItems, entityBindingAdd, instanceVariantValue, PRIMARY_VARIANT, propertyField, styleAddItems, uniqueComponentName } from '../../src/shared/componentEditor.ts'
import { childrenSlotNode, slotOf, variableAddItems, variableField } from '../../src/shared/layoutEditor.ts'
import { pageSlots } from '../../src/editor/layouts.ts'

/** Ported from the hosted `componentEditor.test.ts`, `layoutEditor.test.ts` and `instanceMenus.test.ts` (the panel helpers), over the model's nodes. */

const n = (id: string, type: string, props: ModelNode['props'] = {}, children: ModelNode[] = [], extra: Partial<ModelNode> = {}): ModelNode => ({ id, type, props, ...(children.length ? { children } : {}), ...extra })
const def = (name: string, root: ModelNode) => ({ id: 'cmp_x', name, root })

describe('propertyField', () => {
  it('describes a property as a prop field, its default from the bound prop', () => {
    const button = n('b1', 'Button', { text: 'Buy', color: 'primary' })
    const card = def('X', n('c', 'Container', {}, [button]))
    const label: PropertyDef = { id: 'prop_label', name: 'label', label: 'Label', kind: 'text', bindings: [{ nodeId: 'b1', prop: 'text' }] }
    const color: PropertyDef = { id: 'prop_color', name: 'color', kind: 'select', default: 'error', bindings: [{ nodeId: 'b1', prop: 'color' }] }
    expect(propertyField(card, label)).toMatchObject({ name: 'prop_label', label: 'Label', kind: 'text', default: 'Buy', description: 'Label, a property of X' })
    const field = propertyField(card, color)
    expect(field).toMatchObject({ name: 'prop_color', label: 'color', kind: 'select', default: 'error' })
    expect(field?.options).toContain('primary')
  })

  it('takes a style binding\'s default and options from the bound style key, not the prop of the same name', () => {
    const heading = n('h1', 'Heading', { text: 'Hi' }, [], { style: { text: '2xl', color: 'muted' } })
    const card = def('X', n('c', 'Container', {}, [heading]))
    const size: PropertyDef = { id: 'prop_size', name: 'size', kind: 'select', bindings: [{ nodeId: 'h1', prop: 'text', target: 'style' }] }
    const field = propertyField(card, size)
    expect(field).toMatchObject({ name: 'prop_size', kind: 'select', default: '2xl' })
    expect(field?.options).toEqual(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'])
    const tone: PropertyDef = { id: 'prop_tone', name: 'tone', kind: 'select', default: 'error', bindings: [{ nodeId: 'h1', prop: 'color', target: 'style' }] }
    expect(propertyField(card, tone)).toMatchObject({ default: 'error' })
    expect(propertyField(card, tone)?.options).toContain('primary')
  })

  it('has a field for the kinds an instance types a value for, and none for entity, field and slot properties', () => {
    const card = def('X', n('c', 'Container'))
    const of = (kind: PropertyDef['kind']): PropertyDef => ({ id: 'prop_a', name: 'a', kind })
    expect(propertyField(card, of('number'))).toMatchObject({ kind: 'number', default: '' })
    expect(propertyField(card, { ...of('select'), options: ['a', 'b'] })?.options).toEqual(['a', 'b'])
    expect(propertyField(card, of('entity'))).toBeNull()
    expect(propertyField(card, of('field'))).toBeNull()
    expect(propertyField(card, of('slot'))).toBeNull()
  })
})

describe('bindingLabel', () => {
  const props: PropertyDef[] = [
    { id: 'p_text', name: 'title', kind: 'text', bindings: [{ nodeId: 'n1', prop: 'text' }] },
    { id: 'p_size', name: 'size', kind: 'select', bindings: [{ nodeId: 'n1', prop: 'text', target: 'style' }] }
  ]

  it('names what a binding drives', () => {
    const root = n('c', 'Container', {}, [n('n1', 'Heading')])
    expect(bindingLabel(root, props[0]!.bindings![0])).toBe('Heading · text')
    expect(bindingLabel(root, props[1]!.bindings![0])).toBe('Heading · style text')
    expect(bindingLabel(root, { nodeId: 'n1', prop: 'children' })).toBe('Heading')
    expect(bindingLabel(root, { nodeId: 'gone', prop: 'text' })).toBe('Missing node')
    expect(bindingLabel(root, undefined)).toBe('Not bound')
  })

  it('names a bound layer by its layer name, a slot as its container', () => {
    const root = n('c', 'Container', {}, [n('n_foot', 'Container', {}, [], { name: 'Footer' })])
    expect(bindingLabel(root, { nodeId: 'n_foot', prop: 'children' })).toBe('Footer (Container)')
    expect(bindingLabel(root, { nodeId: 'n_foot', prop: 'bg', target: 'style' })).toBe('Footer (Container) · style bg')
  })
})

describe('styleAddItems', () => {
  it('offers the style keys the node sets plus Background and Text color, bound ones disabled', () => {
    const properties: PropertyDef[] = [{ id: 'prop_a', name: 'pad', kind: 'select', bindings: [{ nodeId: 'n_1', prop: 'p', target: 'style' }] }]
    const items = styleAddItems(properties, n('n_1', 'Container', {}, [], { style: { 'p': '4', 'md:gap': '2' } }))
    expect(items).toEqual([
      { id: 'style:p', label: 'Style · Padding', disabled: true, hint: 'Already a property' },
      { id: 'style:md:gap', label: 'Style · Gap (md)', disabled: false, hint: 'Instances can set it' },
      { id: 'style:bg', label: 'Style · Background', disabled: false, hint: 'Instances can set it' },
      { id: 'style:color', label: 'Style · Text color', disabled: false, hint: 'Instances can set it' }
    ])
  })

  it('says each page can set it for a layout variable', () => {
    expect(styleAddItems([], n('n_1', 'Container'), 'variable')[0]).toMatchObject({ hint: 'Each page can set it' })
  })

  it('offers nothing for an instance or slot content', () => {
    expect(styleAddItems([], n('n_i', 'Instance'))).toEqual([])
    expect(styleAddItems([], n('n_f', 'SlotFill'))).toEqual([])
  })
})

describe('instanceVariantValue', () => {
  it('is the variant an instance takes: an empty one for the primary', () => {
    expect(instanceVariantValue(PRIMARY_VARIANT)).toBe('')
    expect(instanceVariantValue('var_compact')).toBe('var_compact')
  })
})

describe('slotOf, pageSlots and variableAddItems', () => {
  const main = (): LayoutFile => ({
    id: 'lay_main',
    name: 'main',
    root: n('l-root', 'Page', {}, [n('l-title', 'Heading', { text: 'Site', level: 1 }), n('l-main', 'Container'), n('l-foot', 'Container')]),
    slots: [{ id: 'children', name: 'content', nodeId: 'l-main' }, { id: 'footer', name: 'footer', nodeId: 'l-foot' }],
    variables: [{ id: 'prop_title', name: 'title', kind: 'text', bindings: [{ nodeId: 'l-title', prop: 'text' }] }]
  } as unknown as LayoutFile)

  it('finds the slot bound to a node, and the node of the children slot', () => {
    expect(slotOf(main(), 'l-main')?.id).toBe('children')
    expect(slotOf(main(), 'l-title')).toBeUndefined()
    expect(childrenSlotNode(main())).toBe('l-main')
    expect(childrenSlotNode(null)).toBeNull()
  })

  it('lists the named slots of a page layout and whether the page fills each', () => {
    const filled = { root: n('r', 'Page', {}, [n('fill', 'SlotFill', { slot: 'footer' })]) } as unknown as PageFile
    const empty = { root: n('r', 'Page') } as unknown as PageFile
    expect(pageSlots(main(), filled)).toEqual([{ slot: main().slots[1], filled: true }])
    expect(pageSlots(main(), empty)).toEqual([{ slot: main().slots[1], filled: false }])
  })

  it('offers the node props as variables, disabling the bound ones', () => {
    const layout = main()
    const items = variableAddItems(layout, layout.root.children![0]!)
    expect(items.find(item => item.id === 'text')).toMatchObject({ disabled: true, hint: 'Already a variable' })
    expect(items.find(item => item.id === 'level')).toMatchObject({ disabled: false })
    expect(variableAddItems(layout, n('x', 'Instance', { component: 'c' }))).toEqual([])
  })

  it('does not count a style binding as a bound prop of the same name', () => {
    const layout = main()
    layout.variables = [{ id: 'prop_size', name: 'size', kind: 'select', bindings: [{ nodeId: 'l-title', prop: 'text', target: 'style' }] }]
    expect(variableAddItems(layout, layout.root.children![0]!).find(item => item.id === 'text')).toMatchObject({ disabled: false })
  })

  it('turns a variable into a prop field keyed by its id, defaulting to the bound prop or style key of the layout\'s node', () => {
    const layout = main()
    expect(variableField(layout, layout.variables![0]!)).toMatchObject({ name: 'prop_title', label: 'title', kind: 'text', default: 'Site', description: 'title, a variable of layout main' })
    layout.root.children![0]!.style = { bg: 'muted' }
    const bar: PropertyDef = { id: 'prop_bar', name: 'bar', kind: 'select', bindings: [{ nodeId: 'l-title', prop: 'bg', target: 'style' }] }
    expect(variableField(layout, bar)).toMatchObject({ name: 'prop_bar', kind: 'select', default: 'muted' })
  })
})

describe('uniqueComponentName', () => {
  it('numbers a name another property has, as the module keeps it (camelCased: Text is text)', () => {
    expect(uniqueComponentName('Text', [{ name: 'text' }])).toBe('Text 2')
    expect(uniqueComponentName('Draft label', [{ name: 'draftLabel' }, { name: 'Draft label 2' }])).toBe('Draft label 3')
    expect(uniqueComponentName('Content', [{ name: 'text' }])).toBe('Content')
  })
})

describe('entity properties of the "+" menu', () => {
  const model = { modules: { blog: { entities: [{ id: 'ent_post', name: 'Post', plural: 'posts' }, { id: 'ent_quote', name: 'Quote', plural: 'quotes' }] }, empty: { entities: [] } } } as unknown as Model

  it('offers a Record and a List submenu with one item per entity of the model, or nothing without entities', () => {
    expect(entityAddItems(model)).toEqual([
      { id: 'record', label: 'Record', hint: 'An instance binds one record', children: [{ id: 'entity:ent_post', label: 'Post' }, { id: 'entity:ent_quote', label: 'Quote' }] },
      { id: 'list', label: 'List', hint: 'An instance binds a list of records', children: [{ id: 'entities:ent_post', label: 'Post' }, { id: 'entities:ent_quote', label: 'Quote' }] }
    ])
    expect(entityAddItems({ modules: {} } as unknown as Model)).toEqual([])
    expect(entityAddItems(null)).toEqual([])
  })

  it('adds a record named after the entity, or a list named by its plural, numbered when taken', () => {
    expect(entityBindingAdd(model, [], 'entity:ent_post')).toEqual({ name: 'post', kind: 'entity', entity: 'ent_post' })
    expect(entityBindingAdd(model, [{ name: 'post' }], 'entity:ent_post')).toEqual({ name: 'post 2', kind: 'entity', entity: 'ent_post' })
    expect(entityBindingAdd(model, [], 'entities:ent_quote')).toEqual({ name: 'quotes', kind: 'entity', entity: 'ent_quote', many: true })
  })

  it('is nothing for another item or an entity the model lacks', () => {
    expect(entityBindingAdd(model, [], 'text')).toBeUndefined()
    expect(entityBindingAdd(model, [], 'entity:ent_gone')).toBeUndefined()
    expect(entityBindingAdd(null, [], 'entity:ent_post')).toBeUndefined()
  })
})

describe('componentFile typing', () => {
  it('lets a component without bindings through propertyField', () => {
    const component = { id: 'cmp_x', name: 'X', root: n('c', 'Container'), properties: [], variants: [] } as unknown as ComponentFile
    expect(propertyField(component, { id: 'prop_t', name: 't', kind: 'text', default: 'hi' })).toMatchObject({ default: 'hi' })
  })
})
