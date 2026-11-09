import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import type { Collection, Project } from '#shared/document/schema'
import type { DataRecord } from '#shared/data/records'
import type { PublicWriteResult } from '../../server/utils/publicData'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }
const visitor = { caller: 'public' as const, source: 'public' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const events: ChangeEvent[] = []
  bildr.onChange(e => events.push(e))
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'Café' }, mcp)
  const { collection } = await bildr.call<{ collection: Collection }>('collection_create', {
    projectId, name: 'Messages', fields: [{ key: 'email', type: 'text' }, { key: 'message', type: 'text' }]
  }, mcp)
  await bildr.call('collection_update', { projectId, collection: 'messages', publicCreate: true }, mcp)
  return { bildr, events, projectId, collection }
}

const submit = (bildr: ReturnType<typeof createBildr>, projectId: string, body: unknown) =>
  bildr.call<PublicWriteResult>('public_record_create', { projectId, collection: 'messages', body }, visitor)

describe('public_record_create', () => {
  it('follows the PUBLISHED schema, not the draft', async () => {
    const { bildr, projectId } = await setup()
    expect(await submit(bildr, projectId, { values: { email: 'a@b.c' } })).toEqual({ ok: false, status: 404, message: 'Collection not found' })
    await bildr.call('project_publish', { projectId }, mcp)
    await bildr.call('collection_update', { projectId, collection: 'messages', publicCreate: false }, mcp)
    expect(await submit(bildr, projectId, { values: { email: 'a@b.c' } })).toMatchObject({ ok: true })
  })

  it('stores the record where record_list reads it and tells open editors', async () => {
    const { bildr, events, projectId, collection } = await setup()
    await bildr.call('project_publish', { projectId }, mcp)
    const result = await submit(bildr, projectId, { values: { email: 'a@b.c', message: 'Hi', extra: 'dropped' } })
    const listed = await bildr.call<{ records: DataRecord[] }>('record_list', { projectId, collection: 'messages' }, mcp)
    expect(listed.records.map(r => [r.id, r.values])).toEqual([[(result as { record: DataRecord }).record.id, { email: 'a@b.c', message: 'Hi' }]])
    expect(events.at(-1)).toEqual({ projectId, version: 2, action: 'public_record_create', source: 'public', scope: 'data', collectionId: collection.id })
  })

  it('emits no event for a refused submission', async () => {
    const { bildr, events, projectId } = await setup()
    await bildr.call('project_publish', { projectId }, mcp)
    const before = events.length
    expect(await submit(bildr, projectId, { values: { email: 1 } })).toMatchObject({ ok: false, status: 422 })
    expect(events).toHaveLength(before)
  })

  it('is reachable only by public callers, and public callers reach nothing else', async () => {
    const { bildr, projectId } = await setup()
    for (const caller of ['ui', 'http', 'mcp'] as const) {
      await expect(bildr.call('public_record_create', { projectId, collection: 'messages', body: {} }, { caller })).rejects.toMatchObject({ code: 'not_found' })
    }
    await expect(bildr.call('record_create', { projectId, collection: 'messages', values: {} }, visitor)).rejects.toMatchObject({ code: 'not_found' })
    expect(bildr.list().map(a => a.name)).not.toContain('public_record_create')
  })

  it('refuses a public caller on every listed action', async () => {
    const { bildr, projectId } = await setup()
    const names = bildr.list().map(a => a.name)
    expect(names.length).toBeGreaterThan(20)
    for (const name of names) {
      await expect(bildr.call(name, { projectId }, visitor), name).rejects.toMatchObject({ code: 'not_found' })
    }
  })

  it('ignores __proto__ in values and refuses it at the top level', async () => {
    const { bildr, projectId } = await setup()
    await bildr.call('project_publish', { projectId }, mcp)
    const nested = await submit(bildr, projectId, JSON.parse('{"values":{"__proto__":{"polluted":true},"email":"a@b.c"}}'))
    expect(nested).toMatchObject({ ok: true })
    expect(Object.entries((nested as { record: DataRecord }).record.values)).toEqual([['email', 'a@b.c']])
    const top = await submit(bildr, projectId, JSON.parse('{"__proto__":{"values":{"email":"x"}}}'))
    expect(top).toEqual({ ok: false, status: 400, message: 'Send JSON { "values": { "<field>": <value> } }' })
    const listed = await bildr.call<{ records: DataRecord[] }>('record_list', { projectId, collection: 'messages' }, mcp)
    expect(listed.records.map(r => r.values)).toEqual([{ email: 'a@b.c', message: null }])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
