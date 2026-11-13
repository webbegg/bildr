import { ref } from 'vue'
import type { ModelProblem } from './types.ts'

/** The error codes of the action contract, plus the ones the client adds for transport failures and the guard's 401. */
export type ActionErrorCode = 'invalid_input' | 'not_found' | 'invalid' | 'forbidden' | 'unavailable' | 'network' | 'bad_response' | 'unauthorized' | (string & {})

/**
 * Set once any call gets the guard's 401 (missing or wrong session token, e.g.
 * the cookie is gone). The shell then shows one notice instead of per-call
 * errors, and polling stops: no later call can succeed from this page.
 */
export const sessionEnded = ref(false)

/** A failed action: the `{ok:false, code, message, problems?}` body, or a transport failure. */
export class ActionCallError extends Error {
  readonly code: ActionErrorCode
  readonly problems?: ModelProblem[]

  constructor(code: ActionErrorCode, message: string, problems?: ModelProblem[]) {
    super(message)
    this.name = 'ActionCallError'
    this.code = code
    if (problems) this.problems = problems
  }
}

const ENDPOINT = '/__bildr/api/actions/'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Runs one registry action over HTTP. The session token travels in the
 * HttpOnly cookie the shell set, so no token is handled here.
 */
export const callAction = async <T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T> => {
  let response: Response
  try {
    response = await fetch(ENDPOINT + name, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    })
  } catch (error) {
    throw new ActionCallError('network', `Could not reach the bildr module: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (response.status === 401) {
    sessionEnded.value = true
    throw new ActionCallError('unauthorized', 'This editor session ended. Open the editor again from the link in the nuxt dev log.')
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ActionCallError('bad_response', `Unexpected response from ${name} (HTTP ${response.status})`)
  }
  if (!isRecord(body)) throw new ActionCallError('bad_response', `Unexpected response from ${name} (HTTP ${response.status})`)

  if (body.ok === true && response.ok) return body.result as T
  const code = typeof body.code === 'string' ? body.code : 'bad_response'
  const message = typeof body.message === 'string' ? body.message : `${name} failed (HTTP ${response.status})`
  const problems = Array.isArray(body.problems) ? body.problems as ModelProblem[] : undefined
  throw new ActionCallError(code, message, problems)
}

/** A user-facing message for any thrown value. */
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
