import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { dataRouteOf } from '../../src/editor/dataRoutes.ts'
import { routes } from '../../src/router.ts'

/**
 * The Data screens' routes (simple data, SD-1): `/data` is the simple section, today's workspace is `/data/advanced` with every query
 * it had, and the old links that carry a part only the workspace has (a collection, a connection, a query, an action, All model files,
 * the migration, a tab, a file) land on it, with their query, so every deep link keeps landing where it did.
 */

const go = async (to: string) => {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(to)
  await router.isReady()
  return router.currentRoute.value
}

describe('the screen a hand-over opens', () => {
  it('is the workspace on a collection, a connection, a query or an action, the simple section on a store', () => {
    expect(dataRouteOf({ collectionId: 'ent_post' })).toEqual({ path: '/data/advanced', query: { item: 'collection:ent_post' } })
    expect(dataRouteOf({ connectionId: 'ds_quotes' })).toEqual({ path: '/data/advanced', query: { item: 'connection:ds_quotes' } })
    expect(dataRouteOf({ queryId: 'q_all' })).toEqual({ path: '/data/advanced', query: { item: 'query:q_all' } })
    expect(dataRouteOf({ actionId: 'act_x' })).toEqual({ path: '/data/advanced', query: { item: 'action:act_x' } })
    expect(dataRouteOf({ stateId: 'st_cart' })).toEqual({ path: '/data', query: { item: 'state:st_cart' } })
  })

  it('is the workspace for a dialog only it has, and the simple section for nothing', () => {
    expect(dataRouteOf({ dataRequest: { kind: 'new-collection', seq: 1 } })).toEqual({ path: '/data/advanced', query: {} })
    expect(dataRouteOf({ dataRequest: { kind: 'import', seq: 1 }, collectionId: 'ent_post' })).toEqual({ path: '/data/advanced', query: { item: 'collection:ent_post' } })
    expect(dataRouteOf({})).toEqual({ path: '/data', query: {} })
    expect(dataRouteOf({ collectionId: null, stateId: null, dataRequest: null })).toEqual({ path: '/data', query: {} })
  })
})

describe('the Data routes', () => {
  it('opens the simple section at /data, and the workspace at /data/advanced', async () => {
    const simple = await go('/data')
    expect(simple.name).toBe('data')
    expect(simple.path).toBe('/data')
    const advanced = await go('/data/advanced')
    expect(advanced.name).toBe('data-advanced')
    expect(advanced.path).toBe('/data/advanced')
  })

  it('keeps every query the workspace had on /data/advanced', async () => {
    const route = await go('/data/advanced?item=collection:ent_post&tab=fields')
    expect(route.path).toBe('/data/advanced')
    expect(route.query).toEqual({ item: 'collection:ent_post', tab: 'fields' })
    expect((await go('/data/advanced?item=files&file=.bildr/project.json')).query).toEqual({ item: 'files', file: '.bildr/project.json' })
  })

  it.each([
    ['a collection', '/data?item=collection:ent_post&tab=fields', { item: 'collection:ent_post', tab: 'fields' }],
    ['a connection', '/data?item=connection:ds_quotes&tab=json', { item: 'connection:ds_quotes', tab: 'json' }],
    ['a query', '/data?item=query:q_all_posts', { item: 'query:q_all_posts' }],
    ['an action', '/data?item=action:act_create_post&tab=steps', { item: 'action:act_create_post', tab: 'steps' }],
    ['All model files', '/data?item=files', { item: 'files' }],
    ['a model file', '/data?item=files&file=.bildr/project.json', { item: 'files', file: '.bildr/project.json' }],
    ['the migration', '/data?item=migrations', { item: 'migrations' }],
    ['a state on a tab only the workspace has', '/data?item=state:st_preferences&tab=used', { item: 'state:st_preferences', tab: 'used' }],
    ['a tab with no item', '/data?tab=json', { tab: 'json' }]
  ])('sends an old link to %s to the workspace, with its query', async (_what, from, query) => {
    const route = await go(from)
    expect(route.path).toBe('/data/advanced')
    expect(route.name).toBe('data-advanced')
    expect(route.query).toEqual(query)
  })

  it('keeps a link to a store, and to an API, in the simple section', async () => {
    const store = await go('/data?item=state:st_preferences')
    expect(store.path).toBe('/data')
    expect(store.query).toEqual({ item: 'state:st_preferences' })
    expect((await go('/data?item=api:ds_shop')).path).toBe('/data')
  })

  it('keeps the hash of a link it redirects, and the query with it', async () => {
    const route = await go('/data?item=collection:ent_post&tab=fields#rows')
    expect(route.path).toBe('/data/advanced')
    expect(route.query).toEqual({ item: 'collection:ent_post', tab: 'fields' })
    expect(route.hash).toBe('#rows')
    expect((await go('/data?item=files#top')).hash).toBe('#top')
    expect((await go('/data?item=state:st_preferences#top')).hash).toBe('#top')
  })

  it('opens the simple section on the store /data?item=state:<id> names', async () => {
    const route = await go('/data?item=state:st_cart')
    expect(route.name).toBe('data')
    expect(route.query).toEqual({ item: 'state:st_cart' })
  })

  it('sends /model and /migrations to the workspace', async () => {
    const files = await go('/model?path=.bildr/project.json')
    expect(files.path).toBe('/data/advanced')
    expect(files.query).toEqual({ item: 'files', file: '.bildr/project.json' })
    expect((await go('/model')).query).toEqual({ item: 'files' })
    const migrations = await go('/migrations')
    expect(migrations.path).toBe('/data/advanced')
    expect(migrations.query).toEqual({ item: 'migrations' })
  })
})
