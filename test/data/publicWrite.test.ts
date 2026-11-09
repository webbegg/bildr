import { describe, expect, it } from 'vitest'
import { MAX_RECORDS_PER_COLLECTION } from '#shared/data/records'
import type { DataRecord } from '#shared/data/records'
import { createCollection, createProject } from '#shared/document/factory'
import type { Collection, PublishedSnapshot } from '#shared/document/schema'
import { createPublicRecord } from '../../server/utils/publicData'
import { createRecordStore } from '../../server/utils/recordStore'
import { memoryStorage } from '../helpers'

const NOW = new Date('2026-11-09T15:00:00Z')

function snapshot(patch: Partial<Collection> = {}): PublishedSnapshot {
  const project = createProject('Café')
  const messages = createCollection('Messages', 'messages', [
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'guests', label: 'Guests', type: 'number' }
  ])
  project.collections.push({ ...messages, publicCreate: true, ...patch })
  return { project, publishedAt: '2026-11-09T10:00:00Z' }
}

async function submit(snap: PublishedSnapshot, body: unknown, slug = 'messages') {
  const store = createRecordStore(memoryStorage())
  const result = await createPublicRecord({ snapshot: snap, collectionSlug: slug, body, store, now: NOW })
  const collection = snap.project.collections[0]!
  return { result, stored: await store.list(snap.project.id, collection.id), store }
}

describe('createPublicRecord', () => {
  it('stores the submitted values of a publicCreate collection and returns the record', async () => {
    const { result, stored } = await submit(snapshot(), { values: { email: 'ana@example.com', guests: '2' } })
    expect(result).toMatchObject({ ok: true, record: { createdAt: NOW.toISOString(), values: { email: 'ana@example.com', guests: 2 } } })
    expect(stored).toHaveLength(1)
    expect(stored[0]!.id).toBe((result as { record: DataRecord }).record.id)
  })

  it('refuses collections the published snapshot does not mark publicCreate, and unknown ones', async () => {
    for (const [snap, slug] of [[snapshot({ publicCreate: false }), 'messages'], [snapshot(), 'nope']] as const) {
      const { result, stored } = await submit(snap, { values: { email: 'x' } }, slug)
      expect(result).toEqual({ ok: false, status: 404, message: 'Collection not found' })
      expect(stored).toEqual([])
    }
  })

  it('refuses API collections even when marked publicCreate', async () => {
    const api = snapshot({ source: { type: 'api', url: 'https://example.com/items', itemsPath: '' } })
    const { result, stored } = await submit(api, { values: { email: 'x' } })
    expect(result).toEqual({ ok: false, status: 403, message: 'This collection does not accept new records' })
    expect(stored).toEqual([])
  })

  it('keeps the declared fields only', async () => {
    const { result } = await submit(snapshot(), { values: { email: 'a@b.c', admin: true, id: 'forged', createdAt: '1999-01-01' } })
    expect((result as { record: DataRecord }).record.values).toEqual({ email: 'a@b.c' })
  })

  it('accepts an empty submission, since fields are not required', async () => {
    const { result } = await submit(snapshot(), { values: {} })
    expect(result).toMatchObject({ ok: true, record: { values: {} } })
  })

  it('refuses values that do not fit the field types, naming the field only', async () => {
    const { result, stored } = await submit(snapshot(), { values: { email: 123, guests: 'many' } })
    expect(result).toEqual({ ok: false, status: 422, message: '"email" must be a string; "guests" must be a number' })
    expect(stored).toEqual([])
  })

  it('refuses a body that is not { values: object }', async () => {
    for (const body of [null, 'email=x', [], { values: 'x' }, { values: [] }, { email: 'x' }]) {
      const { result } = await submit(snapshot(), body)
      expect(result).toEqual({ ok: false, status: 400, message: 'Send JSON { "values": { "<field>": <value> } }' })
    }
  })

  it('refuses a record over the per-record size cap', async () => {
    const { result, stored } = await submit(snapshot(), { values: { email: 'x'.repeat(11 * 1024) } })
    expect(result).toEqual({ ok: false, status: 413, message: 'A record can be at most 10 KB' })
    expect(stored).toEqual([])
  })

  it('refuses new records once the collection is full', async () => {
    const snap = snapshot()
    const store = createRecordStore(memoryStorage())
    const full = Array.from({ length: MAX_RECORDS_PER_COLLECTION }, (_, i) => ({ id: `r${i}`, createdAt: '', updatedAt: '', values: {} }))
    await store.save(snap.project.id, snap.project.collections[0]!.id, full)
    const result = await createPublicRecord({ snapshot: snap, collectionSlug: 'messages', body: { values: {} }, store, now: NOW })
    expect(result).toEqual({ ok: false, status: 403, message: 'This collection is full' })
  })
})
