import type { ApiSource } from '@bildr/codegen/edit'
import { looksSecret } from '../shared/requestPaste.ts'
import { pathParamNames } from '../shared/simpleApi.ts'
import { paramsOutput, tryHeaders, tryParams } from './simpleApiDraft.ts'
import type { OperationDraft } from './simpleApiDraft.ts'

/**
 * Try it's request and answer (api-calls T1, S5).
 *
 * `resolvedRequest` is the request as `api_try` will send it, worked out in the editor before it is: the method, the base URL with the
 * path filled in (a path parameter with no value stays `:name`, and is said to be missing) and the query by each parameter's key, the
 * headers, and the body. The sign-in is never known here: its header shows `••••`. The base URL is the model's; an env var that overrides
 * it shows in the answer's URL, which is the one that was sent.
 *
 * The values to try an operation with are kept in this browser (`localStorage`), per API and operation, never in the project: a value of a
 * parameter that looks like a secret (`apiKey`, `access_token`), and a body that holds one, is never kept.
 */

const MASK = '••••'

export interface RequestHeader {
  name: string
  value: string
  /** The sign-in: its value is never shown. */
  masked?: true
}

export interface ResolvedRequest {
  method: string
  url: string
  headers: RequestHeader[]
  /** What an action sends, as typed; none when it sends nothing. */
  body?: string
  /** The path parameters with no value yet. */
  missing: string[]
  /** Whether the sign-in is sent: `browser` for an API the visitor's browser calls (it has no secret there). */
  signIn: 'sent' | 'none' | 'browser'
}

type Source = Pick<ApiSource, 'baseUrl' | 'runtime' | 'auth'>

export function resolvedRequest(source: Source, draft: OperationDraft, values: Record<string, string | boolean>, body: string): ResolvedRequest {
  const method = draft.kind === 'query' ? 'GET' : draft.method
  const sent = tryParams(draft, values)
  const [pathname = '', search = ''] = draft.path.trim().split(/\?(.*)/s, 2)
  const inPath = pathParamNames(pathname)
  const missing: string[] = []
  let filled = pathname
  for (const name of inPath) {
    const value = Object.hasOwn(sent, name) ? sent[name] : undefined
    if (value === undefined) missing.push(name)
    else filled = filled.replace(new RegExp(`(?<=/):${name}(?![A-Za-z0-9])`), () => encodeURIComponent(String(value)))
  }
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(sent)) if (!inPath.includes(key)) query.set(key, String(value))
  const tail = query.toString()
  const url = `${source.baseUrl.trim().replace(/\/+$/, '')}${filled}${tail ? `${search ? `?${search}&` : '?'}${tail}` : search ? `?${search}` : ''}`
  const sends = draft.kind === 'action' && draft.method !== 'DELETE' && body.trim() !== ''
  // The call's own headers (api-calls R2): its accept is sent instead of the JSON one; the sign-in comes last, over them.
  const own = Object.entries(tryHeaders(draft, values)).map(([name, value]): RequestHeader => ({ name, value }))
  const accept = own.find(header => header.name.toLowerCase() === 'accept')
  const headers: RequestHeader[] = [accept ?? { name: 'Accept', value: 'application/json' }]
  if (sends) headers.push({ name: 'Content-Type', value: 'application/json' })
  headers.push(...own.filter(header => header !== accept))
  const signIn = !source.auth ? 'none' : source.runtime === 'browser' ? 'browser' : 'sent'
  if (signIn === 'sent' && source.auth) {
    headers.push(source.auth.type === 'bearer' ? { name: 'Authorization', value: `Bearer ${MASK}`, masked: true } : { name: source.auth.header ?? 'X-Api-Key', value: MASK, masked: true })
  }
  return { method, url, headers, ...(sends ? { body: body.trim() } : {}), missing, signIn }
}

// ── The answer in words ──────────────────────────────────────────────────

const decimal = (value: number) => value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)

/** `1234` → `1.2 KB`. */
export const sizeLabel = (bytes: number): string => bytes < 1000 ? `${bytes} B` : bytes < 1_000_000 ? `${decimal(bytes / 1000)} KB` : `${decimal(bytes / 1_000_000)} MB`

/** `87` → `87 ms`, `1500` → `1.5 s`. */
export const durationLabel = (ms: number): string => ms < 1000 ? `${Math.round(ms)} ms` : `${decimal(ms / 1000)} s`

// ── The values to try with ───────────────────────────────────────────────

const PREFIX = 'bildr:try:'

export interface TryKey {
  datasource: string
  kind: 'query' | 'action'
  name: string
}

export interface TryValues {
  values: Record<string, string | boolean>
  body: string
}

const storageKey = ({ datasource, kind, name }: TryKey) => `${PREFIX}${datasource}:${kind}:${name}`
const storage = (): Storage | null => typeof localStorage === 'undefined' ? null : localStorage

/** Whether a JSON text holds a key that looks like a secret, at any depth; text that is not JSON is judged by its words. */
function holdsSecret(text: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return /password|secret|token|api[_-]?key/i.test(text)
  }
  const walk = (value: unknown): boolean => Array.isArray(value)
    ? value.some(walk)
    : typeof value === 'object' && value !== null && Object.entries(value).some(([key, inner]) => looksSecret(key) || walk(inner))
  return walk(parsed)
}

/** The values kept for an operation; none when nothing was, or what was is not what is stored here. */
export function loadTryValues(key: TryKey): TryValues {
  const empty = { values: {}, body: '' }
  let stored: unknown
  try {
    stored = JSON.parse(storage()?.getItem(storageKey(key)) ?? 'null')
  } catch {
    return empty
  }
  if (typeof stored !== 'object' || stored === null) return empty
  const { values, body } = stored as { values?: unknown, body?: unknown }
  const kept: Record<string, string | boolean> = {}
  if (typeof values === 'object' && values !== null && !Array.isArray(values)) {
    for (const [name, value] of Object.entries(values)) if (typeof value === 'string' || typeof value === 'boolean') kept[name] = value
  }
  return { values: kept, body: typeof body === 'string' ? body : '' }
}

/**
 * Keeps the values to try an operation with: not those of a parameter whose name (or the key the API calls it) looks like a secret, nor a
 * body that holds one. Nothing left to keep forgets what was.
 */
export function storeTryValues(key: TryKey, draft: OperationDraft, { values, body }: TryValues): void {
  const store = storage()
  if (!store) return
  const secret = new Set(paramsOutput(draft).filter(param => looksSecret(param.name) || (param.key !== undefined && looksSecret(param.key))).map(param => param.name))
  const kept: Record<string, string | boolean> = {}
  for (const [name, value] of Object.entries(values)) if (value !== '' && !secret.has(name) && !looksSecret(name)) kept[name] = value
  const keptBody = body.trim() && !holdsSecret(body) ? body : ''
  try {
    if (!Object.keys(kept).length && !keptBody) store.removeItem(storageKey(key))
    else store.setItem(storageKey(key), JSON.stringify({ values: kept, body: keptBody }))
  } catch {
    // Full or refused: the values are only a convenience.
  }
}

/** Forgets every operation's values (tests). */
export function clearTryValues(): void {
  const store = storage()
  if (!store) return
  const names = Array.from({ length: store.length }, (_, at) => store.key(at) ?? '')
  for (const name of names) if (name.startsWith(PREFIX)) store.removeItem(name)
}
