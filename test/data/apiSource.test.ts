import { describe, expect, it } from 'vitest'
import { apiUrlProblem, detectItems, inferFields, itemsAt, mapItems } from '#shared/data/apiSource'
import type { ApiField } from '#shared/data/apiSource'

const RICK = {
  id: 1,
  name: 'Rick Sanchez',
  status: 'Alive',
  species: 'Human',
  type: '',
  origin: { name: 'Earth (C-137)', url: 'https://rickandmortyapi.com/api/location/1' },
  image: 'https://rickandmortyapi.com/api/character/avatar/1.jpeg',
  episode: ['https://rickandmortyapi.com/api/episode/1', 'https://rickandmortyapi.com/api/episode/2'],
  created: '2017-11-04T18:48:46.250Z'
}
const MORTY = { ...RICK, id: 2, name: 'Morty Smith', origin: { name: 'unknown', url: '' }, episode: [] }

describe('detectItems', () => {
  it('finds `results` in a Rick and Morty style { info, results } page', () => {
    const json = { info: { count: 826, pages: 42, next: 'https://rickandmortyapi.com/api/character?page=2' }, results: [RICK, MORTY] }
    expect(detectItems(json)).toEqual({ itemsPath: 'results', items: [RICK, MORTY] })
  })

  it('uses a root array with an empty items path', () => {
    expect(detectItems([{ a: 1 }])).toEqual({ itemsPath: '', items: [{ a: 1 }] })
  })

  it('finds `data`, preferring the known names over other arrays', () => {
    expect(detectItems({ tags: ['x'], data: [{ a: 1 }] })).toEqual({ itemsPath: 'data', items: [{ a: 1 }] })
    expect(detectItems({ others: [{ b: 1 }], items: [{ a: 1 }] })).toEqual({ itemsPath: 'items', items: [{ a: 1 }] })
  })

  it('falls back to the first array of objects one level deep', () => {
    expect(detectItems({ count: 2, list: ['a'], users: [{ a: 1 }] })).toEqual({ itemsPath: 'users', items: [{ a: 1 }] })
    expect(detectItems({ payload: { people: [{ a: 1 }] } })).toEqual({ itemsPath: 'payload.people', items: [{ a: 1 }] })
  })

  it('returns null when there is no array of items', () => {
    expect(detectItems({ name: 'Rick', tags: ['a', 'b'] })).toBeNull()
    expect(detectItems('hello')).toBeNull()
    expect(detectItems(null)).toBeNull()
  })
})

describe('itemsAt', () => {
  it('reads the array at a dot path, or the root for an empty path', () => {
    expect(itemsAt({ a: { b: [1, 2] } }, 'a.b')).toEqual([1, 2])
    expect(itemsAt([3], '')).toEqual([3])
    expect(itemsAt({ a: { b: 'x' } }, 'a.b')).toBeUndefined()
    expect(itemsAt({}, 'missing.path')).toBeUndefined()
  })
})

describe('inferFields', () => {
  const fields = inferFields([RICK, MORTY])

  it('proposes typed fields with keys, labels and paths', () => {
    expect(fields).toEqual([
      { key: 'externalId', label: 'External id', type: 'number', path: 'id' },
      { key: 'name', label: 'Name', type: 'text', path: 'name' },
      { key: 'status', label: 'Status', type: 'text', path: 'status' },
      { key: 'species', label: 'Species', type: 'text', path: 'species' },
      { key: 'type', label: 'Type', type: 'text', path: 'type' },
      { key: 'originName', label: 'Origin name', type: 'text', path: 'origin.name' },
      { key: 'originUrl', label: 'Origin url', type: 'text', path: 'origin.url' },
      { key: 'image', label: 'Image', type: 'image', path: 'image' },
      { key: 'episode', label: 'Episode', type: 'text', path: 'episode' },
      { key: 'created', label: 'Created', type: 'date', path: 'created' }
    ])
  })

  it('detects booleans, dates, image URLs and image-like keys', () => {
    const inferred = inferFields([{
      active: true,
      born: '1990-04-01',
      pic: 'https://cdn.example.com/a.PNG?w=200',
      avatar_url: 'https://example.com/u/1',
      website: 'https://example.com/',
      score: 3.5,
      code: '42'
    }])
    expect(Object.fromEntries(inferred.map(f => [f.key, f.type]))).toEqual({
      active: 'boolean',
      born: 'date',
      pic: 'image',
      avatarUrl: 'image',
      website: 'text',
      score: 'number',
      code: 'text'
    })
  })

  it('needs every sampled value to fit a type, ignoring nulls', () => {
    const inferred = inferFields([{ n: 1, d: '2020-01-01' }, { n: 'two', d: null }, { n: null, d: '2020-01-02' }])
    expect(inferred).toEqual([
      { key: 'n', label: 'N', type: 'text', path: 'n' },
      { key: 'd', label: 'D', type: 'date', path: 'd' }
    ])
  })

  it('makes unique camelCase keys that pass the field-key rule and skips arrays of objects', () => {
    const inferred = inferFields([{ 'first_name': 'a', 'firstName': 'b', 'First Name': 'c', '2fa': true, 'ID': 7, 'tags': [{ x: 1 }], 'a.b': 1 }])
    expect(inferred.map(f => [f.key, f.path])).toEqual([
      ['firstName', 'first_name'],
      ['firstName2', 'firstName'],
      ['f2fa', '2fa'],
      ['externalId', 'ID']
    ])
  })

  it('samples at most 20 items', () => {
    const items = [...Array.from({ length: 20 }, () => ({ v: 1 })), { v: 'text', extra: 1 }]
    expect(inferFields(items)).toEqual([{ key: 'v', label: 'V', type: 'number', path: 'v' }])
  })
})

describe('mapItems', () => {
  const fields: ApiField[] = [
    { key: 'name', label: 'Name', type: 'text', path: 'name' },
    { key: 'originName', label: 'Origin', type: 'text', path: 'origin.name' },
    { key: 'image', label: 'Image', type: 'image', path: 'image' },
    { key: 'episode', label: 'Episodes', type: 'text', path: 'episode' },
    { key: 'externalId', label: 'Id', type: 'text', path: 'id' },
    { key: 'missing', label: 'Missing', type: 'text', path: 'nope.deeper' }
  ]

  it('maps items to rows by path, with the item id or the index as id', () => {
    expect(mapItems([{ name: 'No id' }, RICK], fields)).toEqual([
      { id: '0', values: { name: 'No id', originName: null, image: null, episode: null, externalId: null, missing: null } },
      {
        id: '1',
        values: {
          name: 'Rick Sanchez',
          originName: 'Earth (C-137)',
          image: RICK.image,
          episode: 'https://rickandmortyapi.com/api/episode/1, https://rickandmortyapi.com/api/episode/2',
          externalId: '1',
          missing: null
        }
      }
    ])
  })

  it('coerces per type and reads values that do not fit as null', () => {
    const rows = mapItems([{ a: '3.5', b: 'yes', c: 'true', d: 'not a date', e: 'ftp://x/y.png', f: { g: 1 } }], [
      { key: 'a', label: 'A', type: 'number', path: 'a' },
      { key: 'b', label: 'B', type: 'boolean', path: 'b' },
      { key: 'c', label: 'C', type: 'boolean', path: 'c' },
      { key: 'd', label: 'D', type: 'date', path: 'd' },
      { key: 'e', label: 'E', type: 'image', path: 'e' },
      { key: 'f', label: 'F', type: 'text', path: 'f' }
    ])
    expect(rows[0]!.values).toEqual({ a: 3.5, b: null, c: true, d: null, e: null, f: null })
  })

  it('uses the key when a field has no path', () => {
    expect(mapItems([{ title: 'x' }], [{ key: 'title', label: 'Title', type: 'text' }])[0]!.values).toEqual({ title: 'x' })
  })
})

describe('apiUrlProblem', () => {
  it('accepts http(s) URLs on the default and common alternative ports', () => {
    for (const url of ['https://rickandmortyapi.com/api/character', 'http://example.com:8080/x', 'https://example.com:8443', 'https://example.com:443/']) {
      expect(apiUrlProblem(url), url).toBeUndefined()
    }
  })

  it('refuses other schemes, credentials, other ports and malformed URLs', () => {
    expect(apiUrlProblem('file:///etc/passwd')).toBe('Only http and https URLs can be fetched')
    expect(apiUrlProblem('ftp://example.com/a')).toBe('Only http and https URLs can be fetched')
    expect(apiUrlProblem('https://user:pass@example.com/')).toBe('URLs with a user name or password are not allowed')
    expect(apiUrlProblem('http://example.com:3000/')).toBe('Port 3000 is not allowed; use 80, 443, 8080 or 8443')
    expect(apiUrlProblem('not a url')).toBe('Invalid URL')
  })
})
