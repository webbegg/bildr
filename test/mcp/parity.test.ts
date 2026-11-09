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
  const pattern = /\b(?:run|runOnPage|callAction)(?:<[^()]*?>)?\(\s*'([a-z_]+)'/g
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

  it('exposes every action the UI calls, except the listed UI-only ones', async () => {
    const { bildr, client } = await connect()
    const tools = new Set((await client.listTools()).tools.map(t => t.name))
    const uiOnly = new Set(bildr.list().filter(a => a.uiOnly).map(a => a.name))
    const called = actionsCalledByUi()

    expect(called).toContain('node_insert')
    expect(called).toContain('editor_set_context')
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
