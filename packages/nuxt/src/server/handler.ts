import { join } from 'node:path'
import { MANIFEST_FILE, fileKind, loadModel, serializeModel } from '@bildr/codegen/model'
import { hashFiles, readManifest, sha256, writeAtomically } from '../node/sync.ts'
import { readModelFiles, resolvesInside } from '../node/project.ts'
import { cookieValue, isLoopbackAddress, isLoopbackHost, isSameOriginWrite, tokensMatch } from './guard.ts'
import { editorPage } from './page.ts'

/**
 * The editor's HTTP surface under `/__bildr`, as a web-standard handler so it
 * runs on any server builder and is tested without Nuxt. Only `nuxt dev`
 * registers it (module.ts).
 */

export const BASE = '/__bildr'
const COOKIE = 'bildr_token'
const MAX_BODY = 2_000_000

export interface HandlerOptions {
  /** Project root. */
  root: string
  /** Per-session secret, printed in the dev server log. */
  token: string
}

export interface RequestContext {
  /** The client's socket address, from the server adapter. Unknown means refused. */
  remoteAddress?: string
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })
const fail = (status: number, message: string) => json(status, { ok: false, message })

export const createBildrHandler = (options: HandlerOptions) => async (request: Request, context: RequestContext = {}): Promise<Response> => {
  try {
    return await route(options, request, context)
  } catch (error) {
    // Never crash the dev server: a broken manifest or an fs error becomes a JSON error.
    return fail(500, (error as Error).message)
  }
}

const route = async ({ root, token }: HandlerOptions, request: Request, context: RequestContext): Promise<Response> => {
  const url = new URL(request.url)
  const host = request.headers.get('host')
  if (!isLoopbackAddress(context.remoteAddress) || !isLoopbackHost(host)) return fail(403, 'The bildr editor only answers local requests')
  if (request.method !== 'GET' && request.method !== 'HEAD' && !isSameOriginWrite(request.headers.get('origin'), host)) {
    return fail(403, 'Cross-origin writes are refused')
  }

  const path = url.pathname.replace(/\/+$/, '') || '/'
  // Opening the editor: the token from the dev server log, once, becomes an HttpOnly cookie.
  if ((path === BASE) && request.method === 'GET' && tokensMatch(url.searchParams.get('token'), token)) {
    return new Response(editorPage(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=${token}; Path=${BASE}; HttpOnly; SameSite=Strict`,
        'content-security-policy': 'default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; frame-ancestors \'self\'',
        'referrer-policy': 'no-referrer'
      }
    })
  }
  const given = request.headers.get('x-bildr-token') ?? cookieValue(request.headers.get('cookie'), COOKIE)
  if (!tokensMatch(given, token)) return fail(401, 'Missing or wrong bildr session token: open the editor from the link in the dev server log')

  if (path === BASE && request.method === 'GET') return new Response(editorPage(), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  if (path === `${BASE}/api/model` && request.method === 'GET') return json(200, loadModel(readModelFiles(root)))
  if (path === `${BASE}/api/drift` && request.method === 'GET') return json(200, drift(root))
  if (path === `${BASE}/api/file` && request.method === 'PUT') return writeModelFile(root, url.searchParams.get('path'), request)
  return fail(404, 'Not found')
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
  if (!path || path === MANIFEST_FILE || !fileKind(path)) return fail(400, 'Only .bildr/ model files can be written (not the manifest, the cache or project files)')
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return fail(415, 'Send the file as application/json')
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return fail(413, 'File too large')
  const text = await request.text()
  if (text.length > MAX_BODY) return fail(413, 'File too large')
  try {
    JSON.parse(text)
  } catch {
    return fail(400, 'Invalid JSON')
  }
  const files = { ...readModelFiles(root), [path]: text }
  const result = loadModel(files)
  if (!result.ok) return json(422, { ok: false, problems: result.problems })
  const target = join(root, path)
  if (!resolvesInside(join(root, '.bildr'), target)) return fail(400, `${path} resolves outside .bildr/ (symlink)`)
  const canonical = serializeModel(result.model)[path]!
  writeAtomically(target, canonical)
  return json(200, { ok: true, sha256: sha256(canonical) })
}
