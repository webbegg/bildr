import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { checkUrl, guardedFetch, isBlockedAddress, pinnedTransport } from '../../server/utils/urlGuard'
import type { Resolver, Transport } from '../../server/utils/urlGuard'

/** A resolver from a fixed host table, like a stubbed DNS. */
function dns(table: Record<string, string[]>): Resolver {
  return async (hostname) => {
    const addresses = table[hostname]
    if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' })
    return addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
}

const PUBLIC = dns({ 'api.example.com': ['93.184.216.34'], 'v6.example.com': ['2606:2800:220:1::1'] })

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, unspecified, multicast and reserved addresses', () => {
    for (const ip of [
      '127.0.0.1', '127.255.0.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '0.0.0.0', '0.1.2.3', '100.64.0.1', '224.0.0.1', '239.1.1.1', '240.0.0.1', '255.255.255.255',
      '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '::127.0.0.1', '64:ff9b::a9fe:a9fe'
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('allows public addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '192.169.0.1', '2606:2800:220:1::1', '::ffff:8.8.8.8']) {
      expect(isBlockedAddress(ip), ip).toBe(false)
    }
  })

  it('blocks anything that is not an IP address', () => {
    expect(isBlockedAddress('localhost')).toBe(true)
  })
})

describe('checkUrl', () => {
  it('resolves a public host and pins its address', async () => {
    expect(await checkUrl('https://api.example.com/x', PUBLIC)).toMatchObject({ address: '93.184.216.34', family: 4 })
    expect(await checkUrl('https://v6.example.com/x', PUBLIC)).toMatchObject({ address: '2606:2800:220:1::1', family: 6 })
  })

  it('refuses hosts that resolve to blocked addresses, any of them', async () => {
    const resolve = dns({ 'localhost': ['127.0.0.1'], 'mixed.example.com': ['93.184.216.34', '10.0.0.5'], 'metadata.internal': ['169.254.169.254'] })
    await expect(checkUrl('http://localhost/', resolve)).rejects.toMatchObject({ code: 'invalid', message: 'Blocked address: localhost resolves to 127.0.0.1, a private, loopback or link-local address' })
    await expect(checkUrl('http://mixed.example.com/', resolve)).rejects.toMatchObject({ message: expect.stringContaining('10.0.0.5') })
    await expect(checkUrl('http://metadata.internal/', resolve)).rejects.toMatchObject({ message: expect.stringContaining('Blocked address') })
  })

  it('refuses blocked IP literals without asking DNS', async () => {
    const never: Resolver = async () => {
      throw new Error('DNS must not be asked')
    }
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://0x7f.1/']) {
      await expect(checkUrl(url, never), url).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Blocked address') })
    }
  })

  it('refuses non-http schemes, credentials and other ports before resolving', async () => {
    await expect(checkUrl('file:///etc/passwd', PUBLIC)).rejects.toMatchObject({ code: 'invalid', message: 'Only http and https URLs can be fetched' })
    await expect(checkUrl('https://u:p@api.example.com/', PUBLIC)).rejects.toMatchObject({ message: 'URLs with a user name or password are not allowed' })
    await expect(checkUrl('http://api.example.com:22/', PUBLIC)).rejects.toMatchObject({ message: 'Port 22 is not allowed; use 80, 443, 8080 or 8443' })
  })

  it('reports a host that does not resolve', async () => {
    await expect(checkUrl('https://nope.example.com/', PUBLIC)).rejects.toMatchObject({ code: 'invalid', message: 'Could not resolve nope.example.com' })
  })
})

describe('pinnedTransport', () => {
  it('connects to the given address, never resolving the host itself', async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ host: req.headers.host, path: req.url }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      // `.invalid` never resolves, so a response proves the pinned address was used.
      const response = await pinnedTransport(new URL(`http://pinned.invalid:${port}/x?y=1`), { address: '127.0.0.1', family: 4, headers: { accept: 'application/json' } })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ host: `pinned.invalid:${port}`, path: '/x?y=1' })
    } finally {
      server.close()
    }
  })

  it('sends the method and body', async () => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Uint8Array) => (body += new TextDecoder().decode(chunk)))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ method: req.method, body, length: req.headers['content-length'] }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const response = await pinnedTransport(new URL(`http://pinned.invalid:${port}/x`), { address: '127.0.0.1', family: 4, method: 'PATCH', body: '{"a":"é"}' })
      expect(await response.json()).toEqual({ method: 'PATCH', body: '{"a":"é"}', length: '10' })
    } finally {
      server.close()
    }
  })
})

describe('guardedFetch', () => {
  const resolve = dns({ 'api.example.com': ['93.184.216.34'], 'cdn.example.com': ['93.184.216.35'], 'evil.example.com': ['192.168.0.10'] })

  function transport(routes: Record<string, () => Response>) {
    const calls: { url: string, address: string }[] = []
    const send: Transport = async (url, init) => {
      calls.push({ url: url.href, address: init.address })
      const route = routes[url.href]
      if (!route) throw new Error(`unexpected request ${url.href}`)
      return route()
    }
    return { send, calls }
  }
  const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } })

  it('connects to the checked address and follows a redirect to a public host', async () => {
    const { send, calls } = transport({
      'https://api.example.com/a': redirect('https://cdn.example.com/b'),
      'https://cdn.example.com/b': () => new Response('[]', { headers: { 'content-type': 'application/json' } })
    })
    const response = await guardedFetch('https://api.example.com/a', { resolve, transport: send })
    expect(await response.text()).toBe('[]')
    expect(calls).toEqual([
      { url: 'https://api.example.com/a', address: '93.184.216.34' },
      { url: 'https://cdn.example.com/b', address: '93.184.216.35' }
    ])
  })

  it('re-checks every redirect hop, so a redirect to a private address is refused', async () => {
    const { send, calls } = transport({
      'https://api.example.com/a': redirect('http://evil.example.com/admin'),
      'https://api.example.com/b': redirect('http://169.254.169.254/latest/meta-data'),
      'https://api.example.com/c': redirect('file:///etc/passwd')
    })
    await expect(guardedFetch('https://api.example.com/a', { resolve, transport: send })).rejects.toMatchObject({ message: expect.stringContaining('Blocked address: evil.example.com') })
    await expect(guardedFetch('https://api.example.com/b', { resolve, transport: send })).rejects.toMatchObject({ message: expect.stringContaining('Blocked address') })
    await expect(guardedFetch('https://api.example.com/c', { resolve, transport: send })).rejects.toMatchObject({ message: 'Only http and https URLs can be fetched' })
    expect(calls.map(c => c.url)).toEqual(['https://api.example.com/a', 'https://api.example.com/b', 'https://api.example.com/c'])
  })

  it('sends custom headers on same-origin hops only, dropping them for good once the origin changes', async () => {
    const seen: { url: string, headers?: Record<string, string> }[] = []
    const send: Transport = async (url, init) => {
      seen.push({ url: url.href, headers: init.headers })
      if (url.pathname === '/a') return redirect('/b')()
      if (url.pathname === '/b') return redirect('https://cdn.example.com/c')()
      if (url.pathname === '/c') return redirect('https://api.example.com/d')()
      return new Response('[]')
    }
    await guardedFetch('https://api.example.com/a', { resolve, transport: send, headers: { accept: 'application/json' }, customHeaders: { authorization: 'Bearer sk_test_SECRET123' } })
    expect(seen).toEqual([
      { url: 'https://api.example.com/a', headers: { accept: 'application/json', authorization: 'Bearer sk_test_SECRET123' } },
      { url: 'https://api.example.com/b', headers: { accept: 'application/json', authorization: 'Bearer sk_test_SECRET123' } },
      { url: 'https://cdn.example.com/c', headers: { accept: 'application/json' } },
      { url: 'https://api.example.com/d', headers: { accept: 'application/json' } }
    ])
  })

  it('sends the method and body; a 303 turns into a GET without body, a 307 keeps both', async () => {
    const seen: { url: string, method?: string, body?: string }[] = []
    const send: Transport = async (url, init) => {
      seen.push({ url: url.href, method: init.method, body: init.body })
      if (url.pathname === '/a') return new Response(null, { status: 303, headers: { location: '/done' } })
      if (url.pathname === '/b') return new Response(null, { status: 307, headers: { location: '/done' } })
      return new Response('{}')
    }
    await guardedFetch('https://api.example.com/a', { resolve, transport: send, method: 'POST', body: '{}' })
    await guardedFetch('https://api.example.com/b', { resolve, transport: send, method: 'PUT', body: '{}' })
    expect(seen).toEqual([
      { url: 'https://api.example.com/a', method: 'POST', body: '{}' },
      { url: 'https://api.example.com/done', method: 'GET', body: undefined },
      { url: 'https://api.example.com/b', method: 'PUT', body: '{}' },
      { url: 'https://api.example.com/done', method: 'PUT', body: '{}' }
    ])
  })

  it('refuses a 307 or 308 of a write to another origin, sending nothing there', async () => {
    const seen: { url: string, method?: string }[] = []
    const send: Transport = async (url, init) => {
      seen.push({ url: url.href, method: init.method })
      if (url.pathname === '/a') return new Response(null, { status: 307, headers: { location: 'https://cdn.example.com/x?key=sk_test_SECRET123' } })
      if (url.pathname === '/b') return new Response(null, { status: 308, headers: { location: '/c' } })
      if (url.pathname === '/c') return new Response(null, { status: 308, headers: { location: 'http://api.example.com/d' } })
      return new Response('{}')
    }
    await expect(guardedFetch('https://api.example.com/a', { resolve, transport: send, method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'invalid', message: 'The API redirected a write to another site' })
    await expect(guardedFetch('https://api.example.com/b', { resolve, transport: send, method: 'DELETE' })).rejects.toMatchObject({ message: 'The API redirected a write to another site' })
    expect(seen).toEqual([
      { url: 'https://api.example.com/a', method: 'POST' },
      { url: 'https://api.example.com/b', method: 'DELETE' },
      { url: 'https://api.example.com/c', method: 'DELETE' }
    ])
  })

  it('follows a 308 of a write on the same origin, and a 307 of a GET to another one', async () => {
    const seen: { url: string, method?: string, body?: string }[] = []
    const send: Transport = async (url, init) => {
      seen.push({ url: url.href, method: init.method, body: init.body })
      if (url.pathname === '/a') return new Response(null, { status: 308, headers: { location: '/done' } })
      if (url.pathname === '/b') return new Response(null, { status: 307, headers: { location: 'https://cdn.example.com/done' } })
      return new Response('{}')
    }
    await guardedFetch('https://api.example.com/a', { resolve, transport: send, method: 'PATCH', body: '{}' })
    await guardedFetch('https://api.example.com/b', { resolve, transport: send })
    expect(seen).toEqual([
      { url: 'https://api.example.com/a', method: 'PATCH', body: '{}' },
      { url: 'https://api.example.com/done', method: 'PATCH', body: '{}' },
      { url: 'https://api.example.com/b', method: 'GET', body: undefined },
      { url: 'https://cdn.example.com/done', method: 'GET', body: undefined }
    ])
  })

  it('stops after 3 redirects', async () => {
    const { send } = transport({
      'https://api.example.com/1': redirect('/2'),
      'https://api.example.com/2': redirect('/3'),
      'https://api.example.com/3': redirect('/4'),
      'https://api.example.com/4': redirect('/5')
    })
    await expect(guardedFetch('https://api.example.com/1', { resolve, transport: send })).rejects.toMatchObject({ code: 'invalid', message: 'The API redirected more than 3 times' })
  })
})
