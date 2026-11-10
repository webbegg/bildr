import { apiUrlProblem } from '#shared/data/apiSource'
import { ActionError } from '../actions/define'

/**
 * The SSRF guard for API sources. A URL passes when it is http(s) without
 * credentials on an allowed port (`apiUrlProblem`) AND every address its host
 * resolves to is public. The request then connects to the checked address
 * (pinned, so DNS cannot change between check and connect), redirects are
 * followed by hand and each hop is checked again.
 *
 * Ports: only 80, 443, 8080 and 8443, on top of the address check, so a
 * published app cannot be used to probe arbitrary services on public hosts.
 */

export type Resolver = (hostname: string) => Promise<{ address: string, family: number }[]>

export interface TransportInit {
  /** The checked address to connect to; the URL's host still names the server (Host header, TLS). */
  address: string
  family: 4 | 6
  signal?: AbortSignal
  headers?: Record<string, string>
}

/** Sends one GET without following redirects. */
export type Transport = (url: URL, init: TransportInit) => Promise<Response>

export const MAX_REDIRECTS = 3

/*
 * The project has no @types/node, so the few node builtins used here are
 * loaded with dynamic imports and typed locally.
 */
interface IncomingMessage extends AsyncIterable<Uint8Array> {
  statusCode?: number
  headers: Record<string, string | string[] | undefined>
  resume: () => void
  destroy: () => void
}
type LookupCallback = (error: Error | null, address: string | { address: string, family: number }[], family?: number) => void
interface HttpModule {
  request: (url: URL, options: {
    method: string
    headers?: Record<string, string>
    signal?: AbortSignal
    lookup: (hostname: string, options: { all?: boolean }, callback: LookupCallback) => void
  }, onResponse: (response: IncomingMessage) => void) => { on: (event: 'error', listener: (error: Error) => void) => void, end: () => void }
}
interface DnsModule {
  promises: { lookup: (hostname: string, options: { all: true, verbatim: true }) => Promise<{ address: string, family: number }[]> }
}

const systemResolver: Resolver = async (hostname) => {
  const dns = await import('node:dns' as string) as DnsModule
  return dns.promises.lookup(hostname, { all: true, verbatim: true })
}

const IPV4_BYTE = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = new RegExp(`^${IPV4_BYTE}(?:\\.${IPV4_BYTE}){3}$`)

/** 4 or 6 for an IP address literal (IPv6 without brackets), 0 otherwise; IPv6 is checked by the URL parser. */
function ipVersion(value: string): 0 | 4 | 6 {
  if (IPV4.test(value)) return 4
  if (!value.includes(':')) return 0
  try {
    new URL(`http://[${value}]/`)
    return 6
  } catch {
    return 0
  }
}

function ipv4Bytes(ip: string): number[] {
  return ip.split('.').map(Number)
}

function isBlockedIPv4([a, b, c]: number[]): boolean {
  return a === 0 // "this network", incl. 0.0.0.0
    || a === 10
    || (a === 100 && b! >= 64 && b! <= 127) // carrier-grade NAT
    || a === 127
    || (a === 169 && b === 254) // link-local, incl. cloud metadata 169.254.169.254
    || (a === 172 && b! >= 16 && b! <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19)) // benchmarking
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a! >= 224 // multicast and reserved, incl. 255.255.255.255
}

/** The eight 16-bit groups of an IPv6 address (an embedded dotted IPv4 tail included). */
function ipv6Groups(ip: string): number[] {
  let text = new URL(`http://[${ip}]/`).hostname.slice(1, -1)
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (tail) {
    const [a, b, c, d] = ipv4Bytes(tail[1]!)
    text = `${text.slice(0, -tail[1]!.length)}${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`
  }
  const [head, rest] = text.split('::') as [string, string | undefined]
  const parse = (part: string | undefined) => (part ? part.split(':').map(g => Number.parseInt(g, 16)) : [])
  const left = parse(head)
  const right = parse(rest)
  return rest === undefined ? left : [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right]
}

function embeddedIPv4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff]
}

function isBlockedIPv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number]
  const zeroUpTo = (n: number) => groups.slice(0, n).every(g => g === 0)
  if (zeroUpTo(5) && g5 === 0xffff) return isBlockedIPv4(embeddedIPv4(g6, g7)) // IPv4-mapped ::ffff:a.b.c.d
  if (zeroUpTo(6)) return g6 === 0 || isBlockedIPv4(embeddedIPv4(g6, g7)) // ::, ::1 and IPv4-compatible ::a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isBlockedIPv4(embeddedIPv4(g6, g7)) // NAT64
  if (g0 === 0x2002) return isBlockedIPv4(embeddedIPv4(g1, g2)) // 6to4
  return (g0 & 0xfe00) === 0xfc00 // unique local fc00::/7
    || (g0 & 0xffc0) === 0xfe80 // link-local fe80::/10
    || (g0 & 0xffc0) === 0xfec0 // site-local (deprecated)
    || (g0 & 0xff00) === 0xff00 // multicast
    || (g0 === 0x2001 && g1 === 0) // Teredo, which tunnels to an obfuscated IPv4
    || (g0 === 0x2001 && g1 === 0xdb8) // documentation
    || (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) // discard
}

/** True for every address an API source must not reach; anything that is not an IP counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const version = ipVersion(ip)
  if (version === 4) return isBlockedIPv4(ipv4Bytes(ip))
  if (version === 6) return isBlockedIPv6(ipv6Groups(ip))
  return true
}

function blocked(host: string, address: string): never {
  const shown = host === address ? `${address} is` : `${host} resolves to ${address},`
  throw new ActionError('invalid', `Blocked address: ${shown} a private, loopback or link-local address`)
}

/** Checks `url` and returns it with the public address to connect to; throws `ActionError('invalid')` otherwise. */
export async function checkUrl(url: string, resolve: Resolver = systemResolver): Promise<{ url: URL, address: string, family: 4 | 6 }> {
  const problem = apiUrlProblem(url)
  if (problem) throw new ActionError('invalid', problem)
  const parsed = new URL(url)
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  const literal = ipVersion(host)
  if (literal) {
    if (isBlockedAddress(host)) blocked(host, host)
    return { url: parsed, address: host, family: literal }
  }
  let addresses: { address: string, family: number }[]
  try {
    addresses = await resolve(host)
  } catch {
    addresses = []
  }
  if (!addresses.length) throw new ActionError('invalid', `Could not resolve ${host}`)
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) blocked(host, address)
  }
  return { url: parsed, address: addresses[0]!.address, family: ipVersion(addresses[0]!.address) as 4 | 6 }
}

/** A GET over node:http(s) that connects to `init.address` instead of resolving the host again. */
export const pinnedTransport: Transport = async (url, { address, family, signal, headers }) => {
  const http = await (url.protocol === 'https:' ? import('node:https' as string) : import('node:http' as string)) as HttpModule
  return new Promise((resolve, reject) => {
    const lookup = (_hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
      if (options?.all) callback(null, [{ address, family }])
      else callback(null, address, family)
    }
    const request = http.request(url, { method: 'GET', headers, signal, lookup }, (res) => {
      const status = res.statusCode ?? 502
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(res.headers)) {
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      if ([204, 205, 304].includes(status)) {
        res.resume()
        resolve(new Response(null, { status, headers: responseHeaders }))
        return
      }
      const chunks = res[Symbol.asyncIterator]()
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await chunks.next()
          if (done) controller.close()
          else controller.enqueue(value)
        },
        cancel() {
          res.destroy()
        }
      })
      resolve(new Response(body, { status, headers: responseHeaders }))
    })
    request.on('error', reject)
    request.end()
  })
}

const REDIRECTS = [301, 302, 303, 307, 308]

export interface GuardedFetchOptions {
  resolve?: Resolver
  transport?: Transport
  signal?: AbortSignal
  /** Sent on every hop. */
  headers?: Record<string, string>
  /** A source's own headers (they may carry secrets): sent only until a redirect leaves the first URL's origin. */
  customHeaders?: Record<string, string>
}

/** GETs `url`, checking it and every redirect hop (at most 3) with `checkUrl`. */
export async function guardedFetch(url: string, options: GuardedFetchOptions = {}): Promise<Response> {
  const { resolve, transport = pinnedTransport, signal, headers, customHeaders } = options
  let next = url
  let origin: string | undefined
  for (let hop = 0; ; hop++) {
    const target = await checkUrl(next, resolve)
    origin ??= target.url.origin
    if (target.url.origin !== origin) origin = ''
    const sent = customHeaders && origin ? { ...headers, ...customHeaders } : headers
    const response = await transport(target.url, { address: target.address, family: target.family, signal, headers: sent })
    const location = response.headers.get('location')
    if (!REDIRECTS.includes(response.status) || !location) return response
    await response.body?.cancel()
    if (hop >= MAX_REDIRECTS) throw new ActionError('invalid', `The API redirected more than ${MAX_REDIRECTS} times`)
    next = new URL(location, target.url).href
  }
}
