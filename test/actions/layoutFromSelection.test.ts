import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { layoutCreateFromSelection } from '../../server/actions/layout'
import type { DocNode, Project } from '#shared/document/schema'
import { resolvePageWithLayout } from '#shared/runtime/layouts'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

/** The tree as `Type` / `Type(children)` text, so ids don't get in the way. */
const shape = (node: DocNode): string => (node.children.length ? `${node.type}(${node.children.map(shape).join(',')})` : node.type)
const strip = ({ version: _v, updatedAt: _u, ...rest }: Project) => rest

/** Home holds a nav Row, a Heading, a Text and a footer Container (with a Text); the action is registered even before the registry lists it. */
async function setup() {
  const actions = ACTIONS.some(a => a.name === layoutCreateFromSelection.name) ? ACTIONS : [...ACTIONS, layoutCreateFromSelection]
  const bildr = createBildr(memoryStorage(), actions)
  const created = await bildr.call<Project>('project_create', { name: 'Site' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const get = () => bildr.call<Project>('project_get', { projectId }, mcp)
  const call = <T = { version: number }>(name: string, input: Record<string, unknown> = {}) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const insert = async (input: Record<string, unknown>) => (await call<{ nodeId: string }>('node_insert', { pageId, ...input })).nodeId
  const nav = await insert({ type: 'Row', children: [{ type: 'Text', props: { text: 'Logo' } }] })
  await call('node_rename', { pageId, nodeId: nav, name: 'Nav' })
  const title = await insert({ type: 'Heading', props: { text: 'Welcome' } })
  const body = await insert({ type: 'Text', props: { text: 'Hello' } })
  const footer = await insert({ type: 'Container', children: [{ type: 'Text', props: { text: '© Site' } }] })
  return { bildr, projectId, pageId, get, call, nav, title, body, footer }
}

describe('layout_create_from_selection', () => {
  it('wraps the selection around a children slot: the selection is the layout, the page keeps its other content and gets the layout', async () => {
    const { call, get, pageId, nav, footer } = await setup()
    const before = await get()
    const rendered = shape(before.pages[0]!.root)

    const result = await call<{ layoutId: string, slotNodeId: string }>('layout_create_from_selection', { pageId, nodeIds: [footer, nav], name: 'Site layout' })

    const after = await get()
    const layout = after.layouts.find(l => l.id === result.layoutId)!
    const page = after.pages[0]!
    expect(layout.name).toBe('Site layout')
    expect(shape(layout.root)).toBe('Page(Row(Text),Container,Container(Text))')
    expect(layout.root.children[0]!.name).toBe('Nav')
    expect(layout.slots).toEqual([{ id: 'children', name: 'Content', nodeId: result.slotNodeId }])
    expect(layout.root.children[1]!.id).toBe(result.slotNodeId)
    expect(page.layoutId).toBe(result.layoutId)
    expect(shape(page.root)).toBe('Page(Heading,Text)')
    // The page renders as before, with the slot container around its content.
    expect(shape(resolvePageWithLayout(page, after.layouts, after.components))).toBe('Page(Row(Text),Container(Heading,Text),Container(Text))')
    expect(rendered).toBe('Page(Row(Text),Heading,Text,Container(Text))')
  })

  it('puts the slot after the selection when the selection leads the page, and names the layout itself without a name', async () => {
    const { call, get, pageId, nav } = await setup()
    await call('layout_create', { name: 'Layout' })
    const { layoutId } = await call<{ layoutId: string }>('layout_create_from_selection', { pageId, nodeIds: [nav] })
    const layout = (await get()).layouts.find(l => l.id === layoutId)!
    expect(layout.name).toBe('Layout 2')
    expect(shape(layout.root)).toBe('Page(Row(Text),Container)')
  })

  it('is one undo step', async () => {
    const { call, get, pageId, nav, footer } = await setup()
    const before = strip(await get())
    await call('layout_create_from_selection', { pageId, nodeIds: [nav, footer], name: 'Site layout' })
    expect(await call('history_get')).toMatchObject({ undo: 'Create layout from selection' })
    await call('history_undo')
    expect(strip(await get())).toEqual(before)
  })

  it('refuses the page root, nested layers, a page that already has a layout, and a used name', async () => {
    const { call, get, pageId, nav } = await setup()
    const page = (await get()).pages[0]!
    const logo = page.root.children[0]!.children[0]!.id
    await expect(call('layout_create_from_selection', { pageId, nodeIds: [page.root.id] })).rejects.toMatchObject({ code: 'invalid', message: 'The page root cannot become a layout' })
    await expect(call('layout_create_from_selection', { pageId, nodeIds: [logo] })).rejects.toMatchObject({ code: 'invalid', message: 'Only top-level layers of the page can become a layout' })
    await expect(call('layout_create_from_selection', { pageId, nodeIds: ['n_missing'] })).rejects.toMatchObject({ code: 'not_found' })
    await call('layout_create', { name: 'Main' })
    await expect(call('layout_create_from_selection', { pageId, nodeIds: [nav], name: 'main' })).rejects.toMatchObject({ code: 'invalid', message: 'A layout named "Main" already exists' })
    const { layoutId } = await call<{ layoutId: string }>('layout_create_from_selection', { pageId, nodeIds: [nav], name: 'Site' })
    const title = (await get()).pages[0]!.root.children[0]!.id
    await expect(call('layout_create_from_selection', { pageId, nodeIds: [title], name: 'Other' })).rejects.toMatchObject({ code: 'invalid', message: 'Page "Home" already uses the layout "Site"' })
    expect((await get()).layouts.map(l => l.id)).toContain(layoutId)
  })
})
