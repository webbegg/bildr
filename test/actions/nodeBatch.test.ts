import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { DocNode, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const ui = { caller: 'ui' as const, source: 'tab-1' }

const shape = (node: DocNode): string => (node.children.length ? `${node.type}(${node.children.map(shape).join(',')})` : node.type)

/** Page > [Heading, Button, Button, Button]; `ids` are the three Buttons. */
async function setup() {
  const bildr = createBildr(memoryStorage())
  const project = await bildr.call<Project>('project_create', { name: 'Batch' }, ui)
  const projectId = project.id
  const pageId = project.pages[0]!.id
  await bildr.call('node_insert', { projectId, pageId, type: 'Heading' }, ui)
  const ids: string[] = []
  for (let i = 0; i < 3; i++) ids.push((await bildr.call<{ nodeId: string }>('node_insert', { projectId, pageId, type: 'Button' }, ui)).nodeId)
  const root = async () => (await bildr.call<Project>('project_get', { projectId }, ui)).pages[0]!.root
  const history = () => bildr.call<{ undo: string | null }>('history_get', { projectId }, ui)
  return { bildr, projectId, pageId, ids, root, history }
}

describe('node_update_style with nodeIds', () => {
  it('applies one patch to every node as one undo step', async () => {
    const { bildr, projectId, pageId, ids, root } = await setup()
    const before = await root()
    await bildr.call('node_update_style', { projectId, pageId, nodeIds: ids, style: { mt: '6', bg: null } }, ui)

    const tree = await root()
    for (const id of ids) expect(tree.children.find(c => c.id === id)!.style.mt).toBe('6')
    expect(tree.children[0]!.style.mt).toBeUndefined()

    await bildr.call('history_undo', { projectId }, ui)
    expect(await root()).toEqual(before)
  })

  it('applies nothing when one node refuses the patch', async () => {
    const { bildr, projectId, pageId, ids, root } = await setup()
    const before = await root()
    await expect(bildr.call('node_update_style', { projectId, pageId, nodeIds: [...ids, 'missing'], style: { mt: '6' } }, ui)).rejects.toMatchObject({ code: 'not_found' })
    expect(await root()).toEqual(before)
    await expect(bildr.call('node_update_style', { projectId, pageId, style: { mt: '6' } }, ui)).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('node_delete with nodeIds', () => {
  it('deletes every node as one undo step, skipping nodes inside another deleted one', async () => {
    const { bildr, projectId, pageId, ids, root } = await setup()
    const { nodeId: card } = await bildr.call<{ nodeId: string }>('node_insert', { projectId, pageId, type: 'Card', children: [{ type: 'Text' }] }, ui)
    const before = await root()
    const inner = before.children.at(-1)!.children[0]!.id
    await bildr.call('node_delete', { projectId, pageId, nodeIds: [ids[0], inner, card, ids[2]] }, ui)
    expect(shape(await root())).toBe('Page(Heading,Button)')

    const undone = await bildr.call<{ label: string }>('history_undo', { projectId }, ui)
    expect(undone.label).toBe('Delete 3')
    expect(await root()).toEqual(before)
  })
})

describe('node_duplicate with nodeIds', () => {
  it('duplicates every node right after itself as one undo step', async () => {
    const { bildr, projectId, pageId, ids, root } = await setup()
    const before = await root()
    const result = await bildr.call<{ nodeId: string, nodeIds: string[] }>('node_duplicate', { projectId, pageId, nodeIds: [ids[2], ids[0]] }, ui)

    const tree = await root()
    expect(tree.children.map(c => c.id)).toEqual([before.children[0]!.id, ids[0], result.nodeIds[1], ids[1], ids[2], result.nodeIds[0]])
    expect(result.nodeId).toBe(result.nodeIds[0])

    await bildr.call('history_undo', { projectId }, ui)
    expect(await root()).toEqual(before)
  })
})

describe('node_move_many', () => {
  it('runs every move as one undo step', async () => {
    const { bildr, projectId, pageId, ids, root } = await setup()
    const before = await root()
    const rootId = before.id
    await bildr.call('node_move_many', {
      projectId,
      pageId,
      moves: [{ nodeId: ids[0], parentId: rootId, index: 0 }, { nodeId: ids[2], parentId: rootId, index: 2 }]
    }, ui)
    expect((await root()).children.map(c => c.id)).toEqual([ids[0], before.children[0]!.id, ids[2], ids[1]])

    const undone = await bildr.call<{ label: string }>('history_undo', { projectId }, ui)
    expect(undone.label).toBe('Move 2')
    expect(await root()).toEqual(before)
  })
})
