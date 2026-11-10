import { describe, expect, it } from 'vitest'
import { createLatestGuard, openRecordView } from '#shared/data/openRecord'
import type { DataRecord, RecordValue } from '#shared/data/records'

function record(id: string, values: Record<string, RecordValue>, updatedAt = '2026-11-10T00:00:00.000Z'): DataRecord {
  return { id, createdAt: '2026-11-10T00:00:00.000Z', updatedAt, values }
}

describe('createLatestGuard', () => {
  it('only the latest request is current', () => {
    const guard = createLatestGuard()
    const first = guard.start()
    const second = guard.start()
    expect(guard.isLatest(first)).toBe(false)
    expect(guard.isLatest(second)).toBe(true)
  })

  it('a slow first answer after a second open is stale', () => {
    const guard = createLatestGuard()
    const a = guard.start()
    const b = guard.start()
    const applied: string[] = []
    for (const [token, id] of [[b, 'b'], [a, 'a']] as const) if (guard.isLatest(token)) applied.push(id)
    expect(applied).toEqual(['b'])
  })
})

describe('openRecordView', () => {
  const row = record('r1', { title: 'From list', body: null, userId: 1 })

  it('shows the list row until a fetch arrives', () => {
    expect(openRecordView(row, null)).toBe(row)
  })

  it('shows the fetched record over the list row', () => {
    const fetched = record('r1', { title: 'From get', body: 'Body', userId: 1 }, '2026-11-11T00:00:00.000Z')
    expect(openRecordView(row, fetched)).toEqual(fetched)
  })

  it('fills fields the fetched record lacks from the list row', () => {
    const fetched = record('r1', { title: 'From get', body: 'Body' })
    expect(openRecordView(row, fetched).values).toEqual({ title: 'From get', body: 'Body', userId: 1 })
  })

  it('keeps list values the fetched record has empty', () => {
    const fetched = record('r1', { title: null, body: 'Body', userId: 1 })
    expect(openRecordView(row, fetched).values.title).toBe('From list')
  })

  it('ignores a fetched record of another id', () => {
    expect(openRecordView(row, record('r2', { title: 'Other' }))).toBe(row)
  })
})
