import { apiHeaderProblem } from '@bildr/codegen/model'
import type { ApiHeader, ApiParam } from '@bildr/codegen/model'

/**
 * A request pasted into the path of an API query or action (api-calls R1, S3): a full URL under the API's base URL, or a cURL command,
 * read into what the editor can hold. That is the path under the base URL, the method, one query parameter per key of the query string
 * (named in camelCase, its type guessed from its value, the value kept as a test value), and the body to try. It also says what was left
 * out, and why.
 *
 * A sign-in never gets in: the Authorization header, the API's own key header, cookies and `-u` are dropped, and so is the value of a query
 * key that looks like a secret. The API's sign-in sends its secret from the env, so a secret never sits in the model nor in the editor's
 * test values. Pure: nothing is fetched.
 */

export type PastedMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface PastedParam {
  /** The parameter's name, camelCase (`per_page` → `perPage`). */
  name: string
  /** The key the API calls it (the query-string key as it was). */
  key: string
  type: ApiParam['type']
  /** The value it had, as a test value; empty when it looked like a secret. */
  value: string
}

export interface PastedRequest {
  from: 'url' | 'curl'
  method: PastedMethod
  /** Under the base URL, without query or fragment: `/products`. */
  path: string
  query: PastedParam[]
  /** A cURL command's headers a call can send (api-calls R2): never a sign-in, a secret, or one the app sends itself. */
  headers?: ApiHeader[]
  /** The body to try: JSON pretty-printed, or the text as it was. */
  body?: string
  /** What was left out, and why, in the editor's words. */
  notes: string[]
}

export type PasteRead = { ok: true, request: PastedRequest } | { ok: false, problem: string } | null

const METHODS: readonly PastedMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

// ── Shell words ──────────────────────────────────────────────────────────

/** `text` split into words as a POSIX shell does: single quotes, double quotes (with `\"`, `\\`, `\$`, `` \` ``), backslash escapes and line continuations. */
export function shellWords(text: string): string[] {
  const words: string[] = []
  let word = ''
  let started = false
  let at = 0
  while (at < text.length) {
    const char = text[at]!
    if (char === '\\') {
      const next = text[at + 1]
      if (next === '\n') at += 2
      else if (next === '\r' && text[at + 2] === '\n') at += 3
      else {
        word += next ?? ''
        started = true
        at += 2
      }
    } else if (char === '\'') {
      const end = text.indexOf('\'', at + 1)
      const stop = end === -1 ? text.length : end
      word += text.slice(at + 1, stop)
      started = true
      at = stop + 1
    } else if (char === '"') {
      at++
      while (at < text.length && text[at] !== '"') {
        if (text[at] === '\\' && '"\\$`'.includes(text[at + 1] ?? '')) {
          word += text[at + 1]
          at += 2
        } else if (text[at] === '\\' && text[at + 1] === '\n') {
          at += 2
        } else {
          word += text[at]
          at++
        }
      }
      started = true
      at++
    } else if (/\s/.test(char)) {
      if (started) words.push(word)
      word = ''
      started = false
      at++
    } else {
      word += char
      started = true
      at++
    }
  }
  if (started) words.push(word)
  return words
}

// ── Names and types ──────────────────────────────────────────────────────

const wordsOf = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)

/** `per_page` → `perPage`; a key that starts with a digit is a `param…`; never a name `taken` has (`pageSize2`). */
function nameOf(key: string, taken: Set<string>): string {
  const words = wordsOf(key)
  let name = words.map((word, at) => at === 0 ? (word === word.toUpperCase() && word.length > 1 ? word.toLowerCase() : word[0]!.toLowerCase() + word.slice(1)) : word[0]!.toUpperCase() + word.slice(1)).join('')
  if (!name) name = 'param'
  else if (!/^[a-z]/.test(name)) name = `param${name}`
  let unique = name
  for (let count = 2; taken.has(unique); count++) unique = `${name}${count}`
  taken.add(unique)
  return unique
}

/** A whole number with no leading zero, a decimal, `true` or `false`; text otherwise (`007` is a code, not a number). */
const typeOf = (value: string): ApiParam['type'] =>
  /^-?(?:0|[1-9]\d{0,14})$/.test(value) ? 'integer' : /^-?\d+\.\d+$/.test(value) ? 'number' : value === 'true' || value === 'false' ? 'boolean' : 'text'

const SECRET_WORDS = new Set(['key', 'token', 'secret', 'password', 'passwd', 'pwd', 'signature', 'sig', 'apikey', 'auth', 'credential', 'credentials', 'session', 'authorization', 'authentication'])
/** A query key whose value is a secret: `api_key`, `access_token`, `apiKey`, `client_secret`. */
export const looksSecret = (key: string): boolean => {
  const words = wordsOf(key).map(word => word.toLowerCase())
  return words.length > 0 && (SECRET_WORDS.has(words.at(-1)!) || SECRET_WORDS.has(words.join('')))
}

const quoted = (names: string[]) => names.length === 1 ? `“${names[0]}”` : `${names.slice(0, -1).map(name => `“${name}”`).join(', ')} and “${names.at(-1)}”`

function paramsOf(entries: Iterable<[string, string]>, notes: string[]): PastedParam[] {
  const seen = new Set<string>()
  const taken = new Set<string>()
  const params: PastedParam[] = []
  const secret: string[] = []
  for (const [key, value] of entries) {
    if (seen.has(key)) continue
    seen.add(key)
    const hidden = looksSecret(key)
    if (hidden && value) secret.push(key)
    params.push({ name: nameOf(key, taken), key, type: hidden ? 'text' : typeOf(value), value: hidden ? '' : value })
  }
  if (secret.length) notes.push(`Left out the ${secret.length === 1 ? 'value' : 'values'} of ${quoted(secret)}: ${secret.length === 1 ? 'it looks like a secret' : 'they look like secrets'}. A secret goes in the API's sign-in, never in a query.`)
  return params
}

// ── Under the base URL ───────────────────────────────────────────────────

/** The path of `url` under `baseUrl` (`/products`; `/` for the base itself), or null when it is not under it. */
function pathUnder(url: URL, baseUrl: string): string | null {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return null
  }
  const root = base.pathname.replace(/\/+$/, '')
  if (url.origin !== base.origin) return null
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return null
  return url.pathname.slice(root.length) || '/'
}

const absolute = (text: string): URL | null => {
  if (!/^https?:\/\//i.test(text)) return null
  try {
    return new URL(text)
  } catch {
    return null
  }
}

const notUnder = (baseUrl: string) => ({ ok: false as const, problem: `That URL is not under the API's base URL, ${baseUrl}` })

// ── cURL ─────────────────────────────────────────────────────────────────

/** Flags that take a value this reading has no use for (it is skipped with them). */
const SKIPPED_WITH_VALUE = new Set(['-o', '--output', '-A', '--user-agent', '-e', '--referer', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '--retry', '-x', '--proxy', '--cacert', '--cert', '--key', '-K', '--config', '-c', '--cookie-jar', '--resolve', '-T', '--upload-file'])
const DATA = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'])
/** Headers the generated app sets itself: nothing to keep, nothing to say. An Accept other than JSON is the call's (it is kept). */
const SENT_BY_THE_APP = new Set(['content-type', 'user-agent', 'accept-encoding', 'content-length', 'host', 'connection'])
const JSON_ACCEPT = /^(?:application\/json|\*\/\*)$/i

function readCurl(words: string[], baseUrl: string, signInHeader?: string): PasteRead {
  let method: PastedMethod | undefined
  let url: string | undefined
  let get = false
  let json = false
  const data: string[] = []
  const signIn: string[] = []
  const headers: ApiHeader[] = []
  const refused: string[] = []
  const headerOf = (line: string) => {
    const split = line.indexOf(':')
    const name = (split === -1 ? line : line.slice(0, split)).trim()
    const value = split === -1 ? '' : line.slice(split + 1).trim()
    const lower = name.toLowerCase()
    // curl's `-H 'X-Name:'` removes a header: nothing to keep.
    if (!name || !value || SENT_BY_THE_APP.has(lower) || (lower === 'accept' && JSON_ACCEPT.test(value))) return
    if (lower === 'authorization' || lower === 'cookie' || lower === 'proxy-authorization' || (signInHeader && lower === signInHeader.toLowerCase())) signIn.push(name)
    else if (apiHeaderProblem(name, value, undefined)) refused.push(name)
    else headers.push({ name, value })
  }
  for (let at = 1; at < words.length; at++) {
    const word = words[at]!
    const [flag, attached] = word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined]
    const value = () => attached ?? words[++at] ?? ''
    if (flag === '-X' || flag === '--request') method = value().toUpperCase() as PastedMethod
    else if (/^-X[A-Za-z]+$/.test(flag)) method = flag.slice(2).toUpperCase() as PastedMethod
    else if (flag === '-H' || flag === '--header') headerOf(value())
    else if (DATA.has(flag)) data.push(value())
    else if (flag === '--json') {
      data.push(value())
      json = true
    } else if (flag === '-G' || flag === '--get') get = true
    else if (flag === '--url') url = value()
    else if (flag === '-u' || flag === '--user') {
      value()
      signIn.push('-u')
    } else if (flag === '-b' || flag === '--cookie') {
      value()
      signIn.push('Cookie')
    } else if (flag === '-F' || flag === '--form' || flag === '--form-string') return { ok: false, problem: 'Form uploads (-F) can\'t be sent by an API action yet' }
    else if (SKIPPED_WITH_VALUE.has(flag)) {
      if (attached === undefined) at++
    } else if (!word.startsWith('-') && url === undefined) url = word
  }
  if (url === undefined) return { ok: false, problem: 'The cURL command has no URL' }
  const target = absolute(url)
  if (!target) return { ok: false, problem: `“${url}” is not a full http or https URL` }
  const path = pathUnder(target, baseUrl)
  if (path === null) return notUnder(baseUrl)
  const resolved = method ?? (data.length && !get ? 'POST' : 'GET')
  if (!METHODS.includes(resolved)) return { ok: false, problem: `${resolved} is not a method an API query or action has: use GET, POST, PUT, PATCH or DELETE` }
  const notes: string[] = []
  const entries: [string, string][] = [...target.searchParams]
  let body: string | undefined
  if (data.length && get) {
    for (const part of data.join('&').split('&').filter(Boolean)) {
      const split = part.indexOf('=')
      entries.push(split === -1 ? [part, ''] : [part.slice(0, split), part.slice(split + 1)])
    }
  } else if (data.length) {
    const raw = json ? data[0]! : data.join('&')
    try {
      body = JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      body = raw
      notes.push('The body is not JSON: an API action sends JSON only.')
    }
  }
  const query = paramsOf(entries, notes)
  if (signIn.length) notes.push(`Left out the sign-in (${[...new Set(signIn)].join(', ')}): the API's sign-in sends its secret, so it never sits in the model.`)
  if (refused.length) notes.push(`Left out the ${refused.length === 1 ? 'header' : 'headers'} ${quoted(refused)}: a secret belongs in the API's sign-in, and the app sends some headers itself.`)
  return { ok: true, request: { from: 'curl', method: resolved, path, query, ...(headers.length ? { headers } : {}), ...(body !== undefined ? { body } : {}), notes } }
}

// ── Reading a paste ──────────────────────────────────────────────────────

/**
 * What `text` pasted into the path of an operation of the API at `baseUrl` is: a request read from a full URL or a cURL command, why it
 * can't be used, or null when it is neither (a path or words: it pastes as usual). `signInHeader` is the header the API's sign-in sends
 * its key in, when it has one: a cURL command's header of that name is a secret, and is left out.
 */
export function readPastedRequest(text: string, baseUrl: string, signInHeader?: string): PasteRead {
  const typed = text.trim()
  if (/^curl(?:\.exe)?\s/i.test(typed)) return readCurl(shellWords(typed), baseUrl, signInHeader)
  const url = absolute(typed)
  if (!url || /\s/.test(typed)) return null
  const path = pathUnder(url, baseUrl)
  if (path === null) return notUnder(baseUrl)
  const notes: string[] = []
  const query = paramsOf(url.searchParams, notes)
  return { ok: true, request: { from: 'url', method: 'GET', path, query, notes } }
}
