import { isUnder } from '@bildr/codegen/edit'
import type { DataSourceFile } from '@bildr/codegen/model'
import { readProjectFile } from './project.ts'

/**
 * The editor's requests to a project's REST data sources (P3c: `datasource_preview`,
 * `repository_endpoint_test`), from the dev server. GET only, under the source's base
 * URL only (redirects elsewhere aren't followed), with a timeout and a size cap.
 * Settings resolve the way the app's runtimeConfig does: the env var (the process env,
 * then the project's `.env`), else the model's default.
 */

export const REMOTE_TIMEOUT_MS = 10_000
export const REMOTE_MAX_BYTES = 1_000_000
const MAX_REDIRECTS = 3

/** A request that failed on the data source's side: no answer, a redirect away, too big, not JSON. */
export class RemoteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteError'
  }
}

/** The project's `.env` as name → value (`KEY=value`, `export KEY=…`, quoted values, `#` comments). Missing: none. */
export const readDotEnv = (root: string): Record<string, string> => {
  const text = readProjectFile(root, '.env')
  if (text === undefined) return {}
  const vars: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    let value = match[2]!
    const quoted = /^(['"])(.*)\1$/.exec(value)
    if (quoted) value = quoted[2]!
    else value = value.replace(/\s+#.*$/, '')
    vars[match[1]!] = value
  }
  return vars
}

/** Where an env var is set: the process env, the project's `.env`, or nowhere (empty counts as unset). */
export const envSource = (name: string, dotEnv: Record<string, string>): 'env' | '.env' | null =>
  process.env[name] ? 'env' : dotEnv[name] ? '.env' : null

/** A data source's settings as the app would see them (env var, else the model default). */
export const resolveSettings = (root: string, source: DataSourceFile): Record<string, string> => {
  const dotEnv = readDotEnv(root)
  const settings: Record<string, string> = { ...source.defaults }
  for (const [setting, name] of Object.entries(source.env)) {
    const value = process.env[name] || dotEnv[name]
    if (value) settings[setting] = value
  }
  return settings
}

/** The request headers of a data source, and the secret values that must never be shown back. */
export const authHeaders = (source: DataSourceFile, settings: Record<string, string>): { headers: Record<string, string>, secrets: string[] } => {
  const headers: Record<string, string> = { accept: 'application/json' }
  const secret = source.auth ? settings[source.auth.secret] : undefined
  if (source.auth && secret) {
    if (source.auth.type === 'bearer') headers.authorization = `Bearer ${secret}`
    else headers[source.auth.header!.toLowerCase()] = secret
  }
  return { headers, secrets: secret ? [secret] : [] }
}

export interface FetchOptions {
  /** Requests (redirects included) stay under it. */
  baseUrl: string
  headers: Record<string, string>
  timeoutMs?: number
  maxBytes?: number
}

const readCapped = async (response: Response, maxBytes: number): Promise<string> => {
  const declared = Number(response.headers.get('content-length'))
  const tooBig = () => new RemoteError(`The data source answered more than ${maxBytes / 1_000_000} MB: not read`)
  if (declared > maxBytes) {
    await response.body?.cancel()
    throw tooBig()
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw tooBig()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** GETs `url` (under `baseUrl`) and parses its JSON body. Throws RemoteError when the source fails. */
export const fetchJson = async (url: string, { baseUrl, headers, timeoutMs = REMOTE_TIMEOUT_MS, maxBytes = REMOTE_MAX_BYTES }: FetchOptions): Promise<{ status: number, json: unknown }> => {
  const signal = AbortSignal.timeout(timeoutMs)
  let target = url
  try {
    for (let redirects = 0; ; redirects++) {
      const response = await fetch(target, { method: 'GET', headers, redirect: 'manual', signal })
      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        await response.body?.cancel()
        const next = new URL(response.headers.get('location')!, target)
        if (!isUnder(baseUrl, next.href)) throw new RemoteError(`The data source redirected to ${next.origin}, outside its base URL: not followed`)
        if (redirects >= MAX_REDIRECTS) throw new RemoteError(`The data source redirected more than ${MAX_REDIRECTS} times`)
        target = next.href
        continue
      }
      const text = await readCapped(response, maxBytes)
      try {
        return { status: response.status, json: JSON.parse(text) as unknown }
      } catch {
        throw new RemoteError(`The data source answered ${response.status} without JSON`)
      }
    }
  } catch (error) {
    if (error instanceof RemoteError) throw error
    if (signal.aborted) throw new RemoteError(`The data source didn't answer within ${timeoutMs / 1000} s`)
    throw new RemoteError(`The data source couldn't be reached: ${(error as Error).cause instanceof Error ? ((error as Error).cause as Error).message : (error as Error).message}`)
  }
}
