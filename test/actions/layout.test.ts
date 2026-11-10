import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { DocNode, Project } from '#shared/document/schema'
import { resolvePageWithLayout } from '#shared/runtime/layouts'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

/** The tree as `Type` / `Type(children)` text, so ids don't get in the way. */
const shape = (node: DocNode): string => (node.children.length ? `${node.type}(${node.children.map(shape).join(',')})` : node.type)
const strip = ({ version: _v, updatedAt: _u, ...rest }: Project) => rest

async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Site' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const get = () => bildr.call<Project>('project_get', { projectId }, mcp)
  const call = <T = { version: number }>(name: string, input: Record<string, unknown> = {}) => bildr.call<T>(name, { projectId, ...input }, mcp)
  return { bildr, projectId, pageId, get, call }
}

/** Layout "Main" with a Heading (Title variable), the children slot and a Footer slot holding a Text; Home uses it. */
async function withLayout() {
  const ctx = await setup()
  const created = await ctx.call<{ layoutId: string, slotNodeId: string }>('layout_create', { name: 'Main' })
  const { layoutId, slotNodeId } = created
  const { nodeId: titleId } = await ctx.call<{ nodeId: string }>('node_insert', { layoutId, type: 'Heading', index: 0, props: { text: 'Site' } })
  const { nodeId: footId } = await ctx.call<{ nodeId: string }>('node_insert', { layoutId, type: 'Container', children: [{ type: 'Text', props: { text: '© Site' } }] })
  const { slotId } = await ctx.call<{ slotId: string }>('layout_slot_add', { layoutId, name: 'Footer', nodeId: footId })
  const { variableId } = await ctx.call<{ variableId: string }>('layout_variable_add', { layoutId, name: 'Title', kind: 'text', default: 'Site', bindings: [{ nodeId: titleId, prop: 'text' }] })
  await ctx.call('page_set_layout', { pageId: ctx.pageId, layoutId })
  await ctx.call('node_insert', { pageId: ctx.pageId, type: 'Text', props: { text: 'Hello' } })
  return { ...ctx, layoutId, slotNodeId, titleId, footId, slotId, variableId }
}

describe('layout_create, layout_rename', () => {
  it('creates a layout with a Page root holding the children slot container', async () => {
    const { call, get } = await setup()
    const { layoutId, slotNodeId } = await call<{ layoutId: string, slotNodeId: string }>('layout_create', { name: 'Main' })
    const layout = (await get()).layouts[0]!
    expect(layout).toMatchObject({ id: layoutId, name: 'Main', slots: [{ id: 'children', name: 'Content', nodeId: slotNodeId }], variables: [] })
    expect(shape(layout.root)).toBe('Page(Container)')
    await call('layout_rename', { layoutId, name: 'Site' })
    expect((await get()).layouts[0]!.name).toBe('Site')
  })
})

describe('a page using a layout', () => {
  it('renders the shared regions around the page content, defaults in unfilled slots and the page values', async () => {
    const { call, get, pageId, variableId, slotId } = await withLayout()
    let project = await get()
    const render = () => resolvePageWithLayout(project.pages[0]!, project.layouts, project.components)
    expect(shape(render())).toBe('Page(Heading,Container(Text),Container(Text))')
    expect(render().children[0]!.props.text).toBe('Site')
    expect(render().children[2]!.children[0]!.props.text).toBe('© Site')

    await call('page_set_layout_values', { pageId, values: { [variableId]: 'Welcome' } })
    const { fillId } = await call<{ fillId: string }>('page_set_slot', { pageId, slot: slotId, filled: true })
    await call('node_insert', { pageId, parentId: fillId, type: 'Button' })
    project = await get()
    expect(project.pages[0]!.layoutValues).toEqual({ [variableId]: 'Welcome' })
    expect(render().children[0]!.props.text).toBe('Welcome')
    expect(shape(render())).toBe('Page(Heading,Container(Text),Container(Button))')

    await call('page_set_slot', { pageId, slot: slotId, filled: false })
    project = await get()
    expect(render().children[2]!.children[0]!.props.text).toBe('© Site')
  })

  it('refuses values that do not fit and filling the children slot', async () => {
    const { call, pageId, variableId } = await withLayout()
    await expect(call('page_set_layout_values', { pageId, values: { [variableId]: 3 } })).rejects.toThrow('must be a string')
    await expect(call('page_set_slot', { pageId, slot: 'children', filled: true })).rejects.toThrow('takes the page content')
  })

  it('switching or removing the layout drops the page values and slot content, as one undo step', async () => {
    const { call, get, pageId, variableId, slotId } = await withLayout()
    await call('page_set_layout_values', { pageId, values: { [variableId]: 'Welcome' } })
    await call('page_set_slot', { pageId, slot: slotId, filled: true })
    const before = await get()
    await call('page_set_layout', { pageId, layoutId: null })
    const page = (await get()).pages[0]!
    expect(page.layoutId).toBeUndefined()
    expect(page.layoutValues).toBeUndefined()
    expect(shape(page.root)).toBe('Page(Text)')
    await call('history_undo')
    expect(strip(await get())).toEqual(strip(before))
  })
})

describe('layout_delete', () => {
  it('detaches its pages and drops their slot content, and one undo restores everything', async () => {
    const { call, get, pageId, layoutId, slotId, variableId } = await withLayout()
    await call('page_set_layout_values', { pageId, values: { [variableId]: 'Welcome' } })
    await call('page_set_slot', { pageId, slot: slotId, filled: true })
    const before = await get()
    const result = await call<{ detachedPages: string[] }>('layout_delete', { layoutId })
    expect(result.detachedPages).toEqual([pageId])
    const after = await get()
    expect(after.layouts).toEqual([])
    expect(after.pages[0]!.layoutId).toBeUndefined()
    expect(shape(after.pages[0]!.root)).toBe('Page(Text)')
    expect(await call('history_get')).toEqual({ undo: 'Delete layout', redo: null })
    await call('history_undo')
    expect(strip(await get())).toEqual(strip(before))
  })
})

describe('layout slots and variables', () => {
  it('removing a slot removes the pages\' content for it, and removing a variable their values', async () => {
    const { call, get, pageId, layoutId, slotId, variableId } = await withLayout()
    await call('page_set_layout_values', { pageId, values: { [variableId]: 'Welcome' } })
    await call('page_set_slot', { pageId, slot: slotId, filled: true })
    await call('layout_slot_remove', { layoutId, slotId })
    await call('layout_variable_remove', { layoutId, variableId })
    const project = await get()
    expect(project.layouts[0]!.slots.map(s => s.id)).toEqual(['children'])
    expect(project.layouts[0]!.variables).toEqual([])
    expect(shape(project.pages[0]!.root)).toBe('Page(Text)')
    expect(project.pages[0]!.layoutValues).toBeUndefined()
  })

  it('updates a slot and a variable, and refuses removing the children slot', async () => {
    const { call, get, layoutId, slotId, variableId, titleId } = await withLayout()
    await call('layout_slot_update', { layoutId, slotId, name: 'Bottom' })
    await call('layout_variable_update', { layoutId, variableId, name: 'Heading', default: null, bindings: [{ nodeId: titleId, prop: 'text' }] })
    const layout = (await get()).layouts[0]!
    expect(layout.slots[1]!.name).toBe('Bottom')
    expect(layout.variables[0]).toEqual({ id: variableId, name: 'Heading', kind: 'text', bindings: [{ nodeId: titleId, prop: 'text' }] })
    await expect(call('layout_slot_remove', { layoutId, slotId: 'children' })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('node actions on a layout (layoutId)', () => {
  it('edits the layout tree, not the pages, and refuses deleting its root', async () => {
    const { call, get, layoutId, titleId } = await withLayout()
    const page = (await get()).pages[0]!
    await call('node_update_props', { layoutId, nodeId: titleId, props: { level: '2' } })
    await call('node_update_style', { layoutId, nodeId: titleId, style: { mt: '4' } })
    const { nodeId: copyId } = await call<{ nodeId: string }>('node_duplicate', { layoutId, nodeId: titleId })
    await call('node_delete', { layoutId, nodeId: copyId })
    const project = await get()
    expect(project.layouts[0]!.root.children[0]).toMatchObject({ id: titleId, props: { level: '2' }, style: { mt: '4' } })
    expect(project.pages[0]).toEqual(page)
    await expect(call('node_delete', { layoutId, nodeId: project.layouts[0]!.root.id })).rejects.toThrow('The layout root cannot be removed')
    await expect(call('node_insert', { pageId: page.id, layoutId, type: 'Text' })).rejects.toThrow('Give pageId, componentId or layoutId')
  })
})

describe('component_delete with instances in layouts', () => {
  it('reports them and removes them with force', async () => {
    const { call, get, pageId, layoutId } = await withLayout()
    const { nodeId } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Card' })
    const { componentId, nodeId: instanceId } = await call<{ componentId: string, nodeId: string }>('component_create', { pageId, nodeId, name: 'Card' })
    await call('node_delete', { pageId, nodeId: instanceId })
    await call('node_insert', { layoutId, type: 'Instance', props: { component: componentId } })
    await expect(call('component_delete', { componentId })).rejects.toThrow('"Card" is used by 1 instance: layout "Main"')
    await call('component_delete', { componentId, force: true })
    const project = await get()
    expect(project.components).toEqual([])
    expect(project.layouts[0]!.root.children.some(c => c.type === 'Instance')).toBe(false)
  })
})
