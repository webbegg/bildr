import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { DocNode, Project } from '#shared/document/schema'
import { resolveInstance } from '#shared/runtime/instances'
import { resolvePageWithLayout } from '#shared/runtime/layouts'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const get = () => call<Project>('project_get', {})
  return { bildr, projectId, pageId, call, get }
}

async function withBadge() {
  const ctx = await setup()
  const { nodeId: cardId } = await ctx.call<{ nodeId: string }>('node_insert', { pageId: ctx.pageId, type: 'Card', children: [{ type: 'Text', props: { text: 'New' } }] })
  const { componentId, nodeId } = await ctx.call<{ componentId: string, nodeId: string }>('component_create', { pageId: ctx.pageId, nodeId: cardId, name: 'Badge' })
  const def = (await ctx.get()).components[0]!
  return { ...ctx, componentId, nodeId, labelId: def.root.children[0]!.id }
}

const label = (project: Project) => resolveInstance(project.pages[0]!.root.children[0]!, project.components)!.children[0]!

describe('style bindings through the component actions (S4d)', () => {
  it('binds a property to a style key; instances set it with checked values', async () => {
    const { call, get, componentId, nodeId, labelId, pageId } = await withBadge()
    const { propertyId } = await call<{ propertyId: string }>('component_property_add', {
      componentId, name: 'Tint', kind: 'text', default: 'primary', bindings: [{ nodeId: labelId, prop: 'color', target: 'style' }]
    })
    expect(label(await get()).style.color).toBe('primary')

    await call('instance_set_values', { pageId, nodeId, values: { [propertyId]: '#ff6600' } })
    expect(label(await get()).style.color).toBe('#ff6600')
    await expect(call('instance_set_values', { pageId, nodeId, values: { [propertyId]: 'ghost' } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('"ghost" is not a value of style token "color"') })

    await call('history_undo', {})
    expect(label(await get()).style.color).toBe('primary')
  })

  it('refuses a binding to an unknown style key or a bad default', async () => {
    const { call, componentId, labelId } = await withBadge()
    await expect(call('component_property_add', { componentId, name: 'Tint', kind: 'text', bindings: [{ nodeId: labelId, prop: 'tint', target: 'style' }] }))
      .rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('unknown style token "tint"') })
    await expect(call('component_property_add', { componentId, name: 'Tint', kind: 'text', default: 'nope', bindings: [{ nodeId: labelId, prop: 'color', target: 'style' }] }))
      .rejects.toMatchObject({ code: 'invalid' })
  })

  it('keeps a theme colour in use by a style-bound value from being removed', async () => {
    const { call, get, componentId, nodeId, labelId, pageId } = await withBadge()
    await call('theme_update', { custom: { brand: '#ff6600' } })
    const { propertyId } = await call<{ propertyId: string }>('component_property_add', { componentId, name: 'Tint', kind: 'text', bindings: [{ nodeId: labelId, prop: 'color', target: 'style' }] })
    await call('instance_set_values', { pageId, nodeId, values: { [propertyId]: 'brand' } })
    expect(label(await get()).style.color).toBe('brand')
    await expect(call('theme_update', { custom: { brand: null } })).rejects.toMatchObject({ message: expect.stringContaining('"brand" is still used') })
  })
})

describe('style bindings through the layout actions (S4d)', () => {
  it('binds a layout variable to a style key that pages set', async () => {
    const { call, get, pageId } = await setup()
    const { layoutId } = await call<{ layoutId: string }>('layout_create', { name: 'Main' })
    const { nodeId: barId } = await call<{ nodeId: string }>('node_insert', { layoutId, type: 'Container', index: 0 })
    const { variableId } = await call<{ variableId: string }>('layout_variable_add', { layoutId, name: 'Bar', kind: 'text', default: 'muted', bindings: [{ nodeId: barId, prop: 'bg', target: 'style' }] })
    await call('page_set_layout', { pageId, layoutId })
    await call('page_set_layout_values', { pageId, values: { [variableId]: '#123' } })
    const project = await get()
    const rendered = resolvePageWithLayout(project.pages[0]!, project.layouts, project.components)
    const bar = rendered.children.find((c: DocNode) => c.id.endsWith(barId))!
    expect(bar.style.bg).toBe('#123')
    await expect(call('page_set_layout_values', { pageId, values: { [variableId]: 'ghost' } })).rejects.toMatchObject({ code: 'invalid' })
  })
})
