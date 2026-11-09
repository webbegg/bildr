import { describe, expect, it } from 'vitest'
import type { DataRecord } from '#shared/data/records'
import { createCollection, createProject } from '#shared/document/factory'
import type { PublishedSnapshot } from '#shared/document/schema'
import { publicCollection, publicRecords } from '../../server/utils/publicData'

function snapshot(publicRead: boolean): PublishedSnapshot {
  const project = createProject('Café')
  const menu = createCollection('Menu', 'menu', [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'price', label: 'Price', type: 'number' }
  ])
  project.collections.push({ ...menu, publicRead }, createCollection('Messages', 'messages'))
  return { project, publishedAt: '2026-11-09T10:00:00Z' }
}

const stored: DataRecord[] = Array.from({ length: 150 }, (_, i) => ({
  id: `r${i}`,
  createdAt: '2026-11-09T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
  values: { name: `Item ${i}`, price: i % 10, internal: 'secret' }
}))

describe('publicCollection', () => {
  it('finds a publicRead collection of the published snapshot by slug', () => {
    expect(publicCollection(snapshot(true), 'menu')?.slug).toBe('menu')
  })

  it('hides private, unknown and unpublished collections', () => {
    expect(publicCollection(snapshot(false), 'menu')).toBeUndefined()
    expect(publicCollection(snapshot(true), 'messages')).toBeUndefined()
    expect(publicCollection(snapshot(true), 'nope')).toBeUndefined()
    expect(publicCollection(undefined, 'menu')).toBeUndefined()
  })
})

describe('publicRecords', () => {
  const menu = publicCollection(snapshot(true), 'menu')!

  it('returns only the declared fields with id and timestamps', () => {
    const result = publicRecords(menu, stored, { limit: '1' })
    expect(result).toEqual({
      total: 150,
      records: [{ id: 'r0', createdAt: '2026-11-09T10:00:00Z', updatedAt: '2026-11-09T10:00:00Z', values: { name: 'Item 0', price: 0 } }]
    })
  })

  it('caps the page at 100 records', () => {
    expect((publicRecords(menu, stored, {}) as { records: DataRecord[] }).records).toHaveLength(100)
    expect((publicRecords(menu, stored, { limit: '500' }) as { records: DataRecord[] }).records).toHaveLength(100)
  })

  it('filters with typed values, sorts and pages', () => {
    const result = publicRecords(menu, stored, { 'filter[price]': '3', 'sort': 'name', 'dir': 'desc', 'limit': '2', 'offset': '2' })
    expect(result).toMatchObject({ total: 15, records: [{ values: { name: 'Item 73' } }, { values: { name: 'Item 63' } }] })
  })

  it('reports bad queries', () => {
    expect(publicRecords(menu, stored, { sort: 'internal' })).toEqual({ problem: 'Cannot sort by "internal": not a field of "Menu"' })
    expect(publicRecords(menu, stored, { 'filter[internal]': 'secret' })).toEqual({ problem: 'Unknown field "internal"' })
    expect(publicRecords(menu, stored, { 'filter[price]': 'cheap' })).toEqual({ problem: '"price" must be a number' })
  })
})
