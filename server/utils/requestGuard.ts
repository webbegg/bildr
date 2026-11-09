export interface GuardedRequest {
  method: string
  contentType?: string
  origin?: string
  host?: string
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/**
 * Blocks cross-site writes to the unauthenticated local endpoints: a page on
 * another origin may not call them, and bodies must be JSON, which a plain
 * HTML form cannot send without a CORS preflight. Requests without an
 * `Origin` (curl, agents, MCP clients) pass.
 */
export function requestGuardProblem(request: GuardedRequest): { statusCode: number, statusMessage: string } | null {
  if (request.origin !== undefined && !sameHost(request.origin, request.host)) {
    return { statusCode: 403, statusMessage: 'Cross-origin requests are not allowed' }
  }
  const mediaType = request.contentType?.split(';')[0]?.trim().toLowerCase()
  if (BODY_METHODS.has(request.method.toUpperCase()) && mediaType !== 'application/json') {
    return { statusCode: 415, statusMessage: 'Use content-type: application/json' }
  }
  return null
}

function sameHost(origin: string, host: string | undefined): boolean {
  try {
    return host !== undefined && new URL(origin).host === host
  } catch {
    return false
  }
}
