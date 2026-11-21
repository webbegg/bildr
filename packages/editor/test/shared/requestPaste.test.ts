import { describe, expect, it } from 'vitest'
import { readPastedRequest, shellWords } from '../../src/shared/requestPaste.ts'

/**
 * Pasting a request into the path of an API query or action (api-calls R1, S3): a full URL under the API's base URL, or a cURL command,
 * read into what the editor can hold — the path, the method, the query parameters (with a guessed type and the value as a test value)
 * and the body to try — and what was left out, and why. Text that is neither is not a request (null): it pastes as usual.
 */

const BASE = 'https://api.example.com/v1'
const ok = (text: string, baseUrl = BASE, signIn?: string) => {
  const read = readPastedRequest(text, baseUrl, signIn)
  if (!read || !read.ok) throw new Error(`not read: ${JSON.stringify(read)}`)
  return read.request
}

describe('a pasted URL', () => {
  it('is the path under the base URL, with one query parameter per key of its query string, typed by its value', () => {
    expect(ok('https://api.example.com/v1/products?per_page=20&q=lamp&inStock=true&min=2.5&code=007')).toEqual({
      from: 'url',
      method: 'GET',
      path: '/products',
      query: [
        { name: 'perPage', key: 'per_page', type: 'integer', value: '20' },
        { name: 'q', key: 'q', type: 'text', value: 'lamp' },
        { name: 'inStock', key: 'inStock', type: 'boolean', value: 'true' },
        { name: 'min', key: 'min', type: 'number', value: '2.5' },
        { name: 'code', key: 'code', type: 'text', value: '007' }
      ],
      notes: []
    })
  })

  it('is / for the base URL itself, and keeps the first value of a key given twice', () => {
    expect(ok('https://api.example.com/v1?a=1&a=2')).toMatchObject({ path: '/', query: [{ name: 'a', key: 'a', type: 'integer', value: '1' }] })
    expect(ok('https://api.example.com/v1/')).toMatchObject({ path: '/', query: [] })
  })

  it('names a key that is not a word as one (page[size] → pageSize) and never twice', () => {
    expect(ok(`${BASE}/x?page[size]=5&page_size=6&1st=a`).query.map(entry => [entry.name, entry.key])).toEqual([['pageSize', 'page[size]'], ['pageSize2', 'page_size'], ['param1st', '1st']])
  })

  it('keeps the parameter of a value that looks like a secret, but not its value', () => {
    const read = ok(`${BASE}/weather?city=Oslo&api_key=sk-123&access_token=abc`)
    expect(read.query).toEqual([
      { name: 'city', key: 'city', type: 'text', value: 'Oslo' },
      { name: 'apiKey', key: 'api_key', type: 'text', value: '' },
      { name: 'accessToken', key: 'access_token', type: 'text', value: '' }
    ])
    expect(read.notes).toEqual(['Left out the values of “api_key” and “access_token”: they look like secrets. A secret goes in the API\'s sign-in, never in a query.'])
  })

  it('is refused when it is not under the base URL, saying what the base URL is', () => {
    expect(readPastedRequest('https://other.example.com/v1/products', BASE)).toEqual({ ok: false, problem: 'That URL is not under the API\'s base URL, https://api.example.com/v1' })
    expect(readPastedRequest('https://api.example.com/v2/products', BASE)).toMatchObject({ ok: false })
    expect(readPastedRequest('https://api.example.com/v10/products', BASE)).toMatchObject({ ok: false })
  })

  it('is not a request when the text is a path or words: it pastes as usual', () => {
    expect(readPastedRequest('/products/:id', BASE)).toBeNull()
    expect(readPastedRequest('products', BASE)).toBeNull()
    expect(readPastedRequest('', BASE)).toBeNull()
  })

  it('drops the fragment', () => {
    expect(ok(`${BASE}/docs#top`)).toMatchObject({ path: '/docs', query: [] })
  })
})

describe('a pasted cURL command', () => {
  it('reads the method, the URL, the headers and a JSON body, across lines and quotes', () => {
    const read = ok([
      'curl -X POST \'https://api.example.com/v1/products?draft=true\' \\',
      '  -H "Content-Type: application/json" \\',
      '  -H \'X-Trace: abc\' \\',
      '  --data-raw \'{"title":"Lamp","price":3.5}\''
    ].join('\n'))
    expect(read).toEqual({
      from: 'curl',
      method: 'POST',
      path: '/products',
      query: [{ name: 'draft', key: 'draft', type: 'boolean', value: 'true' }],
      headers: [{ name: 'X-Trace', value: 'abc' }],
      body: '{\n  "title": "Lamp",\n  "price": 3.5\n}',
      notes: []
    })
  })

  it('keeps the headers a call can send (api-calls R2), and leaves out one that looks like a secret or that a call can\'t send', () => {
    const read = ok(`curl ${BASE}/items -H 'X-Api-Version: 2' -H 'X-Auth-Token: abc' -H 'X-Client: sk_live_4eC39HqLyjWDarjtT1zdp7dc' -H 'Origin: https://x.com' -H 'X-Note: a b'`)
    expect(read.headers).toEqual([{ name: 'X-Api-Version', value: '2' }, { name: 'X-Note', value: 'a b' }])
    expect(read.notes).toEqual(['Left out the headers “X-Auth-Token”, “X-Client” and “Origin”: a secret belongs in the API\'s sign-in, and the app sends some headers itself.'])
  })

  it('keeps an Accept that is not the JSON one, and skips a header with no value without calling it a secret (review R3-002, R3-008)', () => {
    expect(ok(`curl ${BASE}/items -H 'Accept: application/vnd.api+json'`).headers).toEqual([{ name: 'Accept', value: 'application/vnd.api+json' }])
    expect(ok(`curl ${BASE}/items -H 'Accept: application/json' -H 'accept: */*'`).headers ?? []).toEqual([])
    const empty = ok(`curl ${BASE}/items -H 'X-Empty:'`)
    expect(empty.headers ?? []).toEqual([])
    expect(empty.notes).toEqual([])
  })

  it('leaves out a key after a scheme word, and a header that says it signs in (verify B1)', () => {
    const read = ok(`curl ${BASE}/items -H 'X-Client: Key sk_live_4eC39HqLyjWDarjtT1zdp7dc' -H 'X-Authorization: abc123secret'`)
    expect(read.headers ?? []).toEqual([])
    expect(read.notes[0]).toContain('“X-Client” and “X-Authorization”')
    expect(read.notes.join(' ')).not.toContain('sk_live')
  })

  it('is a POST when it has data and no method, and a GET with -G, the data going in the query', () => {
    expect(ok(`curl ${BASE}/items -d '{"a":1}'`)).toMatchObject({ method: 'POST', body: '{\n  "a": 1\n}' })
    expect(ok(`curl -G ${BASE}/search --data-urlencode 'q=red lamp' -d limit=5`)).toMatchObject({
      method: 'GET',
      path: '/search',
      query: [{ name: 'q', key: 'q', type: 'text', value: 'red lamp' }, { name: 'limit', key: 'limit', type: 'integer', value: '5' }]
    })
    expect(ok(`curl --json '{"a":1}' ${BASE}/items`)).toMatchObject({ method: 'POST', body: '{\n  "a": 1\n}' })
  })

  it('takes -XPUT, --request=PATCH, --url and flags it does not need', () => {
    expect(ok(`curl -sSL -XPUT ${BASE}/items/1`)).toMatchObject({ method: 'PUT', path: '/items/1' })
    expect(ok(`curl --request=PATCH --url ${BASE}/items/1 --compressed -A 'agent x' -o out.json`)).toMatchObject({ method: 'PATCH', path: '/items/1' })
    expect(ok(`curl -X delete ${BASE}/items/1`)).toMatchObject({ method: 'DELETE' })
  })

  it('never keeps a sign-in: the Authorization header, the API\'s own key header, cookies and -u are left out, saying why', () => {
    const read = ok(`curl ${BASE}/me -H 'Authorization: Bearer sk-live-1' -H 'x-api-key: k-2' -H 'Cookie: s=3' -u me:pw`, BASE, 'X-Api-Key')
    expect(JSON.stringify(read)).not.toMatch(/sk-live-1|k-2|s=3|me:pw/)
    expect(read.notes).toEqual(['Left out the sign-in (Authorization, x-api-key, Cookie, -u): the API\'s sign-in sends its secret, so it never sits in the model.'])
  })

  it('keeps a body that is not JSON as it is, saying only JSON is sent', () => {
    const read = ok(`curl ${BASE}/form -d 'a=1&b=2'`)
    expect(read).toMatchObject({ method: 'POST', body: 'a=1&b=2' })
    expect(read.notes).toContain('The body is not JSON: an API action sends JSON only.')
  })

  it('is refused for a form upload, a URL off the base or no URL at all', () => {
    expect(readPastedRequest(`curl -F file=@a.png ${BASE}/upload`, BASE)).toEqual({ ok: false, problem: 'Form uploads (-F) can\'t be sent by an API action yet' })
    expect(readPastedRequest('curl https://evil.example.com/x', BASE)).toMatchObject({ ok: false, problem: expect.stringContaining('not under the API\'s base URL') })
    expect(readPastedRequest('curl -X POST', BASE)).toEqual({ ok: false, problem: 'The cURL command has no URL' })
  })
})

describe('shell words', () => {
  it('splits like a shell: quotes, escapes and line continuations', () => {
    expect(shellWords(`a 'b c' "d \\"e\\"" f\\ g \\\n h`)).toEqual(['a', 'b c', 'd "e"', 'f g', 'h'])
    expect(shellWords(`'it'"'"'s'`)).toEqual(['it\'s'])
  })
})
