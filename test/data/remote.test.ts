import { describe, expect, it } from 'vitest'
import { bodyFor, buildEndpointUrl, endpointPathProblem, readItem, readItems, remoteRows } from '#shared/data/remote'
import type { Field } from '#shared/document/schema'

const FIELDS: Field[] = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'author', label: 'Author', type: 'text', path: 'author.name' },
  { key: 'userId', label: 'User', type: 'number' }
]

describe('buildEndpointUrl', () => {
  it('joins the base and the path with exactly one slash', () => {
    expect(buildEndpointUrl('https://api.example.com', '/posts')).toBe('https://api.example.com/posts')
    expect(buildEndpointUrl('https://api.example.com/', 'posts')).toBe('https://api.example.com/posts')
    expect(buildEndpointUrl('https://api.example.com/v1/', '/posts')).toBe('https://api.example.com/v1/posts')
    expect(buildEndpointUrl('https://api.example.com/v1', 'posts/')).toBe('https://api.example.com/v1/posts/')
    expect(buildEndpointUrl('https://api.example.com/v1', '')).toBe('https://api.example.com/v1')
  })

  it('encodes the record id', () => {
    expect(buildEndpointUrl('https://api.example.com', '/posts/{id}', { id: 'a b/c?d' })).toBe('https://api.example.com/posts/a%20b%2Fc%3Fd')
    expect(buildEndpointUrl('https://api.example.com', '/posts/{id}/comments', { id: '7' })).toBe('https://api.example.com/posts/7/comments')
  })

  it('keeps the base query and adds the path query', () => {
    expect(buildEndpointUrl('https://api.example.com/v1?key=1', '/posts?page=2')).toBe('https://api.example.com/v1/posts?key=1&page=2')
  })

  it('refuses paths that leave the base origin or path', () => {
    for (const path of ['//evil.com/x', 'https://evil.com', '/https://evil.com/x', 'HTTP://evil.com/x', 'javascript:alert(1)', '/../admin', '/posts/../../x', '/%2e%2e/x', '/posts/.', '\\\\evil.com', '/a\\b', '/a b', '/a#b']) {
      expect(() => buildEndpointUrl('https://api.example.com/v1', path), path).toThrow()
      expect(endpointPathProblem(path), path).toBeTruthy()
    }
  })

  it('refuses an id that is a dot segment and a path that needs a missing id', () => {
    expect(() => buildEndpointUrl('https://api.example.com', '/posts/{id}', { id: '..' })).toThrow('Invalid record id')
    expect(() => buildEndpointUrl('https://api.example.com', '/posts/{id}')).toThrow('needs a record id')
  })

  it('accepts env refs and {id} in a stored path', () => {
    expect(endpointPathProblem('/posts/{id}?key={{ env.KEY }}')).toBeUndefined()
    expect(endpointPathProblem('/{{ env.VERSION }}/posts')).toBeUndefined()
  })
})

describe('bodyFor', () => {
  it('maps values by field path (dot paths nest) or by key, skipping values not given', () => {
    expect(bodyFor(FIELDS, { title: 'Hi', author: 'Ana' })).toEqual({ title: 'Hi', author: { name: 'Ana' } })
    expect(bodyFor(FIELDS, { userId: 3, unknown: 'x' })).toEqual({ userId: 3 })
  })

  it('never writes to the prototype', () => {
    const body = bodyFor([{ key: 'x', label: 'X', type: 'text', path: '__proto__.polluted' }], { x: 'yes' })
    expect(JSON.stringify(body)).toBe('{"__proto__":{"polluted":"yes"}}')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('readItems and readItem', () => {
  it('reads the items at itemsPath and one item at itemPath', () => {
    expect(readItems({ data: { posts: [{ id: 1 }] } }, 'data.posts')).toEqual([{ id: 1 }])
    expect(readItems([{ id: 1 }], undefined)).toEqual([{ id: 1 }])
    expect(readItems({ data: 1 }, 'data')).toBeUndefined()
    expect(readItem({ data: { id: 2 } }, 'data')).toEqual({ id: 2 })
    expect(readItem({ id: 3 }, undefined)).toEqual({ id: 3 })
    expect(readItem([1], '')).toBeUndefined()
  })

  it('maps items to rows with the id read at idPath', () => {
    const items = [{ uuid: 'u1', title: 'A', author: { name: 'Ana' }, userId: 1 }, { title: 'B' }]
    expect(remoteRows(items, FIELDS, 'uuid')).toEqual([
      { id: 'u1', values: { title: 'A', author: 'Ana', userId: 1 } },
      { id: '1', values: { title: 'B', author: null, userId: null } }
    ])
    expect(remoteRows([{ id: 5, title: 'C' }], FIELDS)[0]!.id).toBe('5')
  })
})
