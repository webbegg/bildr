import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { ProjectSchema, PropertyDefSchema } from '#shared/document/schema'
import { createProject } from '#shared/document/factory'
import { resolveInstance } from '#shared/runtime/instances'
import { resolvePageWithLayout } from '#shared/runtime/layouts'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const get = () => bildr.call<Project>('project_get', { projectId }, mcp)
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const { nodeId } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Card', children: [{ type: 'Heading', props: { text: 'Latte' } }, { type: 'Button', props: { label: 'Buy' } }] })
  const { componentId, nodeId: instanceId } = await call<{ componentId: string, nodeId: string }>('component_create', { pageId, nodeId, name: 'Card' })
  const def = (await get()).components[0]!
  const [heading, button] = def.root.children
  return { get, call, pageId, componentId, instanceId, heading: heading!, button: button! }
}

describe('property details: description, optional, placeholder', () => {
  it('are optional schema fields, checked when given', () => {
    const base = { id: 'prop_a', name: 'Title', kind: 'text' }
    expect(PropertyDefSchema.parse(base)).toEqual({ ...base, bindings: [] })
    expect(PropertyDefSchema.parse({ ...base, description: 'The card title', optional: true, placeholder: 'Card title' }))
      .toMatchObject({ description: 'The card title', optional: true, placeholder: 'Card title' })
    expect(PropertyDefSchema.safeParse({ ...base, description: 'x'.repeat(501) }).success).toBe(false)
    expect(PropertyDefSchema.safeParse({ ...base, placeholder: 'x'.repeat(201) }).success).toBe(false)
    expect(PropertyDefSchema.safeParse({ ...base, optional: 'yes' }).success).toBe(false)
  })

  it('leave documents saved before them unchanged', () => {
    const project = createProject('Old')
    const old = {
      ...project,
      components: [{ id: 'cmp_a', name: 'A', root: { id: 'n_a', type: 'Heading', props: { text: 'Hi' }, style: {}, children: [] }, properties: [{ id: 'prop_a', name: 'Title', kind: 'text', default: 'Hi', bindings: [{ nodeId: 'n_a', prop: 'text' }] }], variants: [] }]
    }
    const parsed = ProjectSchema.parse(structuredClone(old))
    expect(parsed.components).toEqual(old.components)
  })

  it('component_property_add and _update set them; null removes one; each is one undo step', async () => {
    const ctx = await setup()
    const { propertyId } = await ctx.call<{ propertyId: string }>('component_property_add', {
      componentId: ctx.componentId, name: 'Title', kind: 'text', bindings: [{ nodeId: ctx.heading.id, prop: 'text' }], description: 'The heading', placeholder: 'A title'
    })
    const property = async () => (await ctx.get()).components[0]!.properties.find(p => p.id === propertyId)!
    expect(await property()).toMatchObject({ description: 'The heading', placeholder: 'A title' })
    expect((await property()).optional).toBeUndefined()

    await ctx.call('component_property_update', { componentId: ctx.componentId, propertyId, optional: true, description: null, default: 'Mocha' })
    const updated = await property()
    expect(updated).toMatchObject({ optional: true, placeholder: 'A title', default: 'Mocha' })
    expect('description' in updated).toBe(false)

    await ctx.call('history_undo', {})
    expect(await property()).toMatchObject({ description: 'The heading', placeholder: 'A title' })
    expect((await property()).optional).toBeUndefined()
    expect((await property()).default).toBeUndefined()
  })

  it('component_property_update with index reorders the properties, undoably', async () => {
    const ctx = await setup()
    const add = (name: string, nodeId: string, prop: string) => ctx.call<{ propertyId: string }>('component_property_add', { componentId: ctx.componentId, name, kind: 'text', bindings: [{ nodeId, prop }] })
    const { propertyId: a } = await add('Title', ctx.heading.id, 'text')
    const { propertyId: b } = await add('Label', ctx.button.id, 'label')
    const order = async () => (await ctx.get()).components[0]!.properties.map(p => p.id)
    await ctx.call('component_property_update', { componentId: ctx.componentId, propertyId: b, index: 0 })
    expect(await order()).toEqual([b, a])
    await ctx.call('history_undo', {})
    expect(await order()).toEqual([a, b])
    await expect(ctx.call('component_property_update', { componentId: ctx.componentId, propertyId: b, index: 2 })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('the renderer uses the default when an instance has no value', async () => {
    const ctx = await setup()
    const { propertyId } = await ctx.call<{ propertyId: string }>('component_property_add', { componentId: ctx.componentId, name: 'Title', kind: 'text', default: 'Mocha', bindings: [{ nodeId: ctx.heading.id, prop: 'text' }] })
    const render = async () => {
      const project = await ctx.get()
      return resolveInstance(project.pages[0]!.root.children[0]!, project.components)!.children[0]!.props.text
    }
    expect(await render()).toBe('Mocha')
    await ctx.call('instance_set_values', { pageId: ctx.pageId, nodeId: ctx.instanceId, values: { [propertyId]: 'Flat white' } })
    expect(await render()).toBe('Flat white')
    await ctx.call('instance_set_values', { pageId: ctx.pageId, nodeId: ctx.instanceId, values: { [propertyId]: null } })
    expect(await render()).toBe('Mocha')
  })

  it('layout variables take them too, reorder, and render their default', async () => {
    const ctx = await setup()
    const { layoutId } = await ctx.call<{ layoutId: string }>('layout_create', { name: 'Site' })
    const { nodeId: heading } = await ctx.call<{ nodeId: string }>('node_insert', { layoutId, type: 'Heading', index: 0 })
    const { variableId: a } = await ctx.call<{ variableId: string }>('layout_variable_add', { layoutId, name: 'Title', kind: 'text', default: 'Welcome', bindings: [{ nodeId: heading, prop: 'text' }], description: 'Page title', optional: true, placeholder: 'Title' })
    const { variableId: b } = await ctx.call<{ variableId: string }>('layout_variable_add', { layoutId, name: 'Tag', kind: 'text' })
    const layout = async () => (await ctx.get()).layouts[0]!
    expect((await layout()).variables[0]).toMatchObject({ description: 'Page title', optional: true, placeholder: 'Title' })
    await ctx.call('layout_variable_update', { layoutId, variableId: b, index: 0, placeholder: 'A tag' })
    expect((await layout()).variables.map(v => v.id)).toEqual([b, a])
    expect((await layout()).variables[0]!.placeholder).toBe('A tag')
    await ctx.call('history_undo', {})
    expect((await layout()).variables.map(v => v.id)).toEqual([a, b])
    expect((await layout()).variables[1]!.placeholder).toBeUndefined()

    await ctx.call('page_set_layout', { pageId: ctx.pageId, layoutId })
    const project = await ctx.get()
    const rendered = resolvePageWithLayout(project.pages[0]!, project.layouts, project.components)
    expect(rendered.children[0]!.props.text).toBe('Welcome')
  })
})
