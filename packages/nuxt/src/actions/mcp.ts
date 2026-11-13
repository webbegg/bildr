import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { ActionError } from './define.ts'
import type { Actions } from './runtime.ts'

const textResult = (value: unknown, isError = false): CallToolResult =>
  ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2) }], isError })

/** The MCP surface: one tool per action, with the action's JSON schema as input, called through the dispatcher. */
export const createMcpServer = (actions: Actions): Server => {
  const server = new Server({ name: 'bildr', version: '0.1.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: actions.list().map((action): Tool => ({
      name: action.name,
      description: action.description,
      inputSchema: action.inputSchema as Tool['inputSchema'],
      annotations: { readOnlyHint: action.readOnly }
    }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      return textResult(await actions.call(params.name, params.arguments ?? {}))
    } catch (error) {
      if (!(error instanceof ActionError)) throw error
      const problems = error.problems?.length ? `\n\nProblems: ${JSON.stringify(error.problems)}` : ''
      return textResult(`${error.code}: ${error.message}${problems}`, true)
    }
  })

  return server
}

/** MCP over Streamable HTTP, stateless: a fresh server and transport per request. The caller guards the request. */
export const handleMcp = async (actions: Actions, request: Request, maxBody: number): Promise<Response> => {
  const server = createMcpServer(actions)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: maxBody })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}
