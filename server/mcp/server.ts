import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { ActionError } from '../actions/define'
import type { Bildr } from '../actions/runtime'

function textResult(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2) }], isError }
}

/**
 * The MCP surface: one tool per agent-visible action, with the action's JSON
 * schema as input. Calls go through the dispatcher like every other surface.
 */
export function createMcpServer(bildr: Bildr): Server {
  const server = new Server({ name: 'bildr', version: '0.1.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: bildr.list().filter(a => !a.uiOnly).map((a): Tool => ({
      name: a.name,
      description: a.description,
      inputSchema: a.inputSchema as Tool['inputSchema'],
      annotations: { readOnlyHint: a.readOnly }
    }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      return textResult(await bildr.call(params.name, params.arguments ?? {}, { caller: 'mcp', source: 'mcp' }))
    } catch (error) {
      if (!(error instanceof ActionError)) throw error
      const issues = error.issues.length ? `\n\nIssues: ${JSON.stringify(error.issues)}` : ''
      return textResult(`${error.code}: ${error.message}${issues}`, true)
    }
  })

  return server
}
