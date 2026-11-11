import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import { createMcpServer } from '../../server/mcp/server'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

/** Actions the UI calls that agents deliberately cannot, and why. */
const UI_ONLY: Record<string, string> = {
  editor_set_context: 'the editor reports its own page and selection; agents read it with editor_get_context'
}

const COMPONENT_ACTIONS = [
  'component_create',
  'component_rename',
  'component_delete',
  'component_duplicate',
  'component_property_add',
  'component_property_update',
  'component_property_remove',
  'component_variant_add',
  'component_variant_delete',
  'component_variant_rename',
  'component_variant_set_override',
  'instance_set_values',
  'instance_set_slot',
  'instance_detach',
  'instance_replace'
]

const LAYOUT_ACTIONS = [
  'layout_create',
  'layout_rename',
  'layout_duplicate',
  'layout_delete',
  'layout_slot_add',
  'layout_slot_update',
  'layout_slot_remove',
  'layout_variable_add',
  'layout_variable_update',
  'layout_variable_remove',
  'page_set_layout',
  'page_set_layout_values',
  'page_set_slot'
]

async function connect() {
  const bildr = createBildr(memoryStorage())
  const client = new Client({ name: 'parity-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createMcpServer(bildr).connect(serverTransport)
  await client.connect(clientTransport)
  return { bildr, client }
}

function actionsCalledByUi(): Set<string> {
  const root = fileURLToPath(new URL('../../app', import.meta.url))
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(f => /\.(vue|ts)$/.test(f))
  const pattern = /\b(?:run|runOnPage|runData|callAction)(?:<[^()]*?>)?\(\s*'([a-z_]+)'/g
  const names = new Set<string>()
  for (const file of files) {
    for (const match of readFileSync(join(root, file), 'utf8').matchAll(pattern)) names.add(match[1]!)
  }
  return names
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string, text: string }[])[0]!.text
}

describe('MCP parity', () => {
  it('lists every non-UI-only action as a tool', async () => {
    const { bildr, client } = await connect()
    const { tools } = await client.listTools()
    const expected = bildr.list().filter(a => !a.uiOnly)
    expect(tools.map(t => t.name).sort()).toEqual(expected.map(a => a.name).sort())
    const get = tools.find(t => t.name === 'project_get')!
    expect(get.annotations?.readOnlyHint).toBe(true)
    expect(get.inputSchema).toMatchObject({ type: 'object', required: ['projectId'] })
    expect(tools.find(t => t.name === 'node_insert')!.annotations?.readOnlyHint).toBe(false)
  })

  it('exposes the component actions as tools, over HTTP\'s action list too', async () => {
    const { bildr, client } = await connect()
    const tools = new Set((await client.listTools()).tools.map(t => t.name))
    const listed = new Set(bildr.list().map(a => a.name))
    for (const name of COMPONENT_ACTIONS) {
      expect(tools, `${name} is missing from MCP`).toContain(name)
      expect(listed, `${name} is missing from /api/actions`).toContain(name)
    }
  })

  it('exposes the layout actions as tools, over HTTP\'s action list too', async () => {
    const { bildr, client } = await connect()
    const tools = new Set((await client.listTools()).tools.map(t => t.name))
    const listed = new Set(bildr.list().map(a => a.name))
    for (const name of LAYOUT_ACTIONS) {
      expect(tools, `${name} is missing from MCP`).toContain(name)
      expect(listed, `${name} is missing from /api/actions`).toContain(name)
    }
  })

  it('runs layout actions through MCP like any other caller', async () => {
    const { client } = await connect()
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      return { result, data: result.isError ? null : JSON.parse(text(result)) as Record<string, unknown> }
    }
    const project = (await call('project_create', { name: 'Agent made' })).data as unknown as Project
    const projectId = project.id
    const pageId = project.pages[0]!.id
    const { layoutId } = (await call('layout_create', { projectId, name: 'Main' })).data as { layoutId: string }
    expect((await call('node_insert', { projectId, layoutId, type: 'Heading' })).result.isError).toBeFalsy()
    expect((await call('page_set_layout', { projectId, pageId, layoutId })).result.isError).toBeFalsy()
    const deleted = await call('layout_delete', { projectId, layoutId })
    expect(deleted.data).toMatchObject({ detachedPages: [pageId] })
    const refused = await call('page_set_layout', { projectId, pageId, layoutId })
    expect(refused.result.isError).toBe(true)
    expect(text(refused.result)).toContain(`uses the unknown layout "${layoutId}"`)
  })

  it('runs a component action through MCP like any other caller', async () => {
    const { client } = await connect()
    const project = JSON.parse(text(await client.callTool({ name: 'project_create', arguments: { name: 'Agent made' } }))) as Project
    const pageId = project.pages[0]!.id
    const { nodeId } = JSON.parse(text(await client.callTool({ name: 'node_insert', arguments: { projectId: project.id, pageId, type: 'Card' } }))) as { nodeId: string }
    const created = await client.callTool({ name: 'component_create', arguments: { projectId: project.id, pageId, nodeId, name: 'Card' } })
    expect(created.isError).toBeFalsy()
    const { componentId } = JSON.parse(text(created)) as { componentId: string }
    const refused = await client.callTool({ name: 'component_delete', arguments: { projectId: project.id, componentId } })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('forbidden: "Card" is used by 1 instance')
  })

  it('exposes every action the UI calls, except the listed UI-only ones', async () => {
    const { bildr, client } = await connect()
    const tools = new Set((await client.listTools()).tools.map(t => t.name))
    const uiOnly = new Set(bildr.list().filter(a => a.uiOnly).map(a => a.name))
    const called = actionsCalledByUi()

    expect(called).toContain('node_insert')
    expect(called).toContain('editor_set_context')
    expect(called).toContain('record_create')
    expect(called).toContain('field_add')
    for (const name of called) {
      if (name in UI_ONLY) expect(uiOnly, `${name} should be uiOnly`).toContain(name)
      else expect(tools, `UI action ${name} is missing from MCP`).toContain(name)
    }
    expect([...uiOnly].sort()).toEqual(Object.keys(UI_ONLY).sort())
  })

  it('runs tools through the dispatcher and reports failures as tool errors', async () => {
    const { bildr, client } = await connect()
    const events: ChangeEvent[] = []
    bildr.onChange(e => events.push(e))

    const project = JSON.parse(text(await client.callTool({ name: 'project_create', arguments: { name: 'Agent made' } }))) as Project
    const inserted = await client.callTool({
      name: 'node_insert',
      arguments: { projectId: project.id, pageId: project.pages[0]!.id, type: 'Heading', props: { text: 'From MCP' } }
    })
    expect(inserted.isError).toBeFalsy()
    expect(JSON.parse(text(inserted))).toMatchObject({ version: 1 })
    expect(events.at(-1)).toEqual({ projectId: project.id, version: 1, action: 'node_insert', source: 'mcp' })

    const invalid = await client.callTool({ name: 'node_insert', arguments: { projectId: project.id } })
    expect(invalid.isError).toBe(true)
    expect(text(invalid)).toContain('pageId')

    const hidden = await client.callTool({ name: 'editor_set_context', arguments: { projectId: project.id, pageId: project.pages[0]!.id, selectedId: null } })
    expect(hidden.isError).toBe(true)
  })
})
