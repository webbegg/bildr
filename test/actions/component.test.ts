import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import type { DocNode, Project } from '#shared/document/schema'
import { resolveInstance } from '#shared/runtime/instances'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const events: ChangeEvent[] = []
  bildr.onChange(e => events.push(e))
  const created = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const get = () => bildr.call<Project>('project_get', { projectId }, mcp)
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  return { bildr, events, projectId, pageId, get, call }
}

/** A page with a Card holding a heading and a text, then a trailing Text. */
async function withCard() {
  const ctx = await setup()
  const { nodeId: cardId } = await ctx.call<{ nodeId: string }>('node_insert', {
    pageId: ctx.pageId,
    type: 'Card',
    style: { p: '6' },
    children: [{ type: 'Heading', props: { text: 'Latte' } }, { type: 'Container' }]
  })
  const { nodeId: tailId } = await ctx.call<{ nodeId: string }>('node_insert', { pageId: ctx.pageId, type: 'Text' })
  const before = (await ctx.get()).pages[0]!.root.children
  return { ...ctx, cardId, tailId, before }
}

/** Compares rendered trees without ids, which differ by design (`<instanceId>/<nodeId>`). */
function shape(node: DocNode): unknown {
  return { type: node.type, props: node.props, style: node.style, children: node.children.map(shape) }
}

async function createCard() {
  const ctx = await withCard()
  const created = await ctx.call<{ version: number, componentId: string, nodeId: string }>('component_create', { pageId: ctx.pageId, nodeId: ctx.cardId, name: 'Cards/Product' })
  const project = await ctx.get()
  const def = project.components[0]!
  return { ...ctx, ...created, project, def }
}

describe('component_create', () => {
  it('turns a selection into a component and puts an instance in its place, rendering the same', async () => {
    const { project, def, componentId, nodeId, before, tailId, events, projectId } = await createCard()
    expect(def).toMatchObject({ id: componentId, name: 'Cards/Product', properties: [], variants: [] })
    const children = project.pages[0]!.root.children
    expect(children.map(c => c.id)).toEqual([nodeId, tailId])
    expect(children[0]).toMatchObject({ type: 'Instance', props: { component: componentId }, children: [] })
    // The definition root is the moved subtree with ids of its own.
    expect(def.root.id).not.toBe(before[0]!.id)
    expect(shape(resolveInstance(children[0]!, project.components)!)).toEqual(shape(before[0]!))
    expect(events.at(-1)).toMatchObject({ projectId, action: 'component_create' })
  })

  it('wraps several siblings in a Container and is one undo step', async () => {
    const ctx = await withCard()
    const { nodeId } = await ctx.call<{ nodeId: string }>('component_create', { pageId: ctx.pageId, nodeIds: [ctx.cardId, ctx.tailId], name: 'Block' })
    const project = await ctx.get()
    expect(project.components[0]!.root.type).toBe('Container')
    expect(project.components[0]!.root.children.map(c => c.type)).toEqual(['Card', 'Text'])
    expect(project.pages[0]!.root.children.map(c => c.id)).toEqual([nodeId])

    expect(await ctx.call('history_get', {})).toEqual({ undo: 'Create component', redo: null })
    await ctx.call('history_undo', {})
    const undone = await ctx.get()
    expect(undone.components).toEqual([])
    expect(undone.pages[0]!.root.children).toEqual(ctx.before)
    await ctx.call('history_redo', {})
    expect((await ctx.get()).components).toHaveLength(1)
  })

  it('refuses the page root and nodes of different parents', async () => {
    const ctx = await withCard()
    const page = (await ctx.get()).pages[0]!
    await expect(ctx.call('component_create', { pageId: ctx.pageId, nodeId: page.root.id, name: 'X' })).rejects.toMatchObject({ code: 'forbidden' })
    const headingId = page.root.children[0]!.children[0]!.id
    await expect(ctx.call('component_create', { pageId: ctx.pageId, nodeIds: [headingId, ctx.tailId], name: 'X' }))
      .rejects.toThrow('Only siblings (nodes of one parent) can become one component')
  })
})

describe('unique component names', () => {
  it('refuses to create a component with a name already used, ignoring case', async () => {
    const ctx = await createCard()
    await expect(ctx.call('component_create', { pageId: ctx.pageId, nodeId: ctx.tailId, name: 'cards/product' }))
      .rejects.toMatchObject({ code: 'invalid', message: 'A component named "Cards/Product" already exists' })
    expect((await ctx.get()).components).toHaveLength(1)
  })

  it('names a component itself when no name is given (agents), never a used one', async () => {
    const ctx = await withCard()
    const first = await ctx.call<{ componentId: string }>('component_create', { pageId: ctx.pageId, nodeId: ctx.cardId })
    const second = await ctx.call<{ componentId: string }>('component_create', { pageId: ctx.pageId, nodeId: ctx.tailId })
    const names = (await ctx.get()).components.map(c => [c.id, c.name])
    expect(names).toEqual([[first.componentId, 'Card'], [second.componentId, 'Text']])
  })

  it('auto-names several siblings "Component", numbered when taken', async () => {
    const ctx = await withCard()
    await ctx.call('component_create', { pageId: ctx.pageId, nodeIds: [ctx.cardId, ctx.tailId] })
    const { nodeId } = await ctx.call<{ nodeId: string }>('node_insert', { pageId: ctx.pageId, type: 'Text' })
    const { nodeId: other } = await ctx.call<{ nodeId: string }>('node_insert', { pageId: ctx.pageId, type: 'Text' })
    await ctx.call('component_create', { pageId: ctx.pageId, nodeIds: [nodeId, other] })
    expect((await ctx.get()).components.map(c => c.name)).toEqual(['Component', 'Component 2'])
  })

  it('refuses to rename a component to another one\'s name, but lets it change its own case', async () => {
    const ctx = await createCard()
    const { componentId: other } = await ctx.call<{ componentId: string }>('component_create', { pageId: ctx.pageId, nodeId: ctx.tailId, name: 'Footer' })
    await expect(ctx.call('component_rename', { componentId: other, name: 'CARDS/PRODUCT' }))
      .rejects.toMatchObject({ code: 'invalid', message: 'A component named "Cards/Product" already exists' })
    await ctx.call('component_rename', { componentId: ctx.componentId, name: 'cards/product' })
    expect((await ctx.get()).components.map(c => c.name)).toEqual(['cards/product', 'Footer'])
  })
})

describe('component_rename and component_delete', () => {
  it('renames a component', async () => {
    const { call, get, componentId } = await createCard()
    await call('component_rename', { componentId, name: 'Product card' })
    expect((await get()).components[0]!.name).toBe('Product card')
    await expect(call('component_rename', { componentId: 'cmp_nope', name: 'X' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses to delete a component in use and lists its usages', async () => {
    const { call, componentId, nodeId } = await createCard()
    await expect(call('component_delete', { componentId })).rejects.toMatchObject({
      code: 'forbidden',
      message: `"Cards/Product" is used by 1 instance: page "Home" (${nodeId}). Delete them first, or pass force: true to delete them too`
    })
  })

  it('with force deletes the instances too, as one undo step', async () => {
    const { call, get, componentId, pageId, nodeId } = await createCard()
    await call('node_insert', { pageId, type: 'Instance', props: { component: componentId } })
    const result = await call<{ deletedInstances: string[] }>('component_delete', { componentId, force: true })
    expect(result.deletedInstances).toHaveLength(2)
    expect(result.deletedInstances[0]).toBe(nodeId)
    const project = await get()
    expect(project.components).toEqual([])
    expect(project.pages[0]!.root.children.map(c => c.type)).toEqual(['Text'])
    await call('history_undo', {})
    expect((await get()).components).toHaveLength(1)
    expect((await get()).pages[0]!.root.children.map(c => c.type)).toEqual(['Instance', 'Text', 'Instance'])
  })

  it('deletes an unused component', async () => {
    const { call, get, componentId, nodeId, pageId } = await createCard()
    await call('node_delete', { pageId, nodeId })
    expect(await call('component_delete', { componentId })).toMatchObject({ deletedInstances: [] })
    expect((await get()).components).toEqual([])
  })
})

describe('component properties', () => {
  it('adds a bound property, and instances override it with type-checked values', async () => {
    const { call, get, componentId, def, nodeId, pageId } = await createCard()
    const headingId = def.root.children[0]!.id
    const { propertyId } = await call<{ propertyId: string }>('component_property_add', {
      componentId, name: 'Title', kind: 'text', default: 'Latte', bindings: [{ nodeId: headingId, prop: 'text' }]
    })
    expect((await get()).components[0]!.properties).toEqual([{ id: propertyId, name: 'Title', kind: 'text', default: 'Latte', bindings: [{ nodeId: headingId, prop: 'text' }] }])

    await call('instance_set_values', { pageId, nodeId, values: { [propertyId]: 'Mocha' } })
    let project = await get()
    expect(project.pages[0]!.root.children[0]!.props[propertyId]).toBe('Mocha')
    expect(resolveInstance(project.pages[0]!.root.children[0]!, project.components)!.children[0]!.props.text).toBe('Mocha')

    await expect(call('instance_set_values', { pageId, nodeId, values: { [propertyId]: 3 } })).rejects.toThrow('must be a string')
    await expect(call('instance_set_values', { pageId, nodeId, values: { nope: 'x' } })).rejects.toThrow('has no property "nope"')

    await call('instance_set_values', { pageId, nodeId, values: { [propertyId]: null } })
    project = await get()
    expect(project.pages[0]!.root.children[0]!.props).toEqual({ component: componentId })
  })

  it('updates a property and refuses a kind its bindings cannot take', async () => {
    const { call, get, componentId, def } = await createCard()
    const headingId = def.root.children[0]!.id
    const { propertyId } = await call<{ propertyId: string }>('component_property_add', { componentId, name: 'Title', kind: 'text', bindings: [{ nodeId: headingId, prop: 'text' }] })
    await call('component_property_update', { componentId, propertyId, name: 'Heading', default: 'Hi' })
    expect((await get()).components[0]!.properties[0]).toMatchObject({ name: 'Heading', default: 'Hi' })
    await call('component_property_update', { componentId, propertyId, default: null })
    expect((await get()).components[0]!.properties[0]!.default).toBeUndefined()
    await expect(call('component_property_add', { componentId, name: 'Bad', kind: 'number', bindings: [{ nodeId: headingId, prop: 'text' }] }))
      .rejects.toThrow('cannot drive "text"')
  })

  it('removing a property clears instance values and slot fills in the same step', async () => {
    const { call, get, componentId, def, nodeId, pageId } = await createCard()
    const headingId = def.root.children[0]!.id
    const bodyId = def.root.children[1]!.id
    const { propertyId } = await call<{ propertyId: string }>('component_property_add', { componentId, name: 'Title', kind: 'text', bindings: [{ nodeId: headingId, prop: 'text' }] })
    const { propertyId: slotId } = await call<{ propertyId: string }>('component_property_add', { componentId, name: 'Body', kind: 'slot', bindings: [{ nodeId: bodyId, prop: 'children' }] })
    await call('instance_set_values', { pageId, nodeId, values: { [propertyId]: 'Mocha' } })
    await call('instance_set_slot', { pageId, nodeId, slot: slotId, filled: true })

    await call('component_property_remove', { componentId, propertyId })
    await call('component_property_remove', { componentId, propertyId: slotId })
    const project = await get()
    expect(project.components[0]!.properties).toEqual([])
    expect(project.pages[0]!.root.children[0]).toMatchObject({ props: { component: componentId }, children: [] })

    await call('history_undo', {})
    expect((await get()).pages[0]!.root.children[0]!.children).toHaveLength(1)
  })
})

describe('instance slots', () => {
  it('fills a slot, takes page content into it, and clears it back to the default', async () => {
    const { call, get, componentId, def, nodeId, pageId, tailId } = await createCard()
    const bodyId = def.root.children[1]!.id
    const { propertyId: slot } = await call<{ propertyId: string }>('component_property_add', { componentId, name: 'Body', kind: 'slot', bindings: [{ nodeId: bodyId, prop: 'children' }] })

    const { fillId } = await call<{ fillId: string }>('instance_set_slot', { pageId, nodeId, slot, filled: true, nodeIds: [tailId] })
    let project = await get()
    const instance = project.pages[0]!.root.children[0]!
    expect(instance.children).toEqual([expect.objectContaining({ id: fillId, type: 'SlotFill', props: { slot } })])
    expect(instance.children[0]!.children.map(c => c.id)).toEqual([tailId])
    expect(project.pages[0]!.root.children).toHaveLength(1)
    expect(resolveInstance(instance, project.components)!.children[1]!.children.map(c => c.id)).toEqual([tailId])

    // Filling again keeps the existing fill.
    expect(await call('instance_set_slot', { pageId, nodeId, slot, filled: true })).toMatchObject({ fillId })

    await call('node_insert', { pageId, parentId: fillId, type: 'Heading' })
    expect((await get()).pages[0]!.root.children[0]!.children[0]!.children).toHaveLength(2)

    expect(await call('instance_set_slot', { pageId, nodeId, slot, filled: false })).toMatchObject({ fillId: null })
    project = await get()
    expect(project.pages[0]!.root.children[0]!.children).toEqual([])
    await expect(call('instance_set_slot', { pageId, nodeId, slot: 'nope', filled: true })).rejects.toThrow('has no slot "nope"')
  })
})

describe('component variants', () => {
  it('adds a variant, stores sparse overrides, resets them, and instances select it', async () => {
    const { call, get, componentId, def, nodeId, pageId } = await createCard()
    const headingId = def.root.children[0]!.id
    const { variantId } = await call<{ variantId: string }>('component_variant_add', { componentId, name: 'Dark' })
    expect((await get()).components[0]!.variants).toEqual([{ id: variantId, name: 'Dark', overrides: {} }])

    await call('component_variant_set_override', { componentId, variantId, nodeId: headingId, props: { text: 'Espresso', level: '2' }, style: { color: 'primary' } })
    expect((await get()).components[0]!.variants[0]!.overrides).toEqual({ [headingId]: { props: { text: 'Espresso' }, style: { color: 'primary' } } })

    await call('instance_set_values', { pageId, nodeId, variant: variantId })
    let project = await get()
    expect(resolveInstance(project.pages[0]!.root.children[0]!, project.components)!.children[0]!.props.text).toBe('Espresso')
    await expect(call('instance_set_values', { pageId, nodeId, variant: 'var_nope' })).rejects.toThrow('unknown variant')

    await call('component_variant_set_override', { componentId, variantId, nodeId: headingId, props: { text: null }, style: { color: null } })
    expect((await get()).components[0]!.variants[0]!.overrides).toEqual({})

    await call('component_variant_delete', { componentId, variantId })
    project = await get()
    expect(project.components[0]!.variants).toEqual([])
    expect(project.pages[0]!.root.children[0]!.props).toEqual({ component: componentId })
  })

  it('removes a primary token in a variant with unset, and a null resets it', async () => {
    const { call, get, componentId, def, nodeId, pageId } = await createCard()
    const { variantId } = await call<{ variantId: string }>('component_variant_add', { componentId, name: 'Flat' })
    await call('component_variant_set_override', { componentId, variantId, nodeId: def.root.id, unset: ['p'] })
    expect((await get()).components[0]!.variants[0]!.overrides).toEqual({ [def.root.id]: { unset: ['p'] } })
    await call('instance_set_values', { pageId, nodeId, variant: variantId })
    let project = await get()
    expect(resolveInstance(project.pages[0]!.root.children[0]!, project.components)!.style.p).toBeUndefined()

    await call('component_variant_set_override', { componentId, variantId, nodeId: def.root.id, style: { p: null } })
    project = await get()
    expect(project.components[0]!.variants[0]!.overrides).toEqual({})
    expect(resolveInstance(project.pages[0]!.root.children[0]!, project.components)!.style.p).toBe('6')
  })

  it('applies a batch of per-node overrides as one all-or-nothing undo step', async () => {
    const { call, get, componentId, def } = await createCard()
    const headingId = def.root.children[0]!.id
    const { variantId } = await call<{ variantId: string }>('component_variant_add', { componentId, name: 'Dark' })
    const before = (await get()).components[0]

    await expect(call('component_variant_set_override', { componentId, variantId, overrides: [
      { nodeId: headingId, style: { color: 'primary' } },
      { nodeId: def.root.id, style: { p: 'nope' } }
    ] })).rejects.toThrow('"nope" is not a value of style token "p"')
    expect((await get()).components[0]).toEqual(before)

    await call('component_variant_set_override', { componentId, variantId, overrides: [
      { nodeId: headingId, props: { text: 'Espresso' }, style: { color: 'primary' } },
      { nodeId: def.root.id, style: { bg: 'muted' }, unset: ['p'] }
    ] })
    expect((await get()).components[0]!.variants[0]!.overrides).toEqual({
      [headingId]: { props: { text: 'Espresso' }, style: { color: 'primary' } },
      [def.root.id]: { style: { bg: 'muted' }, unset: ['p'] }
    })
    await call('history_undo', {})
    expect((await get()).components[0]).toEqual(before)
  })

  it('refuses a batch mixed with the single-node form, or neither', async () => {
    const { call, componentId, def } = await createCard()
    const { variantId } = await call<{ variantId: string }>('component_variant_add', { componentId, name: 'Dark' })
    await expect(call('component_variant_set_override', { componentId, variantId, nodeId: def.root.id, overrides: [{ nodeId: def.root.id, style: { p: '2' } }] }))
      .rejects.toThrow('Give nodeId (with props, style or unset) or overrides, not both')
    await expect(call('component_variant_set_override', { componentId, variantId, style: { p: '2' }, overrides: [{ nodeId: def.root.id, style: { p: '2' } }] }))
      .rejects.toThrow('Give nodeId (with props, style or unset) or overrides, not both')
    await expect(call('component_variant_set_override', { componentId, variantId })).rejects.toThrow('Give nodeId or overrides')
  })

  it('renames a variant as one undo step', async () => {
    const { call, get, componentId } = await createCard()
    const { variantId } = await call<{ variantId: string }>('component_variant_add', { componentId, name: 'Dark' })
    await call('component_variant_rename', { componentId, variantId, name: 'Night' })
    expect((await get()).components[0]!.variants).toEqual([{ id: variantId, name: 'Night', overrides: {} }])
    await expect(call('component_variant_rename', { componentId, variantId: 'var_nope', name: 'X' })).rejects.toThrow('Variant "var_nope" not found')
    await call('history_undo', {})
    expect((await get()).components[0]!.variants[0]!.name).toBe('Dark')
  })
})

describe('instances inside a definition', () => {
  it('instance actions also target an instance nested in another definition', async () => {
    const { call, get, componentId, nodeId, pageId, def } = await createCard()
    const { propertyId } = await call<{ propertyId: string }>('component_property_add', { componentId, name: 'Title', kind: 'text', bindings: [{ nodeId: def.root.children[0]!.id, prop: 'text' }] })
    const { componentId: outerId } = await call<{ componentId: string }>('component_create', { pageId, nodeId, name: 'Outer' })
    const outer = (await get()).components.find(c => c.id === outerId)!
    expect(outer.root.type).toBe('Instance')

    await call('instance_set_values', { componentId: outerId, nodeId: outer.root.id, values: { [propertyId]: 'Nested' } })
    expect((await get()).components.find(c => c.id === outerId)!.root.props[propertyId]).toBe('Nested')
    await expect(call('instance_set_values', { nodeId: outer.root.id, values: {} })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
