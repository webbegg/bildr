import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import type { KeyValueStorage } from '../../server/utils/projectStore'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }
const PREFIXES = ['projects:', 'history:', 'records:', 'env:', 'published:', 'editor-context:']

/** A project with everything that hangs off it: history, env, two collections with records, editor context and a published snapshot. */
async function seed(bildr: ReturnType<typeof createBildr>, name: string) {
  const project = await bildr.call<Project>('project_create', { name }, mcp)
  const projectId = project.id
  const pageId = project.pages[0]!.id
  await bildr.call('node_insert', { projectId, pageId, type: 'Heading', props: { text: 'Hi' } }, mcp)
  await bildr.call('env_set', { projectId, name: 'API_KEY', value: 'secret-value', secret: true }, mcp)
  for (const collection of ['Menu', 'Orders']) {
    await bildr.call('collection_create', { projectId, name: collection, fields: [{ key: 'name', type: 'text' }] }, mcp)
    await bildr.call('record_create', { projectId, collection: collection.toLowerCase(), values: { name: 'Tea' } }, mcp)
  }
  await bildr.call('editor_set_context', { projectId, pageId, selectedId: null }, { caller: 'ui' })
  await bildr.call('project_publish', { projectId }, mcp)
  return { projectId, slug: project.slug }
}

async function keysOf(storage: KeyValueStorage, projectId: string): Promise<string[]> {
  return (await storage.getKeys()).filter(key => key.includes(projectId))
}

async function setup(storage: KeyValueStorage = memoryStorage()) {
  const bildr = createBildr(storage)
  const target = await seed(bildr, 'Café')
  const other = await seed(bildr, 'Other')
  return { bildr, storage, target, other }
}

describe('project_delete', () => {
  it('deletes the project and everything stored for it', async () => {
    const { bildr, storage, target } = await setup()
    const before = await keysOf(storage, target.projectId)
    for (const prefix of PREFIXES) expect(before.some(key => key.startsWith(prefix)), prefix).toBe(true)

    await bildr.call('project_delete', { projectId: target.projectId, confirm: target.slug }, mcp)

    for (const prefix of PREFIXES) expect(await storage.getKeys(prefix), prefix).not.toContainEqual(expect.stringContaining(target.projectId))
    expect(await keysOf(storage, target.projectId)).toEqual([])
    await expect(bildr.call('project_get', { projectId: target.projectId }, mcp)).rejects.toMatchObject({ code: 'not_found' })
    expect((await bildr.call<{ id: string }[]>('project_list', {}, mcp)).map(p => p.id)).not.toContain(target.projectId)
  })

  it('stops serving the published app', async () => {
    const { bildr, target } = await setup()
    expect(await bildr.services.getPublished(target.slug)).toBeDefined()
    await bildr.call('project_delete', { projectId: target.projectId, confirm: target.slug }, mcp)
    expect(await bildr.services.getPublished(target.slug)).toBeUndefined()
    expect(await bildr.services.publishedSnapshot(target.projectId)).toBeUndefined()
  })

  it('refuses a confirm that is not the project slug, and deletes nothing', async () => {
    const { bildr, storage, target } = await setup()
    const before = await keysOf(storage, target.projectId)
    for (const confirm of ['', 'Café', 'cafe ', 'other']) {
      await expect(bildr.call('project_delete', { projectId: target.projectId, confirm }, mcp), JSON.stringify(confirm))
        .rejects.toMatchObject({ code: 'invalid', message: 'Type the project slug to confirm' })
    }
    await expect(bildr.call('project_delete', { projectId: target.projectId }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
    expect((await keysOf(storage, target.projectId)).sort()).toEqual(before.sort())
  })

  it('finishes the job when retried after a crash part-way through', async () => {
    const inner = memoryStorage()
    let crash = true
    const flaky: KeyValueStorage = {
      ...inner,
      removeItem: async (key) => {
        if (crash && key.startsWith('records:')) {
          crash = false
          throw new Error('disk full')
        }
        await inner.removeItem(key)
      }
    }
    const { bildr, target } = await setup(flaky)

    await expect(bildr.call('project_delete', { projectId: target.projectId, confirm: target.slug }, mcp)).rejects.toThrow('disk full')
    // The published app went first, so nothing is served from the half-deleted data.
    expect(await bildr.services.getPublished(target.slug)).toBeUndefined()
    expect(await inner.getItem(`projects:${target.projectId}`)).not.toBeNull()

    await bildr.call('project_delete', { projectId: target.projectId, confirm: target.slug }, mcp)
    expect(await keysOf(inner, target.projectId)).toEqual([])
    await expect(bildr.call('project_delete', { projectId: target.projectId, confirm: target.slug }, mcp)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('leaves other projects untouched', async () => {
    const { bildr, storage, target, other } = await setup()
    const before = await Promise.all((await keysOf(storage, other.projectId)).map(async key => [key, await storage.getItem(key)]))
    await bildr.call('project_delete', { projectId: target.projectId, confirm: target.slug }, mcp)
    const after = await Promise.all((await keysOf(storage, other.projectId)).map(async key => [key, await storage.getItem(key)]))
    expect(after).toEqual(before)
    expect(await bildr.services.getPublished(other.slug)).toBeDefined()
    expect(await bildr.call('record_list', { projectId: other.projectId, collection: 'menu' }, mcp)).toMatchObject({ records: [{ values: { name: 'Tea' } }] })
  })

  it('emits a project_delete change event so open editors can react', async () => {
    const { bildr, target } = await setup()
    const events: ChangeEvent[] = []
    bildr.onChange(e => events.push(e))
    const { version } = await bildr.call<Project>('project_get', { projectId: target.projectId }, mcp)
    await bildr.call('project_delete', { projectId: target.projectId, confirm: target.slug }, mcp)
    expect(events).toEqual([{ projectId: target.projectId, version: version + 1, action: 'project_delete', source: 'mcp' }])
  })

  it('is available to agents and says it cannot be undone', async () => {
    const bildr = createBildr(memoryStorage())
    const info = bildr.list().find(a => a.name === 'project_delete')
    expect(info).toBeDefined()
    expect(info!.uiOnly).toBe(false)
    expect(info!.description).toMatch(/cannot be undone/i)
    expect(info!.inputSchema).toMatchObject({ required: ['projectId', 'confirm'] })
  })
})
