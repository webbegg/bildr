import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const get = () => call<Project>('project_get', {})
  const { nodeId: a } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Text' })
  const { nodeId: b } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Text' })
  const node = async (id: string) => (await get()).pages[0]!.root.children.find(c => c.id === id)!
  return { bildr, projectId, pageId, call, get, node, a, b, root: created.pages[0]!.root.id }
}

describe('node_rename (S4a)', () => {
  it('sets a layer name as one undo step, and undo restores the type name', async () => {
    const { call, pageId, a, node } = await setup()
    await call('node_rename', { pageId, nodeId: a, name: '  Hero title ' })
    expect((await node(a)).name).toBe('Hero title')
    expect((await call<{ undo: string | null }>('history_get', {})).undo).toBe('Rename layer')
    await call('history_undo', {})
    expect('name' in (await node(a))).toBe(false)
  })

  it('clears the name with null or an empty string', async () => {
    const { call, pageId, a, node } = await setup()
    await call('node_rename', { pageId, nodeId: a, name: 'Title' })
    await call('node_rename', { pageId, nodeId: a, name: '' })
    expect('name' in (await node(a))).toBe(false)
    await call('node_rename', { pageId, nodeId: a, name: 'Title' })
    await call('node_rename', { pageId, nodeId: a, name: null })
    expect('name' in (await node(a))).toBe(false)
  })

  it('renames the root too, and refuses a missing node', async () => {
    const { call, get, pageId, root } = await setup()
    await call('node_rename', { pageId, nodeId: root, name: 'Home page' })
    expect((await get()).pages[0]!.root.name).toBe('Home page')
    await expect(call('node_rename', { pageId, nodeId: 'ghost', name: 'X' })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('node_set_locked (S4a)', () => {
  it('locks several nodes as one undo step; unlocking removes the flag', async () => {
    const { call, pageId, a, b, node } = await setup()
    await call('node_set_locked', { pageId, nodeIds: [a, b], locked: true })
    expect((await node(a)).locked).toBe(true)
    expect((await node(b)).locked).toBe(true)
    expect((await call<{ undo: string | null }>('history_get', {})).undo).toBe('Lock 2')
    await call('history_undo', {})
    expect('locked' in (await node(a))).toBe(false)
    expect('locked' in (await node(b))).toBe(false)

    await call('node_set_locked', { pageId, nodeId: a, locked: true })
    await call('node_set_locked', { pageId, nodeId: a, locked: false })
    expect('locked' in (await node(a))).toBe(false)
    expect((await call<{ undo: string | null }>('history_get', {})).undo).toBe('Unlock')
  })

  it('keeps a locked node editable by actions (the lock is a canvas rule)', async () => {
    const { call, pageId, a, node } = await setup()
    await call('node_set_locked', { pageId, nodeId: a, locked: true })
    await call('node_update_style', { pageId, nodeId: a, style: { mt: '4' } })
    expect((await node(a)).style.mt).toBe('4')
  })
})
