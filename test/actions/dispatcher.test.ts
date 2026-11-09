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

  it('sets a Button icon and rejects one that is not an i-lucide-* name', async () => {
    const { bildr, projectId, pageId } = await setup()
    await bildr.call('node_insert', { projectId, pageId, type: 'Button', props: { icon: 'i-lucide-coffee' } }, ui)
    const [button] = await rootChildren(bildr, projectId)
    expect(button!.props.icon).toBe('i-lucide-coffee')
    await expect(bildr.call('node_update_props', { projectId, pageId, nodeId: button!.id, props: { icon: 'coffee' } }, ui))
      .rejects.toMatchObject({ code: 'invalid' })
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
    await bildr.call('node_update_style', { projectId, pageId, nodeId, style: { color: 'error' } }, ui)
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

  it('styles nodes with design tokens, nested children included', async () => {
    const { bildr, projectId, pageId } = await setup()
    const { nodeId } = await bildr.call<{ nodeId: string }>('node_insert', {
      projectId, pageId, type: 'Card', style: { bg: 'primary', p: '8' },
      children: [{ type: 'Text', style: { color: 'error', mt: '10' } }]
    }, ui)
    await bildr.call('node_update_style', { projectId, pageId, nodeId, style: { rounded: 'xl', p: null } }, ui)

    const [card] = await rootChildren(bildr, projectId)
    expect(card!.style).toEqual({ gap: '3', items: 'start', bg: 'primary', rounded: 'xl' })
    expect(card!.children[0]!.style).toEqual({ color: 'error', mt: '10' })
  })

  it('styles nodes with breakpoint-prefixed tokens', async () => {
    const { bildr, projectId, pageId } = await setup()
    const { nodeId } = await bildr.call<{ nodeId: string }>('node_insert', {
      projectId, pageId, type: 'Grid', style: { 'cols': '1', 'md:cols': '3' },
      children: [{ type: 'Card', style: { 'lg:colSpan': '2' } }]
    }, ui)
    await bildr.call('node_update_style', { projectId, pageId, nodeId, style: { 'lg:cols': '4', 'md:gap': '8' } }, ui)

    const [grid] = await rootChildren(bildr, projectId)
    expect(grid!.style).toEqual({ 'cols': '1', 'gap': '6', 'md:cols': '3', 'lg:cols': '4', 'md:gap': '8' })
    expect(grid!.children[0]!.style).toMatchObject({ 'lg:colSpan': '2' })
  })

  it('rejects unknown style keys and values with zod issues', async () => {
    const { bildr, projectId, pageId, rootId } = await setup()
    const bad = [
      bildr.call('node_update_style', { projectId, pageId, nodeId: rootId, style: { mt: '13' } }, ui),
      bildr.call('node_update_style', { projectId, pageId, nodeId: rootId, style: { padding: '16px' } }, ui),
      bildr.call('node_insert', { projectId, pageId, type: 'Text', style: { bg: '#f00' } }, ui),
      bildr.call('node_insert', { projectId, pageId, type: 'Row', children: [{ type: 'Text', style: { mt: '13' } }] }, ui),
      bildr.call('node_update_style', { projectId, pageId, nodeId: rootId, style: { 'xl:gap': '4' } }, ui),
      bildr.call('node_update_style', { projectId, pageId, nodeId: rootId, style: { 'md:gap': '7' } }, ui),
      bildr.call('node_insert', { projectId, pageId, type: 'Grid', style: { 'md:cols': '7' } }, ui)
    ]
    for (const call of bad) await expect(call).rejects.toMatchObject({ code: 'invalid_input', issues: expect.arrayContaining([expect.anything()]) })
  })

  it('describes style tokens as enums in the action schemas and in components_list', async () => {
    const bildr = createBildr(memoryStorage())
    const listed = bildr.list()
    interface JsonSchema { properties: Record<string, JsonSchema>, additionalProperties?: boolean, enum?: string[], anyOf?: JsonSchema[] }
    const schema = (name: string) => listed.find(a => a.name === name)!.inputSchema as unknown as JsonSchema
    const updateStyle = schema('node_update_style').properties.style!
    expect(updateStyle.additionalProperties).toBe(false)
    expect(updateStyle.properties.mt!.anyOf![0]!.enum).toEqual(['0', '0.5', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24', '32', 'auto'])
    expect(schema('node_insert').properties.style!.properties.bg!.enum).toContain('primary-500')
    expect(schema('node_insert').properties.style!.properties['md:cols']!.enum).toEqual(['1', '2', '3', '4', '5', '6', '12'])
    expect(updateStyle.properties['lg:mt']!.anyOf![0]!.enum).toContain('auto')
    expect(updateStyle.properties['md:bg']).toBeUndefined()

    const { tokens } = await bildr.call<{ tokens: { key: string, group: string, values: string[] }[] }>('components_list', {}, ui)
    expect(tokens.find(t => t.key === 'mt')).toMatchObject({ group: 'Spacing', values: expect.arrayContaining(['10']), breakpoints: ['sm', 'md', 'lg'] })
    expect(tokens.find(t => t.key === 'bg')).toMatchObject({ breakpoints: [] })
  })
})
