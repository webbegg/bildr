import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import { ActionError } from '../../server/actions/define'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const ui = { caller: 'ui' as const, source: 'tab-1' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const events: ChangeEvent[] = []
  bildr.onChange(e => events.push(e))
  const project = await bildr.call<Project>('project_create', { name: 'Demo' }, ui)
  const page = project.pages[0]!
  return { bildr, events, project, projectId: project.id, pageId: page.id, rootId: page.root.id }
}

async function rootChildren(bildr: ReturnType<typeof createBildr>, projectId: string) {
  const project = await bildr.call<Project>('project_get', { projectId }, ui)
  return project.pages[0]!.root.children
}

describe('action dispatcher', () => {
  it('rejects an invalid payload with zod issues', async () => {
    const { bildr } = await setup()
    const error = await bildr.call('project_create', { name: 42 }, ui).catch(e => e)
    expect(error).toBeInstanceOf(ActionError)
    expect(error.code).toBe('invalid_input')
    expect(error.issues.length).toBeGreaterThan(0)
  })

  it('rejects an unknown action', async () => {
    const { bildr } = await setup()
    await expect(bildr.call('nope', {}, ui)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('persists a mutation, bumps the version and emits a change event', async () => {
    const { bildr, events, projectId, pageId } = await setup()
    const result = await bildr.call<{ version: number, nodeId: string }>('node_insert', { projectId, pageId, type: 'Heading', props: { text: 'Hi' } }, ui)

    expect(result.version).toBe(1)
    const children = await rootChildren(bildr, projectId)
    expect(children[0]).toMatchObject({ id: result.nodeId, type: 'Heading', props: { text: 'Hi' } })
    expect(events.at(-1)).toEqual({ projectId, version: 1, source: 'tab-1', action: 'node_insert' })
  })

  it('read-only actions do not emit change events', async () => {
    const { bildr, events, projectId } = await setup()
    const count = events.length
    await bildr.call('project_get', { projectId }, ui)
    await bildr.call('components_list', {}, ui)
    expect(events.length).toBe(count)
  })

  it('inserts a nested subtree in one call', async () => {
    const { bildr, projectId, pageId } = await setup()
    await bildr.call('node_insert', {
      projectId, pageId, type: 'Row',
      children: [{ type: 'Button', props: { label: 'A' } }, { type: 'Button', props: { label: 'B' } }]
    }, ui)
    const [row] = await rootChildren(bildr, projectId)
    expect(row!.children.map(c => c.props.label)).toEqual(['A', 'B'])
  })

  it('maps document rule violations to action errors', async () => {
    const { bildr, projectId, pageId, rootId } = await setup()
    await expect(bildr.call('node_delete', { projectId, pageId, nodeId: rootId }, ui)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(bildr.call('node_insert', { projectId, pageId, type: 'Marquee' }, ui)).rejects.toMatchObject({ code: 'invalid' })
    await expect(bildr.call('project_get', { projectId: 'prj_missing' }, ui)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('duplicates a node right after the original with fresh ids', async () => {
    const { bildr, projectId, pageId } = await setup()
    const { nodeId } = await bildr.call<{ nodeId: string }>('node_insert', { projectId, pageId, type: 'Card', children: [{ type: 'Text' }] }, ui)
    const copy = await bildr.call<{ nodeId: string }>('node_duplicate', { projectId, pageId, nodeId }, ui)

    const children = await rootChildren(bildr, projectId)
    expect(children.map(c => c.id)).toEqual([nodeId, copy.nodeId])
    expect(children[1]!.children[0]!.id).not.toBe(children[0]!.children[0]!.id)
  })

  it('undoes and redoes, and a new edit clears the redo stack', async () => {
    const { bildr, projectId, pageId } = await setup()
    const { nodeId } = await bildr.call<{ nodeId: string }>('node_insert', { projectId, pageId, type: 'Text' }, ui)
    await bildr.call('node_update_props', { projectId, pageId, nodeId, props: { text: 'Edited' } }, ui)

    await bildr.call('history_undo', { projectId }, ui)
    expect((await rootChildren(bildr, projectId))[0]!.props.text).toBe('Some text')

    const redone = await bildr.call<{ version: number, label: string }>('history_redo', { projectId }, ui)
    expect(redone.label).toBe('Update props')
    expect((await rootChildren(bildr, projectId))[0]!.props.text).toBe('Edited')

    await bildr.call('history_undo', { projectId }, ui)
    await bildr.call('node_update_style', { projectId, pageId, nodeId, style: { color: 'red' } }, ui)
    await expect(bildr.call('history_redo', { projectId }, ui)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('serializes concurrent mutations on one project', async () => {
    const { bildr, projectId, pageId } = await setup()
    await Promise.all(Array.from({ length: 5 }, (_, i) =>
      bildr.call('node_insert', { projectId, pageId, type: 'Text', props: { text: `t${i}` } }, ui)
    ))
    const project = await bildr.call<Project>('project_get', { projectId }, ui)
    expect(project.pages[0]!.root.children).toHaveLength(5)
    expect(project.version).toBe(5)
  })

  it('manages pages', async () => {
    const { bildr, projectId, pageId } = await setup()
    const about = await bildr.call<{ pageId: string }>('page_add', { projectId, name: 'About us' }, ui)
    await bildr.call('page_rename', { projectId, pageId: about.pageId, name: 'Team' }, ui)
    let project = await bildr.call<Project>('project_get', { projectId }, ui)
    expect(project.pages.map(p => [p.name, p.slug])).toEqual([['Home', 'home'], ['Team', 'about-us']])

    await bildr.call('page_delete', { projectId, pageId }, ui)
    project = await bildr.call<Project>('project_get', { projectId }, ui)
    expect(project.pages.map(p => p.name)).toEqual(['Team'])
  })

  it('lists actions with JSON schemas for every surface', () => {
    const bildr = createBildr(memoryStorage())
    const listed = bildr.list()
    const insert = listed.find(a => a.name === 'node_insert')!
    expect(insert.inputSchema).toMatchObject({ type: 'object' })
    expect(listed.find(a => a.name === 'project_get')!.readOnly).toBe(true)
  })
})
