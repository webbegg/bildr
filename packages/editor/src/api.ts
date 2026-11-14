import { ref } from 'vue'
import type { ModelProblem } from './types.ts'

/** The error codes of the action contract, plus the ones the client adds for transport failures and the guard's 401. */
export type ActionErrorCode = 'invalid_input' | 'not_found' | 'invalid' | 'forbidden' | 'unavailable' | 'write_failed' | 'conflict' | 'network' | 'bad_response' | 'unauthorized' | (string & {})

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

/**
 * What the module's event stream sends (`/__bildr/api/events`, P3b): `ready` with the
 * current model version on (re)connect, `model` for every model change (its files and
 * who made it), `regenerated` after the app regenerated, `navigate` and `context`.
 * `version` is the client's own: polling found that the version moved.
 */
export type BildrEvent
  = | { type: 'ready', version: number }
    | { type: 'model', version: number, files: string[], source: 'action' | 'undo' | 'redo' | 'disk' }
    | { type: 'regenerated', version: number, ok: boolean, problems?: ModelProblem[], error?: string }
    | { type: 'navigate', target: { file: string, kind: 'page' | 'component' | 'layout', nodeId: string | null, variant: string | null } }
    | { type: 'context', context: { file: string, nodeId: string | null, variant: string | null, updatedAt: string } }
    | { type: 'version', version: number }

export interface SubscribeOptions {
  /** Poll `/__bildr/api/version` while the stream is down. Default true. */
  poll?: boolean
  pollMs?: number
  /** First wait before opening a stream the browser gave up on again; doubles up to 30 s. */
  retryMs?: number
}

const EVENTS = '/__bildr/api/events'
const VERSION = '/__bildr/api/version'
const MAX_RETRY_MS = 30_000

/**
 * Follows the module's events. The browser's EventSource sends the session cookie and
 * reconnects by itself after a dropped connection; when it gives up (closed), this
 * opens a new one later and, meanwhile, polls the version (reporting a `version`
 * event when it moved). A 401 ends the session and everything stops. Returns the
 * unsubscribe.
 */
export const subscribeEvents = (onEvent: (event: BildrEvent) => void, options: SubscribeOptions = {}): (() => void) => {
  const { poll = true, pollMs = 2000, retryMs = 2000 } = options
  let stopped = false
  let source: EventSource | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let polling = false
  let retryDelay = retryMs
  let version: number | undefined

  const stop = () => {
    stopped = true
    source?.close()
    clearTimeout(pollTimer)
    clearTimeout(retryTimer)
    polling = false
  }
  const moved = (next: number) => {
    const known = version
    version = next
    return known !== undefined && known !== next
  }
  const pollOnce = async () => {
    if (stopped || !polling) return
    try {
      const response = await fetch(VERSION, { credentials: 'same-origin' })
      if (response.status === 401) {
        sessionEnded.value = true
        return stop()
      }
      const body = await response.json() as { version?: unknown }
      if (!stopped && polling && typeof body.version === 'number' && moved(body.version)) onEvent({ type: 'version', version: body.version })
    } catch {
      // The dev server is restarting or gone: try again on the next tick.
    }
    if (!stopped && polling) pollTimer = setTimeout(() => void pollOnce(), pollMs)
  }
  const startPolling = () => {
    if (!poll || polling || stopped) return
    polling = true
    pollTimer = setTimeout(() => void pollOnce(), pollMs)
  }
  const stopPolling = () => {
    polling = false
    clearTimeout(pollTimer)
  }
  const connect = () => {
    if (stopped || sessionEnded.value) return stop()
    const opened = new EventSource(EVENTS)
    source = opened
    opened.onopen = () => {
      retryDelay = retryMs
      stopPolling()
    }
    opened.onmessage = (message: MessageEvent<string>) => {
      if (stopped) return
      let event: BildrEvent
      try {
        event = JSON.parse(message.data) as BildrEvent
      } catch {
        return
      }
      // A reconnect after missed changes: the version moved while the stream was down.
      if (event.type === 'ready' && moved(event.version)) onEvent({ type: 'version', version: event.version })
      else if ('version' in event && typeof event.version === 'number') version = event.version
      onEvent(event)
    }
    opened.onerror = () => {
      if (stopped || opened.readyState !== EventSource.CLOSED) return
      startPolling()
      retryTimer = setTimeout(connect, retryDelay)
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS)
    }
  }

  if (typeof EventSource === 'undefined') startPolling()
  else connect()
  return stop
}

/** A user-facing message for any thrown value. */
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
