import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { DocNode, Project } from '#shared/document/schema'
import { findNode } from '#shared/document/tree'
import { resolveInstance } from '#shared/runtime/instances'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

/** A rendered tree without ids and names. */
function shape(node: DocNode): unknown {
  return { type: node.type, props: node.props, style: node.style, children: node.children.map(shape) }
}

/** A page with a Card component (Title property, Body slot, Flat variant) used twice, and a Tile component with a "title" property. */
async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const get = () => bildr.call<Project>('project_get', { projectId }, mcp)
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const fails = async (name: string, input: Record<string, unknown>) => {
    try {
      await call(name, input)
    } catch (error) {
      return (error as Error).message
    }
    throw new Error(`${name} did not fail`)
  }

  const { nodeId: cardNode } = await call<{ nodeId: string }>('node_insert', {
    pageId,
    type: 'Card',
    style: { p: '6' },
    children: [{ type: 'Heading', props: { text: 'Latte' } }, { type: 'Container' }]
  })
  const { componentId: cardId, nodeId: first } = await call<{ componentId: string, nodeId: string }>('component_create', { pageId, nodeId: cardNode, name: 'Card' })
  const card = (await get()).components[0]!
  const [heading, body] = card.root.children
  await call('node_rename', { componentId: cardId, nodeId: heading!.id, name: 'Title text' })
  const { propertyId: titleId } = await call<{ propertyId: string }>('component_property_add', { componentId: cardId, name: 'Title', kind: 'text', bindings: [{ nodeId: heading!.id, prop: 'text' }] })
  const { propertyId: bodyId } = await call<{ propertyId: string }>('component_property_add', { componentId: cardId, name: 'Body', kind: 'slot', bindings: [{ nodeId: body!.id, prop: 'children' }] })
  const { variantId: flatId } = await call<{ variantId: string }>('component_variant_add', { componentId: cardId, name: 'Flat' })
  await call('component_variant_set_override', { componentId: cardId, variantId: flatId, nodeId: card.root.id, style: { bg: 'muted' }, unset: ['p'] })
  await call('instance_set_values', { pageId, nodeId: first, values: { [titleId]: 'Mocha' }, variant: flatId })
  const { fillId } = await call<{ fillId: string }>('instance_set_slot', { pageId, nodeId: first, slot: bodyId, filled: true })
  await call('node_insert', { pageId, parentId: fillId, type: 'Text', props: { text: 'Own' } })
  const { nodeId: second } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Instance', props: { component: cardId } })

  const { nodeId: tileNode } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Column', children: [{ type: 'Heading', props: { text: 'Tile' } }, { type: 'Container' }] })
  const { componentId: tileId, nodeId: tileInstance } = await call<{ componentId: string, nodeId: string }>('component_create', { pageId, nodeId: tileNode, name: 'Tile' })
  const tile = (await get()).components.find(c => c.id === tileId)!
  const { propertyId: tileTitleId } = await call<{ propertyId: string }>('component_property_add', { componentId: tileId, name: 'title', kind: 'text', bindings: [{ nodeId: tile.root.children[0]!.id, prop: 'text' }] })
  const { propertyId: tileBodyId } = await call<{ propertyId: string }>('component_property_add', { componentId: tileId, name: 'BODY', kind: 'slot', bindings: [{ nodeId: tile.root.children[1]!.id, prop: 'children' }] })
  return { bildr, projectId, pageId, get, call, fails, cardId, tileId, first, second, tileInstance, titleId, bodyId, flatId, tileTitleId, tileBodyId }
}

describe('instance_detach', () => {
  it('puts the tree the instance renders in its place, as plain nodes, keeping the layer name', async () => {
    const ctx = await setup()
    const before = await ctx.get()
    const instance = findNode(before.pages[0]!.root, ctx.first)!
    const rendered = resolveInstance(instance, before.components)!
    const index = before.pages[0]!.root.children.findIndex(c => c.id === ctx.first)

    const { nodeId } = await ctx.call<{ nodeId: string }>('instance_detach', { pageId: ctx.pageId, nodeId: ctx.first })
    const after = await ctx.get()
    const detached = after.pages[0]!.root.children[index]!
    expect(detached.id).toBe(nodeId)
    expect(findNode(after.pages[0]!.root, ctx.first)).toBeUndefined()
    expect(shape(detached)).toEqual(shape(rendered))
    expect(detached).toMatchObject({ type: 'Card', name: 'Card', style: { bg: 'muted' } })
    expect(detached.children[0]).toMatchObject({ name: 'Title text', props: { text: 'Mocha' } })
    expect(detached.children[1]!.children[0]!.props.text).toBe('Own')
  })

  it('is one undo step', async () => {
    const ctx = await setup()
    const before = await ctx.get()
    await ctx.call('instance_detach', { pageId: ctx.pageId, nodeId: ctx.first })
    expect(await ctx.call('history_get', {})).toMatchObject({ undo: 'Detach instance' })
    await ctx.call('history_undo', {})
    expect((await ctx.get()).pages).toEqual(before.pages)
  })

  it('works in a component definition, and refuses a node that is not an instance', async () => {
    const ctx = await setup()
    const { nodeId: nested } = await ctx.call<{ nodeId: string }>('node_insert', { componentId: ctx.tileId, type: 'Instance', props: { component: ctx.cardId } })
    await ctx.call('instance_detach', { componentId: ctx.tileId, nodeId: nested })
    const tile = (await ctx.get()).components.find(c => c.id === ctx.tileId)!
    expect(tile.root.children.at(-1)).toMatchObject({ type: 'Card', name: 'Card' })
    const project = await ctx.get()
    const text = project.pages[0]!.root.children.find(c => c.type === 'Instance')!
    expect(await ctx.fails('instance_detach', { pageId: ctx.pageId, nodeId: project.pages[0]!.root.id })).toMatch(/not a component instance/)
    expect(text).toBeDefined()
  })
})

describe('instance_detach in a component with bindings and variants', () => {
  it('moves the instance\'s style bindings and variant style overrides to the detached root, undoably', async () => {
    const ctx = await setup()
    const { nodeId: nested } = await ctx.call<{ nodeId: string }>('node_insert', { componentId: ctx.tileId, type: 'Instance', props: { component: ctx.cardId }, style: { mt: '2' } })
    const { propertyId } = await ctx.call<{ propertyId: string }>('component_property_add', { componentId: ctx.tileId, name: 'Fill', kind: 'select', bindings: [{ nodeId: nested, prop: 'bg', target: 'style' }] })
    const { variantId } = await ctx.call<{ variantId: string }>('component_variant_add', { componentId: ctx.tileId, name: 'Loose' })
    await ctx.call('component_variant_set_override', { componentId: ctx.tileId, variantId, nodeId: nested, style: { mb: '4' }, unset: ['mt'] })
    const before = await ctx.get()
    const { nodeId } = await ctx.call<{ nodeId: string }>('instance_detach', { componentId: ctx.tileId, nodeId: nested })
    const tile = (await ctx.get()).components.find(c => c.id === ctx.tileId)!
    expect(tile.properties.find(p => p.id === propertyId)!.bindings).toEqual([{ nodeId, prop: 'bg', target: 'style' }])
    expect(tile.variants[0]!.overrides).toEqual({ [nodeId]: { style: { mb: '4' }, unset: ['mt'] } })
    await ctx.call('history_undo', {})
    expect((await ctx.get()).components).toEqual(before.components)
  })
})

describe('instance_replace', () => {
  it('swaps the component, keeping the values, slot content and variant whose names match', async () => {
    const ctx = await setup()
    await ctx.call('component_variant_add', { componentId: ctx.tileId, name: 'flat' })
    const before = await ctx.get()
    const tileFlat = before.components.find(c => c.id === ctx.tileId)!.variants[0]!.id
    const fill = findNode(before.pages[0]!.root, ctx.first)!.children[0]!
    await ctx.call('instance_replace', { pageId: ctx.pageId, nodeId: ctx.first, componentId: ctx.tileId })
    const replaced = findNode((await ctx.get()).pages[0]!.root, ctx.first)!
    expect(replaced.props).toEqual({ component: ctx.tileId, variant: tileFlat, [ctx.tileTitleId]: 'Mocha' })
    expect(replaced.children).toEqual([{ ...fill, props: { slot: ctx.tileBodyId } }])
    // Only that instance.
    expect(findNode((await ctx.get()).pages[0]!.root, ctx.second)!.props.component).toBe(ctx.cardId)
  })

  it('with all, swaps every instance of the component across pages, components and layouts, as one undo step', async () => {
    const ctx = await setup()
    const { layoutId } = await ctx.call<{ layoutId: string }>('layout_create', { name: 'Site' })
    const { nodeId: inLayout } = await ctx.call<{ nodeId: string }>('node_insert', { layoutId, type: 'Instance', props: { component: ctx.cardId } })
    const { componentId: wrapId } = await ctx.call<{ componentId: string }>('component_create', { pageId: ctx.pageId, nodeId: ctx.second, name: 'Wrap' })
    const before = await ctx.get()
    await ctx.call('instance_replace', { pageId: ctx.pageId, nodeId: ctx.first, componentId: ctx.tileId, all: true })
    const after = await ctx.get()
    const usesCard = (root: DocNode) => {
      let found = false
      const visit = (n: DocNode) => {
        if (n.props.component === ctx.cardId) found = true
        n.children.forEach(visit)
      }
      visit(root)
      return found
    }
    expect(after.pages.some(p => usesCard(p.root))).toBe(false)
    expect(after.components.some(c => usesCard(c.root))).toBe(false)
    expect(findNode(after.layouts[0]!.root, inLayout)!.props.component).toBe(ctx.tileId)
    expect(after.components.find(c => c.id === wrapId)!.root.props.component).toBe(ctx.tileId)
    expect(await ctx.call('history_get', {})).toMatchObject({ undo: 'Replace all instances' })
    await ctx.call('history_undo', {})
    const undone = await ctx.get()
    expect(undone.pages).toEqual(before.pages)
    expect(undone.components).toEqual(before.components)
    expect(undone.layouts).toEqual(before.layouts)
  })

  it('swaps instances nested in another instance\'s slot content too', async () => {
    const ctx = await setup()
    const fill = findNode((await ctx.get()).pages[0]!.root, ctx.first)!.children[0]!
    const { nodeId: inner } = await ctx.call<{ nodeId: string }>('node_insert', { pageId: ctx.pageId, parentId: fill.id, type: 'Instance', props: { component: ctx.cardId } })
    await ctx.call('instance_replace', { pageId: ctx.pageId, nodeId: ctx.second, componentId: ctx.tileId, all: true })
    const root = (await ctx.get()).pages[0]!.root
    expect(findNode(root, ctx.first)!.props.component).toBe(ctx.tileId)
    expect(findNode(root, inner)!.props.component).toBe(ctx.tileId)
  })

  it('is one undo step', async () => {
    const ctx = await setup()
    const before = await ctx.get()
    await ctx.call('instance_replace', { pageId: ctx.pageId, nodeId: ctx.first, componentId: ctx.tileId })
    expect(await ctx.call('history_get', {})).toMatchObject({ undo: 'Replace instance' })
    await ctx.call('history_undo', {})
    expect((await ctx.get()).pages).toEqual(before.pages)
  })

  it('refuses a swap that would create a cycle, and the same component', async () => {
    const ctx = await setup()
    const { nodeId: nested } = await ctx.call<{ nodeId: string }>('node_insert', { componentId: ctx.tileId, type: 'Instance', props: { component: ctx.cardId } })
    const before = await ctx.get()
    // Tile holds a Card: Tile's own Card can't become a Tile, and no Card can become a Tile with all (that one is in Tile).
    await expect(ctx.call('instance_replace', { inComponentId: ctx.tileId, nodeId: nested, componentId: ctx.tileId }))
      .rejects.toMatchObject({ code: 'invalid', message: '"Tile" cannot contain itself: replacing would create a cycle' })
    await expect(ctx.call('instance_replace', { pageId: ctx.pageId, nodeId: ctx.second, componentId: ctx.tileId, all: true }))
      .rejects.toMatchObject({ code: 'invalid', message: '"Tile" cannot contain itself: replacing would create a cycle' })
    // A component that contains the host: Wrap holds Tile, so Tile's Card can't become a Wrap.
    const { nodeId: tileOnPage } = await ctx.call<{ nodeId: string }>('node_insert', { pageId: ctx.pageId, type: 'Instance', props: { component: ctx.tileId } })
    const { componentId: wrapId } = await ctx.call<{ componentId: string }>('component_create', { pageId: ctx.pageId, nodeId: tileOnPage, name: 'Wrap' })
    await expect(ctx.call('instance_replace', { inComponentId: ctx.tileId, nodeId: nested, componentId: wrapId }))
      .rejects.toMatchObject({ code: 'invalid', message: '"Wrap" contains "Tile": replacing would create a cycle' })
    await expect(ctx.call('instance_replace', { pageId: ctx.pageId, nodeId: ctx.first, componentId: ctx.cardId }))
      .rejects.toMatchObject({ code: 'invalid', message: 'The instance already uses "Card"' })
    expect((await ctx.get()).components.find(c => c.id === ctx.tileId)).toEqual(before.components.find(c => c.id === ctx.tileId))
  })

  it('refuses an unknown component and a node that is not an instance', async () => {
    const ctx = await setup()
    await expect(ctx.call('instance_replace', { pageId: ctx.pageId, nodeId: ctx.first, componentId: 'cmp_nope' })).rejects.toMatchObject({ code: 'not_found' })
    const root = (await ctx.get()).pages[0]!.root.id
    await expect(ctx.call('instance_replace', { pageId: ctx.pageId, nodeId: root, componentId: ctx.tileId })).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('component_duplicate', () => {
  it('copies the definition, properties and variants as "<name> copy", made unique', async () => {
    const ctx = await setup()
    const { componentId } = await ctx.call<{ componentId: string }>('component_duplicate', { componentId: ctx.cardId })
    const project = await ctx.get()
    const card = project.components.find(c => c.id === ctx.cardId)!
    const copy = project.components.find(c => c.id === componentId)!
    expect(copy.id).not.toBe(card.id)
    expect(copy).toEqual({ ...card, id: componentId, name: 'Card copy' })
    expect(project.components.indexOf(copy)).toBe(project.components.indexOf(card) + 1)
    const { componentId: again } = await ctx.call<{ componentId: string }>('component_duplicate', { componentId: ctx.cardId })
    expect((await ctx.get()).components.find(c => c.id === again)!.name).toBe('Card copy 2')
  })

  it('takes a name, unique ignoring case, and is one undo step', async () => {
    const ctx = await setup()
    await expect(ctx.call('component_duplicate', { componentId: ctx.cardId, name: 'tile' })).rejects.toMatchObject({ code: 'invalid', message: 'A component named "Tile" already exists' })
    const before = await ctx.get()
    const { componentId } = await ctx.call<{ componentId: string }>('component_duplicate', { componentId: ctx.cardId, name: 'Cards/Big' })
    expect((await ctx.get()).components.find(c => c.id === componentId)!.name).toBe('Cards/Big')
    expect(await ctx.call('history_get', {})).toMatchObject({ undo: 'Duplicate component' })
    await ctx.call('history_undo', {})
    expect((await ctx.get()).components).toEqual(before.components)
  })
})

describe('layout_duplicate', () => {
  it('copies the layout as "<name> copy", made unique, as one undo step; pages keep theirs', async () => {
    const ctx = await setup()
    const { layoutId } = await ctx.call<{ layoutId: string }>('layout_create', { name: 'Site' })
    await ctx.call('layout_variable_add', { layoutId, name: 'Title', kind: 'text' })
    await ctx.call('page_set_layout', { pageId: ctx.pageId, layoutId })
    const before = await ctx.get()
    const { layoutId: copyId } = await ctx.call<{ layoutId: string }>('layout_duplicate', { layoutId })
    const after = await ctx.get()
    expect(after.layouts.find(l => l.id === copyId)).toEqual({ ...before.layouts[0]!, id: copyId, name: 'Site copy' })
    expect(after.pages[0]!.layoutId).toBe(layoutId)
    await expect(ctx.call('layout_duplicate', { layoutId, name: 'SITE' })).rejects.toMatchObject({ code: 'invalid', message: 'A layout named "Site" already exists' })
    expect(await ctx.call('history_get', {})).toMatchObject({ undo: 'Duplicate layout' })
    await ctx.call('history_undo', {})
    expect((await ctx.get()).layouts).toEqual(before.layouts)
  })
})
