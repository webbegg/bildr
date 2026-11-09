import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { createApiFetcher } from '../../server/utils/apiFetch'
import type { Transport } from '../../server/utils/urlGuard'
import { publicCollection, publicRecords } from '../../server/utils/publicData'
import type { DataRecord } from '#shared/data/records'
import { createCollection } from '#shared/document/factory'
import type { Collection, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }
const URL_ = 'https://rickandmortyapi.com/api/character'

const CHARACTERS = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  name: ['Rick Sanchez', 'Morty Smith', 'Summer Smith', 'Beth Smith'][i % 4] + (i >= 4 ? ` ${i}` : ''),
  status: i % 3 ? 'Alive' : 'Dead',
  species: 'Human',
  origin: { name: i % 2 ? 'Earth (C-137)' : 'unknown', url: '' },
  image: `https://rickandmortyapi.com/api/character/avatar/${i + 1}.jpeg`,
  episode: [`https://rickandmortyapi.com/api/episode/${i + 1}`],
  created: '2017-11-04T18:48:46.250Z'
}))

async function setup() {
  let requests = 0
  const transport: Transport = async (url) => {
    requests += 1
    if (url.href === URL_) return new Response(JSON.stringify({ info: { count: 20 }, results: CHARACTERS }), { headers: { 'content-type': 'application/json' } })
    return new Response('nope', { status: 404 })
  }
  const api = createApiFetcher({ transport, resolve: async () => [{ address: '104.21.0.1', family: 4 }] })
  const storage = memoryStorage()
  const bildr = createBildr(storage, ACTIONS, { api })
  const project = await bildr.call<Project>('project_create', { name: 'Rick' }, mcp)
  return { bildr, storage, projectId: project.id, requests: () => requests }
}

interface Preview {
  itemsPath: string
  fields: Collection['fields']
  items: unknown[]
  sample: { id: string, values: Record<string, unknown> }[]
  total: number
}

async function createCharacters(bildr: Awaited<ReturnType<typeof setup>>['bildr'], projectId: string) {
  const preview = await bildr.call<Preview>('api_source_preview', { projectId, url: URL_ }, mcp)
  return bildr.call<{ collection: Collection }>('collection_create', {
    projectId,
    name: 'Characters',
    source: { type: 'api', url: URL_, itemsPath: preview.itemsPath },
    fields: preview.fields
  }, mcp)
}

describe('api_source_preview', () => {
  it('detects the items, proposes fields and maps a 10-row sample', async () => {
    const { bildr, projectId } = await setup()
    const preview = await bildr.call<Preview>('api_source_preview', { projectId, url: URL_ }, mcp)
    expect(preview.itemsPath).toBe('results')
    expect(preview.total).toBe(20)
    expect(Object.fromEntries(preview.fields.map(f => [f.key, f.type]))).toMatchObject({
      externalId: 'number', name: 'text', status: 'text', species: 'text', originName: 'text', image: 'image', episode: 'text', created: 'date'
    })
    expect(preview.sample).toHaveLength(10)
    expect(preview.items).toHaveLength(10)
    expect(preview.sample[0]).toEqual({
      id: '1',
      values: expect.objectContaining({ name: 'Rick Sanchez', originName: 'unknown', image: 'https://rickandmortyapi.com/api/character/avatar/1.jpeg' })
    })
  })

  it('reads a given items path instead of detecting it', async () => {
    const { bildr, projectId } = await setup()
    await expect(bildr.call('api_source_preview', { projectId, url: URL_, itemsPath: 'info' }, mcp))
      .rejects.toMatchObject({ code: 'invalid', message: 'The API response has no list of items at "info"' })
  })

  it('refuses unsafe URLs and reports API errors', async () => {
    const { bildr, projectId } = await setup()
    await expect(bildr.call('api_source_preview', { projectId, url: 'file:///etc/passwd' }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(bildr.call('api_source_preview', { projectId, url: 'http://169.254.169.254/latest/meta-data' }, mcp))
      .rejects.toMatchObject({ code: 'invalid', message: 'Blocked address: 169.254.169.254 is a private, loopback or link-local address' })
    await expect(bildr.call('api_source_preview', { projectId, url: 'https://rickandmortyapi.com/api/nope' }, mcp))
      .rejects.toMatchObject({ code: 'invalid', message: 'The API answered HTTP 404' })
  })
})

describe('API collections', () => {
  it('collection_create stores the source and mapping as one undo step', async () => {
    const { bildr, projectId } = await setup()
    const { collection } = await createCharacters(bildr, projectId)
    expect(collection).toMatchObject({ slug: 'characters', source: { type: 'api', url: URL_, itemsPath: 'results' }, publicRead: false })
    expect(collection.fields.find(f => f.key === 'originName')).toEqual({ key: 'originName', label: 'Origin name', type: 'text', path: 'origin.name' })
    expect(await bildr.call('history_get', { projectId }, mcp)).toMatchObject({ undo: 'Create collection' })
  })

  it('record_list maps the fetched items and applies filter, sort, limit and offset', async () => {
    const { bildr, projectId, requests } = await setup()
    await createCharacters(bildr, projectId)
    const all = await bildr.call<{ total: number, records: DataRecord[] }>('record_list', { projectId, collection: 'characters' }, mcp)
    expect(all.total).toBe(20)
    expect(all.records[0]).toMatchObject({ id: '1', values: { name: 'Rick Sanchez', image: 'https://rickandmortyapi.com/api/character/avatar/1.jpeg' } })

    const dead = await bildr.call<{ total: number, records: DataRecord[] }>('record_list', {
      projectId, collection: 'characters', filter: { status: 'Dead' }, sort: { field: 'externalId', direction: 'desc' }, limit: 2, offset: 1
    }, mcp)
    expect(dead.total).toBe(7)
    expect(dead.records.map(r => r.values.externalId)).toEqual([16, 13])

    expect(await bildr.call('record_get', { projectId, collection: 'characters', recordId: '3' }, mcp)).toMatchObject({ values: { name: 'Summer Smith' } })
    // Preview + three reads within 60 s hit the API once.
    expect(requests()).toBe(1)
  })

  it('refuses record writes', async () => {
    const { bildr, projectId } = await setup()
    await createCharacters(bildr, projectId)
    const message = '"Characters" is read live from an API, so its records cannot be created, changed or deleted'
    await expect(bildr.call('record_create', { projectId, collection: 'characters', values: { name: 'Jerry' } }, mcp)).rejects.toMatchObject({ code: 'forbidden', message })
    await expect(bildr.call('record_update', { projectId, collection: 'characters', recordId: '1', values: { name: 'Jerry' } }, mcp)).rejects.toMatchObject({ code: 'forbidden', message })
    await expect(bildr.call('record_delete', { projectId, collection: 'characters', recordId: '1' }, mcp)).rejects.toMatchObject({ code: 'forbidden', message })
  })

  it('collection_update edits the mapping in one undoable step', async () => {
    const { bildr, projectId } = await setup()
    const { collection } = await createCharacters(bildr, projectId)
    const fields = [
      { key: 'title', label: 'Title', type: 'text', path: 'name' },
      { key: 'photo', type: 'image', path: 'image' },
      { key: 'home', label: 'Home', type: 'text', path: 'origin.name' }
    ]
    const updated = await bildr.call<{ collection: Collection }>('collection_update', { projectId, collection: 'characters', fields }, mcp)
    expect(updated.collection.fields).toEqual([
      { key: 'title', label: 'Title', type: 'text', path: 'name' },
      { key: 'photo', label: 'Photo', type: 'image', path: 'image' },
      { key: 'home', label: 'Home', type: 'text', path: 'origin.name' }
    ])
    const list = await bildr.call<{ records: DataRecord[] }>('record_list', { projectId, collection: 'characters', limit: 1 }, mcp)
    expect(list.records[0]!.values).toEqual({ title: 'Rick Sanchez', photo: 'https://rickandmortyapi.com/api/character/avatar/1.jpeg', home: 'unknown' })

    await bildr.call('history_undo', { projectId }, mcp)
    expect((await bildr.call<Project>('project_get', { projectId }, mcp)).collections[0]!.fields).toEqual(collection.fields)
  })

  it('collection_update refuses to replace an internal collection\'s fields', async () => {
    const { bildr, projectId } = await setup()
    await bildr.call('collection_create', { projectId, name: 'Menu', fields: [{ key: 'name', type: 'text' }] }, mcp)
    await expect(bildr.call('collection_update', { projectId, collection: 'menu', fields: [{ key: 'title', type: 'text' }] }, mcp))
      .rejects.toMatchObject({ code: 'invalid', message: 'Only API collections take a fields mapping; change an internal collection\'s fields with field_add, field_update and field_remove' })
  })

  it('switches a collection between internal and api with collection_update', async () => {
    const { bildr, projectId } = await setup()
    await bildr.call('collection_create', { projectId, name: 'People', fields: [{ key: 'name', type: 'text' }] }, mcp)
    await bildr.call('collection_update', { projectId, collection: 'people', source: { type: 'api', url: URL_, itemsPath: 'results' } }, mcp)
    const list = await bildr.call<{ records: DataRecord[] }>('record_list', { projectId, collection: 'people', limit: 1 }, mcp)
    expect(list.records[0]!.values).toEqual({ name: 'Rick Sanchez' })
    await bildr.call('history_undo', { projectId }, mcp)
    expect((await bildr.call<{ total: number }>('record_list', { projectId, collection: 'people' }, mcp)).total).toBe(0)
  })

  it('published apps read a publicRead API collection through the same mapping', async () => {
    const { bildr, projectId } = await setup()
    await createCharacters(bildr, projectId)
    await bildr.call('collection_update', { projectId, collection: 'characters', publicRead: true }, mcp)
    await bildr.call('project_publish', { projectId }, mcp)
    const snapshot = await bildr.services.getPublished('rick')
    const collection = publicCollection(snapshot, 'characters')!
    const result = publicRecords(collection, await bildr.services.collectionRecords(snapshot!.project.id, collection), { limit: '2', sort: 'name' })
    expect(result).toMatchObject({ total: 20, records: [{ values: { name: 'Beth Smith' } }, { values: { name: 'Beth Smith 11' } }] })
  })

  it('a stored collection without a source still reads as internal', async () => {
    const { bildr, storage, projectId } = await setup()
    const project = await bildr.call<Project>('project_get', { projectId }, mcp)
    const { source: _source, ...legacy } = createCollection('Notes', 'notes', [{ key: 'text', label: 'Text', type: 'text' }])
    await storage.setItem(`projects:${projectId}`, { ...project, collections: [legacy] })
    expect((await bildr.call<Project>('project_get', { projectId }, mcp)).collections[0]!.source).toEqual({ type: 'internal' })
    await bildr.call('record_create', { projectId, collection: 'notes', values: { text: 'hi' } }, mcp)
    expect((await bildr.call<{ total: number }>('record_list', { projectId, collection: 'notes' }, mcp)).total).toBe(1)
  })
})
