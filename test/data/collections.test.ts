import { describe, expect, it } from 'vitest'
import { collectionCaps, defaultEndpoint, takesFormRecords, uniqueCollectionName } from '#shared/data/collections'

describe('uniqueCollectionName', () => {
  it('keeps the name when no collection has its slug', () => {
    expect(uniqueCollectionName('Untitled', [{ slug: 'menu' }])).toBe('Untitled')
  })

  it('numbers the name from 2 until its slug is free', () => {
    expect(uniqueCollectionName('Untitled', [{ slug: 'untitled' }])).toBe('Untitled 2')
    expect(uniqueCollectionName('Untitled', [{ slug: 'untitled' }, { slug: 'untitled-2' }, { slug: 'untitled-4' }])).toBe('Untitled 3')
  })
})

const list = { method: 'GET' as const, path: '/posts' }
const connection = (endpoints: Record<string, unknown>) => ({ source: { type: 'connection' as const, connectionId: 'con_1', endpoints } })

describe('collectionCaps', () => {
  it('lets internal collections do everything, stored in bildr', () => {
    expect(collectionCaps({ source: { type: 'internal' } })).toEqual({ create: true, update: true, delete: true, get: true, live: false })
  })

  it('keeps API collections read-only and live', () => {
    expect(collectionCaps({ source: { type: 'api', url: 'https://example.com/api', itemsPath: '' } })).toEqual({ create: false, update: false, delete: false, get: true, live: true })
  })

  it('gives connection collections the operations they have endpoints for', () => {
    expect(collectionCaps(connection({ list }))).toEqual({ create: false, update: false, delete: false, get: true, live: true })
    expect(collectionCaps(connection({
      list,
      create: { method: 'POST', path: '/posts' },
      update: { method: 'PATCH', path: '/posts/{id}' },
      delete: { method: 'DELETE', path: '/posts/{id}' }
    }))).toEqual({ create: true, update: true, delete: true, get: true, live: true })
    expect(collectionCaps(connection({ update: { method: 'PUT', path: '/posts/{id}' } }))).toEqual({ create: false, update: true, delete: false, get: false, live: true })
  })

  it('opens a record through the get endpoint, or the list', () => {
    expect(collectionCaps(connection({ get: { method: 'GET', path: '/posts/{id}' } })).get).toBe(true)
    expect(collectionCaps(connection({})).get).toBe(false)
  })
})

describe('takesFormRecords', () => {
  it('takes internal collections and connection collections with a create endpoint', () => {
    expect(takesFormRecords({ source: { type: 'internal' } })).toBe(true)
    expect(takesFormRecords(connection({ list, create: { method: 'POST', path: '/posts' } }))).toBe(true)
    expect(takesFormRecords(connection({ list }))).toBe(false)
    expect(takesFormRecords({ source: { type: 'api' } })).toBe(false)
  })

  it('takes a visitor\'s connection collection, whose endpoints the snapshot strips', () => {
    expect(takesFormRecords({ source: { type: 'connection' } })).toBe(true)
  })
})

describe('defaultEndpoint', () => {
  it('derives each operation from the list path, Framer-style REST defaults', () => {
    expect(defaultEndpoint('get', '/posts')).toEqual({ method: 'GET', path: '/posts/{id}' })
    expect(defaultEndpoint('create', '/posts')).toEqual({ method: 'POST', path: '/posts' })
    expect(defaultEndpoint('update', '/posts')).toEqual({ method: 'PATCH', path: '/posts/{id}' })
    expect(defaultEndpoint('delete', '/posts')).toEqual({ method: 'DELETE', path: '/posts/{id}' })
    expect(defaultEndpoint('list', '/posts')).toEqual({ method: 'GET', path: '/posts' })
  })

  it('drops the list query and trailing slashes', () => {
    expect(defaultEndpoint('get', '/posts/?userId=1')).toEqual({ method: 'GET', path: '/posts/{id}' })
    expect(defaultEndpoint('create', 'v1/posts/')).toEqual({ method: 'POST', path: '/v1/posts' })
  })

  it('works from the base URL without a list', () => {
    expect(defaultEndpoint('get', undefined)).toEqual({ method: 'GET', path: '/{id}' })
    expect(defaultEndpoint('create', '')).toEqual({ method: 'POST', path: '/' })
    expect(defaultEndpoint('list', undefined)).toEqual({ method: 'GET', path: '/' })
  })
})
