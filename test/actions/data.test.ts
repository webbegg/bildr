import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import { createProject } from '#shared/document/factory'
import type { Collection, Project, PublishedSnapshot } from '#shared/document/schema'
import type { DataRecord } from '#shared/data/records'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

const MENU_FIELDS = [
  { key: 'name', type: 'text' },
  { key: 'price', label: 'Price (€)', type: 'number' },
  { key: 'vegan', type: 'boolean' },
  { key: 'photo', type: 'image' }
]

async function setup() {
  const storage = memoryStorage()
  const bildr = createBildr(storage)
  const events: ChangeEvent[] = []
  bildr.onChange(e => events.push(e))
  const project = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  const projectId = project.id
  const created = await bildr.call<{ version: number, collection: Collection }>('collection_create', { projectId, name: 'Menu', fields: MENU_FIELDS }, mcp)
  const get = () => bildr.call<Project>('project_get', { projectId }, mcp)
  return { bildr, storage, events, projectId, menu: created.collection, created, get }
}

describe('collection actions', () => {
  it('collection_create adds a private collection to the document as one undo step', async () => {
    const { bildr, projectId, created, get } = await setup()
    expect(created.version).toBe(1)
    expect(created.collection).toMatchObject({
      name: 'Menu',
      slug: 'menu',
      publicRead: false,
      publicCreate: false,
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'price', label: 'Price (€)', type: 'number' },
        { key: 'vegan', label: 'Vegan', type: 'boolean' },
        { key: 'photo', label: 'Photo', type: 'image' }
      ]
    })
    expect((await get()).collections).toEqual([created.collection])
    expect(await bildr.call('history_get', { projectId }, mcp)).toEqual({ undo: 'Create collection', redo: null })

    await bildr.call('history_undo', { projectId }, mcp)
    expect((await get()).collections).toEqual([])
  })

  it('rejects a duplicate slug or field key', async () => {
    const { bildr, projectId } = await setup()
    await expect(bildr.call('collection_create', { projectId, name: 'Menu' }, mcp)).rejects.toMatchObject({ code: 'invalid', message: 'A collection with slug "menu" already exists' })
    await expect(bildr.call('collection_create', { projectId, name: 'Orders', fields: [{ key: 'a', type: 'text' }, { key: 'a', type: 'number' }] }, mcp)).rejects.toMatchObject({ code: 'invalid' })
    await expect(bildr.call('field_add', { projectId, collection: 'menu', key: 'id', type: 'text' }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('collection_update, field_add, field_update and field_remove address a collection by id or slug and undo', async () => {
    const { bildr, projectId, menu, get } = await setup()
    await bildr.call('collection_update', { projectId, collection: menu.id, name: 'Drinks', slug: 'drinks', publicRead: true }, mcp)
    await bildr.call('field_add', { projectId, collection: 'drinks', key: 'servedFrom', type: 'date' }, mcp)
    await bildr.call('field_update', { projectId, collection: 'drinks', key: 'price', type: 'text', label: 'Price' }, mcp)
    await bildr.call('field_remove', { projectId, collection: menu.id, key: 'photo' }, mcp)

    const drinks = (await get()).collections[0]!
    expect(drinks).toMatchObject({ name: 'Drinks', slug: 'drinks', publicRead: true, publicCreate: false })
    expect(drinks.fields).toEqual([
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'price', label: 'Price', type: 'text' },
      { key: 'vegan', label: 'Vegan', type: 'boolean' },
      { key: 'servedFrom', label: 'Served from', type: 'date' }
    ])

    await bildr.call('history_undo', { projectId }, mcp)
    await bildr.call('history_undo', { projectId }, mcp)
    await bildr.call('history_undo', { projectId }, mcp)
    expect(await bildr.call('history_get', { projectId }, mcp)).toMatchObject({ undo: 'Update collection' })
    expect((await get()).collections[0]!.fields).toEqual(menu.fields)

    await expect(bildr.call('field_add', { projectId, collection: 'nope', key: 'x', type: 'text' }, mcp)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('field_move reorders a field as one undo step and validates key and bounds', async () => {
    const { bildr, projectId, menu, get } = await setup()
    const moved = await bildr.call<{ version: number, collection: Collection }>('field_move', { projectId, collection: 'menu', key: 'photo', index: 0 }, mcp)
    expect(moved.collection.fields.map(f => f.key)).toEqual(['photo', 'name', 'price', 'vegan'])
    expect((await get()).collections[0]!.fields.map(f => f.key)).toEqual(['photo', 'name', 'price', 'vegan'])
    expect(await bildr.call('history_get', { projectId }, mcp)).toEqual({ undo: 'Move field', redo: null })

    await bildr.call('history_undo', { projectId }, mcp)
    expect((await get()).collections[0]!.fields).toEqual(menu.fields)

    await expect(bildr.call('field_move', { projectId, collection: menu.id, key: 'nope', index: 0 }, mcp)).rejects.toMatchObject({ code: 'not_found' })
    await expect(bildr.call('field_move', { projectId, collection: menu.id, key: 'name', index: 4 }, mcp)).rejects.toMatchObject({ code: 'invalid', message: 'Index 4 is out of bounds: "Menu" has 4 fields' })
    await expect(bildr.call('field_move', { projectId, collection: menu.id, key: 'name', index: -1 }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('collection_delete removes the schema; undo brings it back with its records', async () => {
    const { bildr, projectId, menu, get } = await setup()
    await bildr.call('record_create', { projectId, collection: 'menu', values: { name: 'Tea' } }, mcp)
    await bildr.call('collection_delete', { projectId, collection: 'menu' }, mcp)
    expect((await get()).collections).toEqual([])
    await expect(bildr.call('record_list', { projectId, collection: 'menu' }, mcp)).rejects.toMatchObject({ code: 'not_found' })

    await bildr.call('history_undo', { projectId }, mcp)
    const list = await bildr.call<{ records: DataRecord[] }>('record_list', { projectId, collection: menu.id }, mcp)
    expect(list.records.map(r => r.values.name)).toEqual(['Tea'])
  })

  it('the published snapshot carries the collection schema', async () => {
    const { bildr, projectId, menu } = await setup()
    await bildr.call('project_publish', { projectId }, mcp)
    const snapshot = await bildr.services.getPublished('demo') as PublishedSnapshot
    expect(snapshot.project.collections).toEqual([menu])
  })

  it('a project and a snapshot saved before collections existed read with none', async () => {
    const { bildr, storage } = await setup()
    const { collections: _collections, ...legacy } = createProject('Legacy')
    await storage.setItem(`projects:${legacy.id}`, legacy)
    expect((await bildr.call<Project>('project_get', { projectId: legacy.id }, mcp)).collections).toEqual([])
    await storage.setItem(`published:${legacy.id}`, { project: legacy, publishedAt: legacy.createdAt })
    expect((await bildr.services.getPublished('legacy'))!.project.collections).toEqual([])
    const created = await bildr.call<{ collection: Collection }>('collection_create', { projectId: legacy.id, name: 'Notes' }, mcp)
    expect(created.collection.slug).toBe('notes')
  })
})

describe('record actions', () => {
  it('creates, gets, lists, updates and deletes records with typed values', async () => {
    const { bildr, projectId } = await setup()
    const latte = await bildr.call<DataRecord>('record_create', { projectId, collection: 'menu', values: { name: 'Latte', price: '3.2', vegan: false } }, mcp)
    expect(latte).toMatchObject({ values: { name: 'Latte', price: 3.2, vegan: false, photo: null } })
    expect(latte.id).toMatch(/^rec_/)
    await bildr.call('record_create', { projectId, collection: 'menu', values: { name: 'Oat latte', price: 3.8, vegan: true } }, mcp)
    await bildr.call('record_create', { projectId, collection: 'menu', values: { name: 'Espresso', price: 2, vegan: true } }, mcp)

    expect(await bildr.call('record_get', { projectId, collection: 'menu', recordId: latte.id }, mcp)).toEqual(latte)

    const vegan = await bildr.call<{ total: number, records: DataRecord[] }>('record_list', {
      projectId, collection: 'menu', filter: { vegan: 'true' }, sort: { field: 'price', direction: 'desc' }, limit: 5
    }, mcp)
    expect(vegan.total).toBe(2)
    expect(vegan.records.map(r => r.values.name)).toEqual(['Oat latte', 'Espresso'])

    const updated = await bildr.call<DataRecord>('record_update', { projectId, collection: 'menu', recordId: latte.id, values: { price: 3.4, photo: '/latte.jpg' } }, mcp)
    expect(updated.values).toEqual({ name: 'Latte', price: 3.4, vegan: false, photo: '/latte.jpg' })
    expect(updated.createdAt).toBe(latte.createdAt)

    await bildr.call('record_delete', { projectId, collection: 'menu', recordId: latte.id }, mcp)
    await expect(bildr.call('record_get', { projectId, collection: 'menu', recordId: latte.id }, mcp)).rejects.toMatchObject({ code: 'not_found' })
    expect((await bildr.call<{ total: number }>('record_list', { projectId, collection: 'menu' }, mcp)).total).toBe(2)
  })

  it('rejects values that do not fit the fields', async () => {
    const { bildr, projectId } = await setup()
    await expect(bildr.call('record_create', { projectId, collection: 'menu', values: { price: 'abc' } }, mcp))
      .rejects.toMatchObject({ code: 'invalid', message: '"price" must be a number' })
    await expect(bildr.call('record_create', { projectId, collection: 'menu', values: { colour: 'red' } }, mcp))
      .rejects.toMatchObject({ code: 'invalid', message: 'Unknown field "colour"' })
    await expect(bildr.call('record_list', { projectId, collection: 'menu', filter: { vegan: 'maybe' } }, mcp))
      .rejects.toMatchObject({ code: 'invalid' })
    await expect(bildr.call('record_list', { projectId, collection: 'menu', sort: { field: 'colour' } }, mcp))
      .rejects.toMatchObject({ code: 'invalid' })
  })

  it('a record change emits a data event without bumping the version or the undo history', async () => {
    const { bildr, events, projectId, menu } = await setup()
    const history = await bildr.call('history_get', { projectId }, mcp)
    const record = await bildr.call<DataRecord>('record_create', { projectId, collection: 'menu', values: { name: 'Tea' } }, mcp)
    await bildr.call('record_update', { projectId, collection: 'menu', recordId: record.id, values: { name: 'Green tea' } }, mcp)
    await bildr.call('record_delete', { projectId, collection: 'menu', recordId: record.id }, mcp)

    expect((await bildr.call<Project>('project_get', { projectId }, mcp)).version).toBe(1)
    expect(await bildr.call('history_get', { projectId }, mcp)).toEqual(history)
    expect(events.slice(-3)).toEqual(['record_create', 'record_update', 'record_delete'].map(action => ({
      projectId, version: 1, action, source: 'mcp', scope: 'data', collectionId: menu.id
    })))
  })

  it('limits records to 10 KB and collections to 5,000 records', async () => {
    const { bildr, storage, projectId, menu } = await setup()
    await expect(bildr.call('record_create', { projectId, collection: 'menu', values: { name: 'x'.repeat(11_000) } }, mcp))
      .rejects.toMatchObject({ code: 'invalid', message: 'A record can be at most 10 KB' })

    const now = new Date().toISOString()
    const full = Array.from({ length: 5000 }, (_, i) => ({ id: `rec_${i}`, createdAt: now, updatedAt: now, values: { name: `#${i}` } }))
    await storage.setItem(`records:${projectId}:${menu.id}`, full)
    await expect(bildr.call('record_create', { projectId, collection: 'menu', values: { name: 'One more' } }, mcp))
      .rejects.toMatchObject({ code: 'forbidden', message: 'A collection can hold at most 5000 records' })
    expect((await bildr.call<{ total: number, records: DataRecord[] }>('record_list', { projectId, collection: 'menu', offset: 4998 }, mcp)).records).toHaveLength(2)
  })

  it('records keep values of removed fields hidden, and read retyped values that no longer fit as null', async () => {
    const { bildr, projectId } = await setup()
    const record = await bildr.call<DataRecord>('record_create', { projectId, collection: 'menu', values: { name: 'Tea', price: 2 } }, mcp)
    await bildr.call('field_remove', { projectId, collection: 'menu', key: 'photo' }, mcp)
    await bildr.call('field_update', { projectId, collection: 'menu', key: 'name', type: 'number' }, mcp)
    expect((await bildr.call<DataRecord>('record_get', { projectId, collection: 'menu', recordId: record.id }, mcp)).values)
      .toEqual({ name: null, price: 2, vegan: null })
    await bildr.call('history_undo', { projectId }, mcp)
    expect((await bildr.call<DataRecord>('record_get', { projectId, collection: 'menu', recordId: record.id }, mcp)).values.name).toBe('Tea')
  })
})
