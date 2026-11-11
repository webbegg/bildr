import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { DocNode, Project } from '#shared/document/schema'
import { findNode, walk } from '#shared/document/tree'
import { resolveInstance } from '#shared/runtime/instances'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

/** What a tree renders, every Instance resolved, without ids and names. */
function render(node: DocNode, components: Project['components']): unknown {
  if (node.type === 'Instance') {
    const resolved = resolveInstance(node, components)
    return resolved ? render(resolved, components) : null
  }
  return { type: node.type, props: node.props, style: node.style, children: node.children.map(c => render(c, components)) }
}

/** Button (Label); Card (Body slot) whose definition holds a Button instance; Badge (BODY slot); Tile holding a Card instance whose Body has a Text. */
async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Verify' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const get = () => bildr.call<Project>('project_get', { projectId }, mcp)
  const call = <T = Record<string, string>>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const component = async (type: string, name: string, children: unknown[] = []) => {
    const { nodeId } = await call('node_insert', { pageId, type, children })
    const { componentId, nodeId: instance } = await call('component_create', { pageId, nodeId, name })
    await call('node_delete', { pageId, nodeId: instance })
    return { id: componentId!, root: (await get()).components.find(c => c.id === componentId)!.root }
  }
  const button = await component('Button', 'Button')
  const card = await component('Card', 'Card', [{ type: 'Container' }])
  const { propertyId: bodyId } = await call('component_property_add', { componentId: card.id, name: 'Body', kind: 'slot', bindings: [{ nodeId: card.root.children[0]!.id, prop: 'children' }] })
  const { nodeId: innerButton } = await call('node_insert', { componentId: card.id, type: 'Instance', props: { component: button.id } })
  const badge = await component('Column', 'Badge', [{ type: 'Container' }])
  await call('component_property_add', { componentId: badge.id, name: 'BODY', kind: 'slot', bindings: [{ nodeId: badge.root.children[0]!.id, prop: 'children' }] })
  const tile = await component('Column', 'Tile')
  const { nodeId: cardInTile } = await call('node_insert', { componentId: tile.id, type: 'Instance', props: { component: card.id } })
  const { fillId } = await call('instance_set_slot', { componentId: tile.id, nodeId: cardInTile, slot: bodyId, filled: true })
  const { nodeId: caption } = await call('node_insert', { componentId: tile.id, parentId: fillId, type: 'Text', props: { text: 'cap' } })
  const { propertyId: captionId } = await call('component_property_add', { componentId: tile.id, name: 'Caption', kind: 'textarea', bindings: [{ nodeId: caption, prop: 'text' }] })
  return { get, call, pageId, button, card, badge, tile, bodyId, innerButton, cardInTile, caption, captionId }
}

describe('instance_replace (verify)', () => {
  it('without all, replaces only that instance, not instances of the same component in its slot content (S2.1)', async () => {
    const ctx = await setup()
    const { nodeId: outer } = await ctx.call('node_insert', { pageId: ctx.pageId, type: 'Instance', props: { component: ctx.card.id } })
    const { fillId } = await ctx.call('instance_set_slot', { pageId: ctx.pageId, nodeId: outer, slot: ctx.bodyId, filled: true })
    const { nodeId: inner } = await ctx.call('node_insert', { pageId: ctx.pageId, parentId: fillId, type: 'Instance', props: { component: ctx.card.id } })
    await ctx.call('instance_replace', { pageId: ctx.pageId, nodeId: outer, componentId: ctx.badge.id })
    const root = (await ctx.get()).pages[0]!.root
    expect(findNode(root, outer)!.props.component).toBe(ctx.badge.id)
    expect(findNode(root, inner)!.props.component).toBe(ctx.card.id)
  })

  it('in a component, keeps slot content that the host binds to when the slot name matches (S2.1)', async () => {
    const ctx = await setup()
    await ctx.call('instance_replace', { inComponentId: ctx.tile.id, nodeId: ctx.cardInTile, componentId: ctx.badge.id })
    const tile = (await ctx.get()).components.find(c => c.id === ctx.tile.id)!
    expect(findNode(tile.root, ctx.caption)).toBeDefined()
    expect(tile.properties[0]!.bindings[0]!.nodeId).toBe(ctx.caption)
  })
})

describe('instance_detach (verify)', () => {
  it('in a component, moves host bindings and variant overrides of nodes in the slot content (S2.1)', async () => {
    const ctx = await setup()
    const { variantId } = await ctx.call('component_variant_add', { componentId: ctx.tile.id, name: 'Big' })
    await ctx.call('component_variant_set_override', { componentId: ctx.tile.id, variantId, nodeId: ctx.caption, style: { color: 'error' } })
    const before = await ctx.get()
    await ctx.call('instance_detach', { componentId: ctx.tile.id, nodeId: ctx.cardInTile })
    const after = await ctx.get()
    const probe: DocNode = { id: 'probe', type: 'Instance', props: { component: ctx.tile.id, variant: variantId, [ctx.captionId]: 'Set' }, style: {}, children: [] }
    expect(render(probe, after.components)).toEqual(render(probe, before.components))
  })

  it('in a layout, keeps layout slots and variables bound to nodes in the slot content (S2.1)', async () => {
    const ctx = await setup()
    const { layoutId } = await ctx.call('layout_create', { name: 'Site' })
    const { nodeId: cardInLayout } = await ctx.call('node_insert', { layoutId, type: 'Instance', props: { component: ctx.card.id } })
    const { fillId } = await ctx.call('instance_set_slot', { layoutId, nodeId: cardInLayout, slot: ctx.bodyId, filled: true })
    const { nodeId: aside } = await ctx.call('node_insert', { layoutId, parentId: fillId, type: 'Container' })
    await ctx.call('layout_slot_add', { layoutId, name: 'Aside', nodeId: aside })
    await ctx.call('instance_detach', { layoutId, nodeId: cardInLayout })
    const layout = (await ctx.get()).layouts[0]!
    expect(findNode(layout.root, layout.slots.find(s => s.name === 'Aside')!.nodeId)).toBeDefined()
  })

  it('renders identically when a host variant removes a key both the definition root and the instance set (S2.1)', async () => {
    const ctx = await setup()
    await ctx.call('node_update_style', { componentId: ctx.button.id, nodeId: ctx.button.root.id, style: { p: '4' } })
    await ctx.call('node_update_style', { componentId: ctx.card.id, nodeId: ctx.innerButton, style: { p: '6' } })
    const { variantId } = await ctx.call('component_variant_add', { componentId: ctx.card.id, name: 'Tight' })
    await ctx.call('component_variant_set_override', { componentId: ctx.card.id, variantId, nodeId: ctx.innerButton, unset: ['p'] })
    const before = await ctx.get()
    await ctx.call('instance_detach', { componentId: ctx.card.id, nodeId: ctx.innerButton })
    const probe: DocNode = { id: 'probe', type: 'Instance', props: { component: ctx.card.id, variant: variantId }, style: {}, children: [] }
    expect(render(probe, (await ctx.get()).components)).toEqual(render(probe, before.components))
  })

  // Decided: nested definition instances stay linked, as in Framer; only the detached instance's own definition becomes plain nodes.
  it('keeps instances from the definition as instances (S2.1)', async () => {
    const ctx = await setup()
    const { nodeId: cardOnPage } = await ctx.call('node_insert', { pageId: ctx.pageId, type: 'Instance', props: { component: ctx.card.id } })
    const { nodeId } = await ctx.call('instance_detach', { pageId: ctx.pageId, nodeId: cardOnPage })
    const types: unknown[] = []
    walk(findNode((await ctx.get()).pages[0]!.root, nodeId)!, (n) => {
      types.push(n.props.component)
    })
    expect(types).toContain(ctx.button.id)
  })
})
