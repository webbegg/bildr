import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { DocNode, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const ui = { caller: 'ui' as const, source: 'tab-1' }

/** The tree as `Type` / `Type(children)` text, so ids don't get in the way. */
const shape = (node: DocNode): string => (node.children.length ? `${node.type}(${node.children.map(shape).join(',')})` : node.type)

async function setup() {
  const bildr = createBildr(memoryStorage())
  const project = await bildr.call<Project>('project_create', { name: 'Wrap' }, ui)
  const projectId = project.id
  const pageId = project.pages[0]!.id
  const rootId = project.pages[0]!.root.id
  await bildr.call('node_insert', { projectId, pageId, type: 'Heading' }, ui)
  const { nodeId } = await bildr.call<{ nodeId: string }>('node_insert', { projectId, pageId, type: 'Text' }, ui)
  await bildr.call('node_insert', { projectId, pageId, type: 'Button' }, ui)
  const root = async () => (await bildr.call<Project>('project_get', { projectId }, ui)).pages[0]!.root
  return { bildr, projectId, pageId, rootId, nodeId, root }
}

describe('node_wrap', () => {
  it('wraps a node in a new Container at its position', async () => {
    const { bildr, projectId, pageId, nodeId, root } = await setup()
    const result = await bildr.call<{ nodeId: string }>('node_wrap', { projectId, pageId, nodeId }, ui)

    const tree = await root()
    expect(shape(tree)).toBe('Page(Heading,Container(Text),Button)')
    expect(tree.children[1]!.id).toBe(result.nodeId)
    expect(tree.children[1]!.children[0]!.id).toBe(nodeId)
  })

  it('wraps in the given container type', async () => {
    const { bildr, projectId, pageId, nodeId, root } = await setup()
    await bildr.call('node_wrap', { projectId, pageId, nodeId, type: 'Card' }, ui)
    expect(shape(await root())).toBe('Page(Heading,Card(Text),Button)')
    await expect(bildr.call('node_wrap', { projectId, pageId, nodeId, type: 'Text' }, ui)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('is one undo step that restores the original tree', async () => {
    const { bildr, projectId, pageId, nodeId, root } = await setup()
    const before = await root()
    await bildr.call('node_wrap', { projectId, pageId, nodeId, type: 'Row' }, ui)

    const undone = await bildr.call<{ label: string }>('history_undo', { projectId }, ui)
    expect(undone.label).toBe('Wrap in Row')
    expect(await root()).toEqual(before)
  })

  it('refuses the page root', async () => {
    const { bildr, projectId, pageId, rootId } = await setup()
    await expect(bildr.call('node_wrap', { projectId, pageId, nodeId: rootId }, ui)).rejects.toMatchObject({ code: 'forbidden' })
  })
})
