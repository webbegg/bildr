import { loadModel } from '@bildr/codegen/model'
import { ActionError, ERROR_STATUS } from '../actions/define.ts'
import type { ActionContext } from '../actions/define.ts'
import { handleMcp } from '../actions/mcp.ts'
import { createActions } from '../actions/runtime.ts'
import type { Actions } from '../actions/runtime.ts'
import { isModelFilePath, pendingMigration, saveModelFile } from '../node/editor-io.ts'
import { CHECK_NAMES, readHealth } from '../node/health.ts'
import type { CheckName } from '../node/health.ts'
import type { MigrationOutcome } from '../node/regenerate.ts'
import { hashFiles, readManifest } from '../node/sync.ts'
import { readModelFiles } from '../node/project.ts'
import { EDITOR_CSP, defaultEditorDist, readEditorAsset, readEditorShell } from './assets.ts'
import { cookieValue, isLoopbackAddress, isLoopbackHost, isSameOriginWrite, tokensMatch } from './guard.ts'
import { PAGE_CSP, editorPage } from './page.ts'

/**
 * The editor's HTTP surface under `/__bildr`, as a web-standard handler so it
 * runs on any server builder and is tested without Nuxt. Only `nuxt dev`
 * registers it (module.ts).
 */

export const BASE = '/__bildr'
const COOKIE = 'bildr_token'
const MAX_BODY = 2_000_000

export interface HandlerOptions extends ActionContext {
  /** Per-session secret, printed in the dev server log. */
  token: string
  /** The built editor (`index.html`, `_assets/`). Default: `@bildr/editor`'s `dist/`. */
  editorDist?: string
}

/** Whether a request path is the editor's: `/__bildr` and below, never `/__bildrfoo`. */
export const ownsPath = (pathname: string): boolean => pathname === BASE || pathname.startsWith(`${BASE}/`)

export interface RequestContext {
  /** The client's socket address, from the server adapter. Unknown means refused. */
  remoteAddress?: string
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })
const fail = (status: number, message: string) => json(status, { ok: false, message })

interface Setup extends HandlerOptions {
  actions: Actions
}

export const createBildrHandler = (options: HandlerOptions) => {
  const { root, confirmMigration, runHealth } = options
  const setup: Setup = { ...options, editorDist: options.editorDist ?? defaultEditorDist(), actions: createActions({ root, confirmMigration, runHealth }) }
  return async (request: Request, context: RequestContext = {}): Promise<Response> => {
    try {
      return await route(setup, request, context)
    } catch (error) {
      // Never crash the dev server: a broken manifest or an fs error becomes a JSON error.
      return fail(500, (error as Error).message)
    }
  }
}

/** The editor: the built shell under its strict CSP, or the placeholder page while the editor isn't built. */
const editorResponse = (dist: string | undefined, headers: Record<string, string> = {}) => {
  const shell = readEditorShell(dist)
  return new Response(shell ?? editorPage(), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': shell === undefined ? PAGE_CSP : EDITOR_CSP,
      'referrer-policy': 'no-referrer',
      ...headers
    }
  })
}

const ASSETS = `${BASE}/_assets/`
const MCP = `${BASE}/mcp`
const ACTION_PATH = /^\/__bildr\/api\/actions\/([^/]+)$/

const route = async ({ root, token, confirmMigration, runHealth, editorDist, actions }: Setup, request: Request, context: RequestContext): Promise<Response> => {
  const url = new URL(request.url)
  if (!ownsPath(url.pathname)) return fail(404, 'Not found')
  const host = request.headers.get('host')
  if (!isLoopbackAddress(context.remoteAddress) || !isLoopbackHost(host)) return fail(403, 'The bildr editor only answers local requests')
  if (request.method !== 'GET' && request.method !== 'HEAD' && !isSameOriginWrite(request.headers.get('origin'), host)) {
    return fail(403, 'Cross-origin writes are refused')
  }

  const path = url.pathname.replace(/\/+$/, '') || '/'
  // Opening the editor: the token from the dev server log, once, becomes an HttpOnly cookie.
  if ((path === BASE) && request.method === 'GET' && tokensMatch(url.searchParams.get('token'), token)) {
    return editorResponse(editorDist, { 'set-cookie': `${COOKIE}=${token}; Path=${BASE}; HttpOnly; SameSite=Strict` })
  }
  // MCP clients are agents, not the editor page: they send the token as a header, the cookie alone is not enough.
  const given = path === MCP
    ? request.headers.get('x-bildr-token')
    : request.headers.get('x-bildr-token') ?? cookieValue(request.headers.get('cookie'), COOKIE)
  if (!tokensMatch(given, token)) return fail(401, 'Missing or wrong bildr session token: open the editor from the link in the dev server log')

  if (path === MCP) return handleMcp(actions, request, MAX_BODY)
  if (path === BASE && request.method === 'GET') return editorResponse(editorDist)
  if (url.pathname.startsWith(ASSETS) && request.method === 'GET') return asset(editorDist, url.pathname.slice(ASSETS.length))
  if (path === `${BASE}/api/actions` && request.method === 'GET') return json(200, actions.list())
  const action = ACTION_PATH.exec(path)
  if (action && request.method === 'POST') return callAction(actions, action[1]!, request)
  if (path === `${BASE}/api/model` && request.method === 'GET') return json(200, loadModel(readModelFiles(root)))
  if (path === `${BASE}/api/drift` && request.method === 'GET') return json(200, drift(root))
  if (path === `${BASE}/api/file` && request.method === 'PUT') return writeModelFile(root, url.searchParams.get('path'), request)
  if (path === `${BASE}/api/migrations/pending` && request.method === 'GET') return json(200, { pending: pendingMigration(root) })
  if (path === `${BASE}/api/migrations/confirm` && request.method === 'POST' && confirmMigration) return confirm(confirmMigration, request)
  if (path === `${BASE}/api/health` && request.method === 'GET') return json(200, readHealth(root))
  if (path === `${BASE}/api/health/run` && request.method === 'POST') return runChecks(runHealth, request)
  return fail(404, 'Not found')
}

const asset = (dist: string | undefined, encoded: string) => {
  const found = readEditorAsset(dist, encoded)
  if (!found) return fail(404, 'Not found')
  return new Response(new Uint8Array(found.body), { status: 200, headers: { 'content-type': found.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' } })
}

const actionFailure = (error: ActionError) =>
  json(ERROR_STATUS[error.code], { ok: false, code: error.code, message: error.message, ...(error.problems ? { problems: error.problems } : {}) })

/** Calls one action with the JSON body as its input: `{ ok: true, result }`, or `{ ok: false, code, message, problems? }`. */
const callAction = async (actions: Actions, name: string, request: Request) => {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return fail(415, 'Send the action input as application/json')
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return fail(413, 'Input too large')
  const text = await request.text()
  if (text.length > MAX_BODY) return fail(413, 'Input too large')
  let input: unknown
  try {
    input = text.trim() ? JSON.parse(text) : {}
  } catch {
    return actionFailure(new ActionError('invalid_input', 'Invalid JSON'))
  }
  try {
    return json(200, { ok: true, result: await actions.call(name, input) })
  } catch (error) {
    if (error instanceof ActionError) return actionFailure(error)
    throw error
  }
}

/** Runs the Health checks the editor asked for: `{ "checks": ["lint", …] }`, each known name at most once. */
const runChecks = async (runHealth: HandlerOptions['runHealth'], request: Request) => {
  if (!runHealth) return fail(501, 'Health checks can\'t run here: the bildr module gave no check runner')
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return fail(415, 'Send { "checks": ["lint"] } as application/json')
  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return fail(400, 'Invalid JSON')
  }
  const checks = (body as { checks?: unknown } | null)?.checks
  const known = CHECK_NAMES.join(', ')
  if (!Array.isArray(checks) || checks.length === 0) return fail(400, `Give the checks to run as a non-empty list (${known})`)
  const unknown = checks.filter(name => typeof name !== 'string' || !(CHECK_NAMES as readonly string[]).includes(name))
  if (unknown.length) return fail(400, `Unknown check ${unknown.map(name => JSON.stringify(name)).join(', ')}: the checks are ${known}`)
  const repeated = checks.filter((name, index) => checks.indexOf(name) !== index)
  if (repeated.length) return fail(400, `Ask for each check once: ${[...new Set(repeated)].join(', ')} is listed more than once`)
  return json(200, { ok: true, results: await runHealth(checks as CheckName[]) })
}

/** Confirms the pending destructive migration by its hash; a stale hash (the plan changed since) leaves it pending. */
const confirm = async (confirmMigration: (hash: string) => Promise<MigrationOutcome>, request: Request) => {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return fail(415, 'Send { "hash": "…" } as application/json')
  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return fail(400, 'Invalid JSON')
  }
  const hash = (body as { hash?: unknown } | null)?.hash
  if (typeof hash !== 'string' || !hash) return fail(400, 'Give the hash of the pending migration')
  return json(200, { ok: true, migration: await confirmMigration(hash) })
}

/** Generated files whose disk content no longer matches what bildr wrote. */
const drift = (root: string) => {
  const manifest = readManifest(root)
  const disk = hashFiles(root, Object.keys(manifest))
  const detached: string[] = []
  const deleted: string[] = []
  for (const [path, entry] of Object.entries(manifest)) {
    if (entry.owner === 'scaffold' || entry.owner === 'deleted') continue
    if (disk[path] === undefined) deleted.push(path)
    else if (entry.owner === 'detached' || entry.owner === 'orphaned' || disk[path] !== entry.sha256) detached.push(path)
  }
  return { detached, deleted, missingManifest: Object.keys(manifest).length === 0 }
}

/** Saves one `.bildr/` model file, only if the whole model stays valid. Written canonically and atomically. */
const writeModelFile = async (root: string, path: string | null, request: Request) => {
  if (!path || !isModelFilePath(path)) return fail(400, 'Only .bildr/ model files can be written (not the manifest, the cache or project files)')
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return fail(415, 'Send the file as application/json')
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return fail(413, 'File too large')
  const text = await request.text()
  if (text.length > MAX_BODY) return fail(413, 'File too large')
  const saved = saveModelFile(root, path, text)
  if (saved.ok) return json(200, { ok: true, sha256: saved.sha256 })
  if (saved.reason === 'invalid') return json(422, { ok: false, problems: saved.problems })
  return fail(400, saved.message)
}
