import { timingSafeEqual } from 'node:crypto'

/**
 * The editor API writes project files, so it is guarded like a local admin
 * tool (risk item 2): loopback clients only, a loopback Host header (stops DNS
 * rebinding), same-origin writes, and a per-session token.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export const isLoopbackAddress = (address: string | undefined): boolean => {
  if (!address) return false
  const plain = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return plain === '::1' || /^127(?:\.\d{1,3}){3}$/.test(plain)
}

/** The hostname of a `Host` header or an origin's host, without the port. */
export const hostnameOf = (host: string): string => {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1)
  return host.split(':')[0]!.toLowerCase()
}

export const isLoopbackHost = (host: string | null): boolean => host !== null && LOOPBACK_HOSTS.has(hostnameOf(host))

/** A write must come from the editor's own origin; requests without an Origin (curl, tests) rely on the token. */
export const isSameOriginWrite = (origin: string | null, host: string | null): boolean => {
  if (origin === null) return true
  try {
    const url = new URL(origin)
    return url.host === host && isLoopbackHost(url.host)
  } catch {
    return false
  }
}

export const tokensMatch = (given: string | null | undefined, expected: string): boolean => {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const cookieValue = (header: string | null, name: string): string | undefined => {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}
