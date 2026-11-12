import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createBildr } from '../../server/actions/runtime'
import { createMcpServer } from '../../server/mcp/server'
import { memoryStorage } from '../helpers'

/** `tools/list` was 289,317 bytes at `be18bff` (before S37); S38.2 allows about 5% above it. */
const TOOLS_LIST_BUDGET = Math.round(289_317 * 1.05)

/** The style tools, which listed every prefixed key of both bases in S37. */
const STYLE_TOOLS = ['node_insert', 'node_update_style', 'node_wrap']
const STYLE_TOOL_BUDGET = 40_000

async function listTools() {
  const client = new Client({ name: 'size-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createMcpServer(createBildr(memoryStorage())).connect(serverTransport)
  await client.connect(clientTransport)
  return (await client.listTools()).tools
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')

describe('tools/list size (S38.2)', () => {
  it('stays within about 5% of the pre-S37 size', async () => {
    const tools = await listTools()
    expect(bytes({ tools })).toBeLessThanOrEqual(TOOLS_LIST_BUDGET)
  })

  it.each(STYLE_TOOLS)('keeps the %s schema compact', async (name) => {
    const tool = (await listTools()).find(t => t.name === name)!
    expect(bytes(tool)).toBeLessThanOrEqual(STYLE_TOOL_BUDGET)
  })
})
