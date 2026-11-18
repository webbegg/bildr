import { describe, expect, it } from 'vitest'
import { byTestId, click, Failure, settle } from '../helpers.ts'
import { liveRows } from '../../src/design/liveRows.ts'
import { choose, FakeEventSource, fromCanvas, open, sent, setupHarness } from './harness.ts'

/**
 * Canvas data (P5, V4, Q12): the Design screen computes `data` for the canvas from
 * the app's generated list routes through the shared query evaluator, falls back to
 * the model's fixtures when the app can't answer, and says which one it shows.
 */

setupHarness()

const post = (slug: string, published: boolean, at: string) => ({ id: `id-${slug}`, title: `Post ${slug}`, slug, body: '', published, publishedAt: published ? at : null, createdAt: at, updatedAt: at })
const posts = [post('one', true, '2026-11-10T09:00:00.000Z'), post('two', true, '2026-11-12T09:00:00.000Z'), post('draft', false, '2026-11-13T09:00:00.000Z')]
const quotes = [{ id: 1, text: 'Q one', author: 'A' }, { id: 2, text: 'Q two', author: 'B' }]
const app = { '/api/blog/posts': { items: posts, total: 3 }, '/api/blog/quotes': { items: quotes, total: 2 } }

const lastData = () => sent('bildr:render').at(-1)!.data
const ids = (rows: unknown) => (rows as Array<{ slug?: string, id?: unknown }>).map(row => row.slug ?? row.id)
const badge = () => byTestId('data-badge')

describe('the canvas shows the app\'s rows', () => {
  it('evaluates each query use over the rows of its list route, and badges them live', async () => {
    const { actions } = await open({}, 'pg_index', app)
    expect(actions.appCalls.some(call => call.startsWith('/api/blog/posts?'))).toBe(true)
    // `featured`: published posts, newest published first, at most its `limit` argument (6); `all`: every post, newest created first.
    expect(ids(lastData().featured)).toEqual(['two', 'one'])
    expect(ids(lastData().all)).toEqual(['draft', 'two', 'one'])
    expect(ids(lastData().quotes)).toEqual([1, 2])
    expect(badge()?.dataset.state).toBe('live')
    expect(badge()?.textContent?.trim()).toBe('Live')
  })

  it('pages through a list route until it has every row', async () => {
    const many = Array.from({ length: 7 }, (_, index) => post(`p${index}`, true, `2026-11-0${index + 1}T09:00:00.000Z`))
    const { actions } = await open({}, 'pg_index', {
      ...app,
      '/api/blog/posts': (query: URLSearchParams) => ({ items: many.slice(Number(query.get('offset')), Number(query.get('offset')) + 3), total: 7 })
    })
    expect(actions.appCalls.filter(call => call.startsWith('/api/blog/posts?')).length).toBeGreaterThan(1)
    expect(lastData().all).toHaveLength(7)
  })

  it('reads at most 500 rows of an entity, whatever page size the route answers with', async () => {
    const many = Array.from({ length: 1200 }, (_, index) => post(`p${index}`, true, '2026-11-01T09:00:00.000Z'))
    // A route that ignores `limit` and always answers a page of 100.
    const { actions } = await open({}, 'pg_index', {
      ...app,
      '/api/blog/posts': (query: URLSearchParams) => ({ items: many.slice(Number(query.get('offset')), Number(query.get('offset')) + 100), total: 1200 })
    })
    expect(lastData().all).toHaveLength(500)
    expect(actions.appCalls.filter(call => call.startsWith('/api/blog/posts?')).length).toBeLessThanOrEqual(6)
  })

  it('falls back to the fixtures when the app does not answer, and badges them', async () => {
    await open({}, 'pg_index', {})
    expect(ids(lastData().all)).toEqual(['a-draft', 'hello-bildr'])
    expect(badge()?.dataset.state).toBe('fixtures')
    expect(badge()?.textContent?.trim()).toBe('Sample data')
    // The tooltip speaks the workspace's words too: Sample data, never fixtures.
    expect(badge()?.title).toContain('Sample data')
    expect(badge()?.title).not.toMatch(/fixture/i)
  })

  it('gives up on a route that never answers, falls back to the fixtures and says why in the badge', async () => {
    const before = liveRows.timeoutMs
    liveRows.timeoutMs = 60
    try {
      await open({}, 'pg_index', { ...app, '/api/blog/posts': () => new Promise(() => {}) })
      await new Promise(resolve => setTimeout(resolve, 150))
      await settle()
      expect(ids(lastData().all)).toEqual(['a-draft', 'hello-bildr'])
      expect(badge()?.dataset.state).toBe('partial')
      expect(badge()?.title).toContain('posts')
      expect(badge()?.title).toContain('did not answer in time')
    } finally {
      liveRows.timeoutMs = before
    }
  })

  it('names the failure of a route in the badge', async () => {
    await open({}, 'pg_index', { ...app, '/api/blog/quotes': new Failure(500, 'x', 'upstream down') })
    expect(badge()?.title).toContain('quotes')
    expect(badge()?.title).toContain('HTTP 500')
  })

  it('falls back for a route that fails, and says when only some of the data is live', async () => {
    await open({}, 'pg_index', { ...app, '/api/blog/quotes': new Failure(500, 'x', 'upstream down') })
    expect(ids(lastData().all)).toEqual(['draft', 'two', 'one'])
    expect(lastData().quotes).toEqual([])
    expect(badge()?.dataset.state).toBe('partial')
    expect(badge()?.textContent?.trim()).toBe('Live + Sample data')
    expect(badge()?.title).not.toMatch(/fixture/i)
  })

  it('reads the rows again on a regenerate and on its Refresh button', async () => {
    let answer = posts.slice(0, 1)
    const { actions } = await open({}, 'pg_index', { ...app, '/api/blog/posts': () => ({ items: answer, total: answer.length }) })
    expect(ids(lastData().all)).toEqual(['one'])
    answer = posts
    FakeEventSource.instances[0]!.send({ type: 'regenerated', version: 2, ok: true })
    await settle()
    expect(ids(lastData().all)).toEqual(['draft', 'two', 'one'])
    answer = posts.slice(0, 2)
    await click(byTestId('data-refresh'))
    expect(ids(lastData().all)).toEqual(['two', 'one'])
    expect(actions.appCalls.length).toBeGreaterThan(2)
  })

  it('reads the rows again after a form submit in preview (the app\'s data may have changed)', async () => {
    let answer = posts.slice(0, 1)
    await open({}, 'pg_index', { ...app, '/api/blog/posts': () => ({ items: answer, total: answer.length }) })
    answer = posts
    await fromCanvas({ type: 'bildr:interaction', nodeId: 'n_any', on: 'submit', step: { kind: 'runAction', action: 'act_create_post' } })
    await new Promise(resolve => setTimeout(resolve, 700))
    await settle()
    expect(ids(lastData().all)).toEqual(['draft', 'two', 'one'])
  })
})

describe('a detail page shows one picked record', () => {
  it('lists the records in the toolbar and gives the page the picked one as its route', async () => {
    await open({}, 'pg_post_detail', app)
    const picker = byTestId('record-picker') as HTMLSelectElement
    expect([...picker.options].map(option => option.value)).toEqual(['one', 'two', 'draft'])
    // The first record (the route's order) is picked until the user picks another.
    expect(lastData().$route).toEqual({ slug: 'one' })
    expect((lastData().post as { slug: string }).slug).toBe('one')
    await choose('record-picker', 'draft')
    expect(lastData().$route).toEqual({ slug: 'draft' })
    expect((lastData().post as { slug: string }).slug).toBe('draft')
  })

  it('remembers the picked record in the editor context', async () => {
    const { actions } = await open({}, 'pg_post_detail', app)
    await choose('record-picker', 'two')
    expect(actions.named('editor_context_set').at(-1)?.input).toMatchObject({ file: 'pg_post_detail', record: 'two' })
  })

  it('has no picker on a page without a route parameter', async () => {
    await open({}, 'pg_index', app)
    expect(byTestId('record-picker')).toBeNull()
  })
})
