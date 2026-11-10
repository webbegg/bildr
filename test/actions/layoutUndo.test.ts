import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup() {
  const storage = memoryStorage()
  const bildr = createBildr(storage)
  const created = await bildr.call<Project>('project_create', { name: 'Site' }, mcp)
  const projectId = created.id
  const call = <T = Record<string, string>>(name: string, input: Record<string, unknown> = {}) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const doc = async () => {
    const { version: _v, updatedAt: _u, ...rest } = await call<Project>('project_get')
    return JSON.stringify(rest)
  }
  const raw = async () => JSON.stringify(await Promise.all((await storage.getKeys('')).sort().map(async k => [k, await storage.getItem(k)])))
  return { call, doc, raw, pageId: created.pages[0]!.id }
}

describe('layout edits and undo', () => {
  it('layout_delete detaches two pages with values and fills in one step; undo restores exactly', async () => {
    const { call, doc, pageId } = await setup()
    const { layoutId } = await call('layout_create', { name: 'Main' })
    const { nodeId: a } = await call('node_insert', { layoutId, type: 'Container' })
    const { nodeId: b } = await call('node_insert', { layoutId, type: 'Container' })
    const { slotId: sa } = await call('layout_slot_add', { layoutId, name: 'A', nodeId: a })
    const { slotId: sb } = await call('layout_slot_add', { layoutId, name: 'B', nodeId: b })
    const { variableId } = await call('layout_variable_add', { layoutId, name: 'T', kind: 'text' })
    const { pageId: p2 } = await call('page_add', { name: 'Two' })
    for (const pid of [pageId, p2]) {
      await call('node_insert', { pageId: pid, type: 'Text' })
      await call('page_set_layout', { pageId: pid, layoutId })
      const { fillId } = await call('page_set_slot', { pageId: pid, slot: sb, filled: true })
      await call('node_insert', { pageId: pid, parentId: fillId, type: 'Text' })
      await call('page_set_slot', { pageId: pid, slot: sa, filled: true })
      await call('page_set_layout_values', { pageId: pid, values: { [variableId]: 'v' } })
    }
    const before = await doc()
    const { detachedPages } = await call<{ detachedPages: string[] }>('layout_delete', { layoutId })
    expect(detachedPages).toEqual([pageId, p2])
    for (const page of (await call<Project>('project_get')).pages) {
      expect('layoutId' in page || 'layoutValues' in page).toBe(false)
      expect(page.root.children.some(c => c.type === 'SlotFill')).toBe(false)
    }
    await call('history_undo')
    expect(await doc()).toBe(before)
  })

  it('refuses nested and shared slot nodes, leaving storage byte-identical', async () => {
    const { call, raw } = await setup()
    const { layoutId } = await call('layout_create', { name: 'Main' })
    const { nodeId: foot } = await call('node_insert', { layoutId, type: 'Container' })
    const { nodeId: inner } = await call('node_insert', { layoutId, parentId: foot, type: 'Container' })
    const { nodeId: side } = await call('node_insert', { layoutId, type: 'Container' })
    await call('layout_slot_add', { layoutId, name: 'Footer', nodeId: foot })
    const before = await raw()
    await expect(call('layout_slot_add', { layoutId, name: 'Nested', nodeId: inner })).rejects.toThrow('Slot "Nested" of "Main" is inside slot "Footer"')
    await expect(call('layout_slot_add', { layoutId, name: 'Shared', nodeId: foot })).rejects.toThrow('Slots "Footer" and "Shared" of "Main" are bound to the same node')
    expect(await raw()).toBe(before)
    await call('layout_slot_add', { layoutId, name: 'Side', nodeId: side })
    const afterAdd = await raw()
    await expect(call('node_move', { layoutId, nodeId: side, parentId: foot, index: 0 })).rejects.toThrow('inside slot "Footer"')
    expect(await raw()).toBe(afterAdd)
  })

  it('component_delete lists and with force removes layout instances; undo restores', async () => {
    const { call, doc, pageId } = await setup()
    const { nodeId: box } = await call('node_insert', { pageId, type: 'Container' })
    const { componentId, nodeId: pageInst } = await call('component_create', { pageId, nodeId: box, name: 'Card' })
    const { layoutId } = await call('layout_create', { name: 'Main' })
    const { nodeId: inst } = await call('node_insert', { layoutId, type: 'Instance', props: { component: componentId } })
    await expect(call('component_delete', { componentId })).rejects.toThrow(`layout "Main" (${inst})`)
    const before = await doc()
    const { deletedInstances } = await call<{ deletedInstances: string[] }>('component_delete', { componentId, force: true })
    expect([...deletedInstances].sort()).toEqual([inst, pageInst].sort())
    await call('history_undo')
    expect(await doc()).toBe(before)
  })
})
