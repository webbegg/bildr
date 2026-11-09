import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent, NavigateEvent } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const ui = { caller: 'ui' as const, source: 'tab-1' }
const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const changes: ChangeEvent[] = []
  const navigations: NavigateEvent[] = []
  bildr.onChange(e => changes.push(e))
  bildr.onNavigate(e => navigations.push(e))
  const project = await bildr.call<Project>('project_create', { name: 'Demo' }, ui)
  const projectId = project.id
  const pageId = project.pages[0]!.id
  const { nodeId } = await bildr.call<{ nodeId: string }>('node_insert', { projectId, pageId, type: 'Heading', props: { text: 'Welcome' } }, ui)
  return { bildr, changes, navigations, projectId, pageId, nodeId }
}

describe('editor context', () => {
  it('is null until an editor reports', async () => {
    const { bildr, projectId } = await setup()
    expect(await bildr.call('editor_get_context', { projectId }, mcp)).toBeNull()
  })

  it('round-trips the page and selection the editor reports, with an outline', async () => {
    const { bildr, changes, projectId, pageId, nodeId } = await setup()
    const count = changes.length
    await bildr.call('editor_set_context', { projectId, pageId, selectedId: nodeId }, ui)
    expect(changes.length).toBe(count)

    const context = await bildr.call<Record<string, unknown>>('editor_get_context', { projectId }, mcp)
    expect(context).toMatchObject({
      pageId,
      selectedId: nodeId,
      page: { id: pageId, name: 'Home', slug: 'home' },
      selected: { id: nodeId, type: 'Heading', props: { text: 'Welcome' } }
    })
    expect(context.outline).toContain('Page "Home" (/home)')
    expect(context.outline).toContain('Welcome')
    expect(typeof context.updatedAt).toBe('string')
  })

  it('hides editor_set_context from agents', async () => {
    const { bildr, projectId, pageId } = await setup()
    await expect(bildr.call('editor_set_context', { projectId, pageId, selectedId: null }, mcp)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('editor_navigate', () => {
  it('emits a navigate event without bumping the version or the undo history', async () => {
    const { bildr, changes, navigations, projectId, pageId, nodeId } = await setup()
    const before = await bildr.call<Project>('project_get', { projectId }, ui)
    const count = changes.length

    await bildr.call('editor_navigate', { projectId, pageId, nodeId }, mcp)

    expect(navigations).toEqual([{ projectId, pageId, nodeId, source: 'mcp' }])
    expect(changes.length).toBe(count)
    expect((await bildr.call<Project>('project_get', { projectId }, ui)).version).toBe(before.version)
    expect(await bildr.call('history_get', { projectId }, ui)).toEqual({ undo: 'Insert Heading', redo: null })
  })

  it('validates the page and node ids', async () => {
    const { bildr, navigations, projectId, pageId } = await setup()
    await expect(bildr.call('editor_navigate', { projectId, pageId: 'pg_missing' }, mcp)).rejects.toMatchObject({ code: 'not_found' })
    await expect(bildr.call('editor_navigate', { projectId, pageId, nodeId: 'nd_missing' }, mcp)).rejects.toMatchObject({ code: 'not_found' })
    expect(navigations).toEqual([])
  })
})
