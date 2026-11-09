import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer } from '../mcp/server'

/**
 * MCP over Streamable HTTP, stateless: a fresh server and transport per
 * request. Unauthenticated, so local development only.
 */
export default defineEventHandler(async (event) => {
  guardRequest(event)
  const server = createMcpServer(useBildr())
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(toWebRequest(event))
  } finally {
    await server.close()
  }
})
