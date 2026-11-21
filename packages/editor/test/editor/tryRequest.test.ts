import { afterEach, describe, expect, it } from 'vitest'
import { clearTryValues, durationLabel, loadTryValues, resolvedRequest, sizeLabel, storeTryValues } from '../../src/editor/tryRequest.ts'
import { newParam, operationDraftOf } from '../../src/editor/simpleApiDraft.ts'

/**
 * Try it's request and answer (api-calls T1, S5): the request as it will be sent, before it is (the method, the full URL, the headers with
 * the sign-in masked, the body); how long the answer took and how big it was, in words; and the values to try an operation with, kept in
 * this browser per operation, never a secret.
 */

const SOURCE = { id: 'ds_shop', baseUrl: 'https://api.example.com/v1/', runtime: 'server' as const, auth: { type: 'bearer' as const, secret: 'apiKey' } }
const byId = () => operationDraftOf('query', { name: 'productById', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }, { name: 'lang', in: 'query', type: 'text', key: 'l' }, { name: 'draft', in: 'query', type: 'boolean' }], result: { model: 'Product', many: false } } as never)

describe('the request as it will be sent', () => {
  it('is the base URL and the path with its parameters filled in, encoded, the others in the query by their key', () => {
    expect(resolvedRequest(SOURCE, byId(), { id: '7', lang: 'en gb', draft: true }, '')).toEqual({
      method: 'GET',
      url: 'https://api.example.com/v1/products/7?l=en+gb&draft=true',
      headers: [{ name: 'Accept', value: 'application/json' }, { name: 'Authorization', value: 'Bearer ••••', masked: true }],
      missing: [],
      signIn: 'sent'
    })
  })

  it('keeps a path parameter with no value as it is, and says it is missing', () => {
    const read = resolvedRequest(SOURCE, byId(), {}, '')
    expect(read.url).toBe('https://api.example.com/v1/products/:id')
    expect(read.missing).toEqual(['id'])
  })

  it('is an action\'s method, with its body and the JSON content type when there is one', () => {
    const draft = operationDraftOf('action', null)
    draft.method = 'PUT'
    draft.path = '/products/1'
    const read = resolvedRequest({ ...SOURCE, auth: { type: 'header' as const, header: 'X-Api-Key', secret: 'apiKey' } }, draft, {}, '{"title":"Lamp"}')
    expect(read).toMatchObject({ method: 'PUT', url: 'https://api.example.com/v1/products/1', body: '{"title":"Lamp"}' })
    expect(read.headers).toEqual([
      { name: 'Accept', value: 'application/json' },
      { name: 'Content-Type', value: 'application/json' },
      { name: 'X-Api-Key', value: '••••', masked: true }
    ])
    draft.method = 'DELETE'
    expect(resolvedRequest(SOURCE, draft, {}, '{"a":1}').body).toBeUndefined()
  })

  it('sends the call\'s own headers (api-calls R2): its accept instead of the JSON one, a header parameter once it has a value', () => {
    const draft = operationDraftOf('query', {
      name: 'products', path: '/products',
      params: [{ name: 'tenant', in: 'header', type: 'text', key: 'X-Tenant' }],
      headers: [{ name: 'X-Api-Version', value: '2' }, { name: 'accept', value: 'application/vnd.api+json' }],
      result: { model: 'Product', many: true }
    } as never)
    expect(resolvedRequest(SOURCE, draft, { tenant: 'acme' }, '').headers).toEqual([
      { name: 'accept', value: 'application/vnd.api+json' },
      { name: 'X-Api-Version', value: '2' },
      { name: 'X-Tenant', value: 'acme' },
      { name: 'Authorization', value: 'Bearer ••••', masked: true }
    ])
    expect(resolvedRequest(SOURCE, draft, {}, '').headers.map(header => header.name)).toEqual(['accept', 'X-Api-Version', 'Authorization'])
    expect(resolvedRequest(SOURCE, draft, { tenant: 'acme' }, '').url).toBe('https://api.example.com/v1/products')
  })

  it('has no sign-in for an API with none, nor for one the browser calls (it has no secret there)', () => {
    expect(resolvedRequest({ ...SOURCE, auth: undefined }, byId(), { id: '1' }, '')).toMatchObject({ headers: [{ name: 'Accept', value: 'application/json' }], signIn: 'none' })
    expect(resolvedRequest({ ...SOURCE, runtime: 'browser' as const }, byId(), { id: '1' }, '')).toMatchObject({ headers: [{ name: 'Accept', value: 'application/json' }], signIn: 'browser' })
  })
})

describe('the answer in words', () => {
  it('says the size in B, KB or MB, and the time in ms or s', () => {
    expect([0, 512, 1234, 99_999, 2_500_000].map(sizeLabel)).toEqual(['0 B', '512 B', '1.2 KB', '100 KB', '2.5 MB'])
    expect([0, 87, 999, 1500, 10_000].map(durationLabel)).toEqual(['0 ms', '87 ms', '999 ms', '1.5 s', '10 s'])
  })
})

describe('the values to try with, kept in this browser', () => {
  afterEach(clearTryValues)
  const key = { datasource: 'ds_shop', kind: 'query' as const, name: 'productById' }

  it('come back for the same operation only', () => {
    storeTryValues(key, byId(), { values: { id: '7', lang: 'en' }, body: '' })
    expect(loadTryValues(key)).toEqual({ values: { id: '7', lang: 'en' }, body: '' })
    expect(loadTryValues({ ...key, name: 'products' })).toEqual({ values: {}, body: '' })
    expect(loadTryValues({ ...key, datasource: 'ds_other' })).toEqual({ values: {}, body: '' })
  })

  it('never keep a value that looks like a secret, nor a body that holds one', () => {
    const draft = byId()
    draft.params.push({ ...newParam(), name: 'apiKey' }, { ...newParam(), name: 'q', remote: 'access_token' })
    storeTryValues(key, draft, { values: { id: '7', apiKey: 'k-1', q: 't-2' }, body: '{"user":"me","password":"pw"}' })
    expect(loadTryValues(key)).toEqual({ values: { id: '7' }, body: '' })
    storeTryValues(key, draft, { values: {}, body: '{"title":"Lamp","nested":[{"x":1}]}' })
    expect(loadTryValues(key).body).toBe('{"title":"Lamp","nested":[{"x":1}]}')
    storeTryValues(key, draft, { values: {}, body: '{"a":{"client_secret":"s"}}' })
    expect(loadTryValues(key).body).toBe('')
  })

  it('are none when what is kept is not what was stored', () => {
    localStorage.setItem('bildr:try:ds_shop:query:productById', '{"values":[1],"body":3}')
    expect(loadTryValues(key)).toEqual({ values: {}, body: '' })
    localStorage.setItem('bildr:try:ds_shop:query:productById', 'nope')
    expect(loadTryValues(key)).toEqual({ values: {}, body: '' })
    localStorage.setItem('bildr:try:ds_shop:query:productById', '{"values":{"id":"7","x":{"y":1},"on":true},"body":"b"}')
    expect(loadTryValues(key)).toEqual({ values: { id: '7', on: true }, body: 'b' })
  })

  it('are forgotten when there is nothing left to keep', () => {
    storeTryValues(key, byId(), { values: { id: '7' }, body: '' })
    storeTryValues(key, byId(), { values: { id: '' }, body: '  ' })
    expect(localStorage.getItem('bildr:try:ds_shop:query:productById')).toBeNull()
  })
})
