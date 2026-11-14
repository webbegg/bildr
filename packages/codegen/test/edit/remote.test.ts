// P3c: what datasource_preview and repository_endpoint_test compute from a REST response, without fetching.
import { describe, expect, it } from 'vitest'
import { detectItems, inferFields, remoteUrl } from '../../src/edit/index'

describe('remoteUrl: a request stays under the data source\'s base URL', () => {
  it('joins relative paths under the base path', () => {
    expect(remoteUrl('https://api.example.com/v1', '/posts')).toEqual({ ok: true, url: 'https://api.example.com/v1/posts' })
    expect(remoteUrl('https://api.example.com/v1/', 'posts?limit=2')).toEqual({ ok: true, url: 'https://api.example.com/v1/posts?limit=2' })
    expect(remoteUrl('http://127.0.0.1:4010', '/tasks/7')).toEqual({ ok: true, url: 'http://127.0.0.1:4010/tasks/7' })
  })

  it.each([
    ['https://evil.example.com/x', 'Use a path relative to the data source\'s base URL, like "/posts"'],
    ['//evil.example.com/x', 'Use a path relative to the data source\'s base URL, like "/posts"'],
    ['/../admin', 'The path can\'t leave the data source\'s base URL'],
    ['/%2e%2e/admin', 'The path can\'t leave the data source\'s base URL'],
    ['/a\\b', 'Use a path relative to the data source\'s base URL, like "/posts"'],
    ['/posts#x', 'Use a path relative to the data source\'s base URL, like "/posts"']
  ])('refuses %s', (path, message) => {
    expect(remoteUrl('https://api.example.com/v1', path)).toEqual({ ok: false, message })
  })

  it('refuses a base URL that isn\'t http(s) or holds credentials', () => {
    expect(remoteUrl('file:///etc', '/passwd')).toEqual({ ok: false, message: 'The data source\'s base URL must be http or https' })
    expect(remoteUrl('https://u:p@api.example.com', '/x')).toEqual({ ok: false, message: 'The data source\'s base URL can\'t hold a user name or password' })
    expect(remoteUrl('', '/x')).toEqual({ ok: false, message: 'The data source has no base URL: set it in the model (defaults.baseUrl) or its env var' })
  })
})

describe('detectItems and inferFields (ported from the hosted api sources)', () => {
  it('finds the items: a known key, the root array, or the first array of objects', () => {
    expect(detectItems({ items: [{ a: 1 }], total: 1 })).toEqual({ itemsPath: 'items', items: [{ a: 1 }] })
    expect(detectItems([{ a: 1 }])).toEqual({ itemsPath: '', items: [{ a: 1 }] })
    expect(detectItems({ quotes: [{ a: 1 }], total: 1 })).toEqual({ itemsPath: 'quotes', items: [{ a: 1 }] })
    expect(detectItems({ id: 1 })).toBeNull()
  })

  it('proposes model fields with their types and remote keys, keeping "id" as the key', () => {
    const fields = inferFields([
      { id: 1, full_name: 'Ada', score: 9.5, visits: 3, active: true, born: '1815-12-10', seen: '2026-01-01T10:00:00Z', ref: '6f1c2d3e-4b5a-4c6d-8e7f-000000000001', avatar: 'https://x.example.com/a.png', tags: ['a'], address: { city: 'London' } },
      { id: 2, full_name: 'Grace', score: 8, visits: 1, active: false, born: '1906-12-09', seen: '2026-01-02T10:00:00Z', ref: '6f1c2d3e-4b5a-4c6d-8e7f-000000000002', avatar: 'https://x.example.com/g.png', tags: [], address: { city: 'NYC' } }
    ])
    expect(fields).toEqual([
      { name: 'id', type: 'integer', remote: 'id' },
      { name: 'fullName', type: 'text', remote: 'full_name' },
      { name: 'score', type: 'number', remote: 'score' },
      { name: 'visits', type: 'integer', remote: 'visits' },
      { name: 'active', type: 'boolean', remote: 'active' },
      { name: 'born', type: 'date', remote: 'born' },
      { name: 'seen', type: 'datetime', remote: 'seen' },
      { name: 'ref', type: 'uuid', remote: 'ref' },
      { name: 'avatar', type: 'image', remote: 'avatar' }
    ])
  })
})
