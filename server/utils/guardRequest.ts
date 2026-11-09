import type { H3Event } from 'h3'
import { requestGuardProblem } from './requestGuard'

/** Throws the `requestGuardProblem` verdict for this request, if any. */
export function guardRequest(event: H3Event): void {
  const problem = requestGuardProblem({
    method: event.method,
    contentType: getHeader(event, 'content-type'),
    origin: getHeader(event, 'origin'),
    host: getHeader(event, 'host')
  })
  if (problem) throw createError(problem)
}
