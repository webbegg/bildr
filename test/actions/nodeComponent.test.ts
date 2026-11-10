import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { DocNode, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const ui = { caller: 'ui' as const, source: 'tab-1' }

/** The tree as `Type` / `Type(children)` text, so ids don't get in the way. */
const shape = (node: DocNode): string => (node.children.length ? `${node.type}(${node.children.map(shape).join(',')})` : node.type)

/** A page whose Card (Heading, Text) became component "Card", leaving an instance on the page. */
async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Defs' }, ui)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, ui)
  const { nodeId: cardId } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Card', children: [{ type: 'Heading' }, { type: 'Text' }] })
  const { componentId } = await call<{ componentId: string }>('component_create', { pageId, nodeId: cardId, name: 'Card' })
  const get = () => bildr.call<Project>('project_get', { projectId }, ui)
  const def = async () => (await get()).components[0]!
  const pageRoot = async () => (await get()).pages[0]!.root
  return { bildr, call, projectId, pageId, componentId, def, pageRoot }
}

describe('node actions on a component definition (componentId)', () => {
  it('inserts into the definition root by default, leaving the page alone', async () => {
    const { call, componentId, def, pageRoot } = await setup()
    const page = await pageRoot()
    const result = await call<{ nodeId: string }>('node_insert', { componentId, type: 'Button' })
    const root = (await def()).root
    expect(shape(root)).toBe('Card(Heading,Text,Button)')
    expect(root.children[2]!.id).toBe(result.nodeId)
    expect(await pageRoot()).toEqual(page)
  })

  it('updates props and style, moves, duplicates, wraps and deletes definition nodes', async () => {
    const { call, componentId, def } = await setup()
    const [heading, text] = (await def()).root.children
    await call('node_update_props', { componentId, nodeId: heading!.id, props: { text: 'Hi' } })
    await call('node_update_style', { componentId, nodeId: text!.id, style: { mt: '4' } })
    expect((await def()).root.children[0]!.props.text).toBe('Hi')
    expect((await def()).root.children[1]!.style.mt).toBe('4')

    await call('node_move', { componentId, nodeId: text!.id, parentId: (await def()).root.id, index: 0 })
    expect((await def()).root.children.map(c => c.id)).toEqual([text!.id, heading!.id])
    await call('node_move_many', { componentId, moves: [{ nodeId: heading!.id, parentId: (await def()).root.id, index: 0 }] })
    expect((await def()).root.children.map(c => c.id)).toEqual([heading!.id, text!.id])

    const copy = await call<{ nodeId: string }>('node_duplicate', { componentId, nodeId: heading!.id })
    expect(shape((await def()).root)).toBe('Card(Heading,Heading,Text)')
    const wrapped = await call<{ nodeId: string }>('node_wrap', { componentId, nodeIds: [copy.nodeId, text!.id], type: 'Row' })
    expect(shape((await def()).root)).toBe('Card(Heading,Row(Heading,Text))')
    await call('node_delete', { componentId, nodeIds: [wrapped.nodeId, heading!.id] })
    expect(shape((await def()).root)).toBe('Card')
  })

  it('is undoable', async () => {
    const { call, componentId, def } = await setup()
    const before = await def()
    await call('node_insert', { componentId, type: 'Button' })
    await call('history_undo', {})
    expect(await def()).toEqual(before)
  })

  it('refuses the component root', async () => {
    const { call, componentId, def } = await setup()
    const rootId = (await def()).root.id
    await expect(call('node_delete', { componentId, nodeId: rootId })).rejects.toMatchObject({ code: 'forbidden', message: 'The component root cannot be removed' })
    const [heading] = (await def()).root.children
    await expect(call('node_delete', { componentId, nodeIds: [rootId, heading!.id] })).rejects.toMatchObject({ code: 'forbidden', message: 'The component root cannot be deleted' })
    await expect(call('node_wrap', { componentId, nodeId: rootId })).rejects.toMatchObject({ code: 'forbidden', message: 'The component root cannot be wrapped' })
  })

  it('needs exactly one of pageId and componentId', async () => {
    const { call, pageId, componentId } = await setup()
    await expect(call('node_insert', { type: 'Button' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('node_insert', { pageId, componentId, type: 'Button' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('node_insert', { componentId: 'cmp_missing', type: 'Button' })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('components_list', () => {
  it('keeps the built-ins and, given a projectId, lists the user components', async () => {
    const { bildr, call, componentId } = await setup()
    const plain = await bildr.call<Record<string, unknown>>('components_list', {}, ui)
    expect(plain).not.toHaveProperty('userComponents')
    const listed = await call<{ components: unknown[], userComponents: unknown[] }>('components_list', {})
    expect(listed.components).toEqual(plain.components)
    expect(listed.userComponents).toEqual([{ id: componentId, name: 'Card', properties: [], variants: [] }])
  })
})
