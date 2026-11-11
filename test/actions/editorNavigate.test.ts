import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent, NavigateEvent } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { navigateTarget } from '#shared/editor/navigate'
import { memoryStorage } from '../helpers'

const ui = { caller: 'ui' as const, source: 'tab-1' }
const mcp = { caller: 'mcp' as const, source: 'mcp' }

/** Home and About; a Card component (with a Hover variant) made from a Heading on Home, and a layout Main. */
async function setup() {
  const bildr = createBildr(memoryStorage())
  const changes: ChangeEvent[] = []
  const navigations: NavigateEvent[] = []
  bildr.onChange(e => changes.push(e))
  bildr.onNavigate(e => navigations.push(e))
  const created = await bildr.call<Project>('project_create', { name: 'Demo' }, ui)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) => bildr.call<T>(name, { projectId, ...input }, ui)
  const { pageId: aboutId } = await call<{ pageId: string }>('page_add', { name: 'About' })
  const { nodeId } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Heading', props: { text: 'Welcome' } })
  const { componentId } = await call<{ componentId: string }>('component_create', { pageId, nodeId, name: 'Card' })
  const { variantId } = await call<{ variantId: string }>('component_variant_add', { componentId, name: 'Hover' })
  const { layoutId } = await call<{ layoutId: string }>('layout_create', { name: 'Main' })
  const project = await call<Project>('project_get')
  return { bildr, changes, navigations, projectId, pageId, aboutId, componentId, variantId, layoutId, project, call }
}

describe('editor_navigate to a component or layout', () => {
  it('opens a component (and a variant) from the page the editor is on, without changing the document', async () => {
    const { bildr, changes, navigations, projectId, aboutId, componentId, variantId, call } = await setup()
    await bildr.call('editor_set_context', { projectId, pageId: aboutId, selectedId: null }, ui)
    const count = changes.length
    const before = (await call<Project>('project_get')).version

    expect(await bildr.call('editor_navigate', { projectId, componentId }, mcp)).toEqual({ pageId: aboutId, nodeId: null, componentId, layoutId: null, variantId: null })
    expect(await bildr.call('editor_navigate', { projectId, componentId, variantId }, mcp)).toMatchObject({ componentId, variantId })

    expect(navigations.map(n => n.pageId)).toEqual([aboutId, aboutId])
    expect(changes.length).toBe(count)
    expect((await call<Project>('project_get')).version).toBe(before)
  })

  it('opens a layout; without an editor context it starts from the first page', async () => {
    const { bildr, navigations, projectId, pageId, layoutId } = await setup()
    expect(await bildr.call('editor_navigate', { projectId, layoutId }, mcp)).toMatchObject({ pageId, layoutId, componentId: null })
    expect(navigations).toHaveLength(1)
  })

  it('the event the editor gets resolves to the component, variant or layout asked for', async () => {
    const { bildr, navigations, projectId, pageId, componentId, variantId, layoutId, project } = await setup()
    await bildr.call('editor_navigate', { projectId, componentId }, mcp)
    await bildr.call('editor_navigate', { projectId, componentId, variantId, pageId }, mcp)
    await bildr.call('editor_navigate', { projectId, layoutId }, mcp)
    expect(navigations.map(n => navigateTarget(project, n.pageId, n.nodeId))).toEqual([
      { pageId, nodeId: null, componentId, layoutId: null, variantId: null },
      { pageId, nodeId: null, componentId, layoutId: null, variantId },
      { pageId, nodeId: null, componentId: null, layoutId, variantId: null }
    ])
  })

  it('validates the ids and refuses ambiguous targets', async () => {
    const { bildr, navigations, projectId, pageId, componentId, variantId, layoutId, project } = await setup()
    const nodeId = project.pages[0]!.root.children[0]!.id
    await expect(bildr.call('editor_navigate', { projectId }, mcp)).rejects.toMatchObject({ code: 'invalid', message: 'Give pageId, componentId or layoutId' })
    await expect(bildr.call('editor_navigate', { projectId, componentId: 'cmp_missing' }, mcp)).rejects.toMatchObject({ code: 'not_found' })
    await expect(bildr.call('editor_navigate', { projectId, layoutId: 'lay_missing' }, mcp)).rejects.toMatchObject({ code: 'not_found' })
    await expect(bildr.call('editor_navigate', { projectId, componentId, variantId: 'var_missing' }, mcp)).rejects.toMatchObject({ code: 'not_found', message: 'Variant "var_missing" not found in component "Card"' })
    await expect(bildr.call('editor_navigate', { projectId, componentId, layoutId }, mcp)).rejects.toMatchObject({ code: 'invalid', message: 'Give componentId or layoutId, not both' })
    await expect(bildr.call('editor_navigate', { projectId, layoutId, variantId }, mcp)).rejects.toMatchObject({ code: 'invalid', message: 'variantId needs componentId' })
    await expect(bildr.call('editor_navigate', { projectId, pageId, componentId, nodeId }, mcp)).rejects.toMatchObject({ code: 'invalid', message: 'nodeId selects a node on pageId; leave it out with componentId or layoutId' })
    expect(navigations).toEqual([])
  })

  it('still shows a page and selects a node on it', async () => {
    const { bildr, navigations, projectId, pageId, project } = await setup()
    const nodeId = project.pages[0]!.root.children[0]!.id
    expect(await bildr.call('editor_navigate', { projectId, pageId, nodeId }, mcp)).toEqual({ pageId, nodeId, componentId: null, layoutId: null, variantId: null })
    expect(navigations).toEqual([{ projectId, pageId, nodeId, source: 'mcp' }])
    expect(navigateTarget(project, pageId, nodeId)).toEqual({ pageId, nodeId, componentId: null, layoutId: null, variantId: null })
  })
})

describe('editor context with a component, layout or variant', () => {
  it('reports the component and variant being edited, and the node selected in it', async () => {
    const { bildr, projectId, pageId, componentId, variantId, project } = await setup()
    const defRoot = project.components[0]!.root.id
    await bildr.call('editor_set_context', { projectId, pageId, selectedId: defRoot, componentId, variantId }, ui)
    expect(await bildr.call('editor_get_context', { projectId }, mcp)).toMatchObject({
      pageId,
      page: { id: pageId, name: 'Home' },
      component: { id: componentId, name: 'Card' },
      variant: { id: variantId, name: 'Hover' },
      layout: null,
      selected: { id: defRoot, type: 'Heading' }
    })
  })

  it('reports the layout being edited, and nothing for a page', async () => {
    const { bildr, projectId, pageId, layoutId, project } = await setup()
    const slotNode = project.layouts[0]!.slots[0]!.nodeId
    await bildr.call('editor_set_context', { projectId, pageId, selectedId: slotNode, layoutId }, ui)
    expect(await bildr.call('editor_get_context', { projectId }, mcp)).toMatchObject({ layout: { id: layoutId, name: 'Main' }, component: null, variant: null, selected: { id: slotNode, type: 'Container' } })
    await bildr.call('editor_set_context', { projectId, pageId, selectedId: null }, ui)
    expect(await bildr.call('editor_get_context', { projectId }, mcp)).toMatchObject({ component: null, layout: null, variant: null, selected: null })
  })
})
