/**
 * Remote paging on the module editor (port of e2e/paging.mjs, S35.4): a collection over a REST API
 * answering `{ items, total }` pages by offset. The Data screen's Endpoints panel shows that paging,
 * the table lists every row the app's list route answers with its total ("N items"), and the saved
 * repository in `.bildr/` has the offset paging. The API is a local stub (lib.mjs `stubRest`).
 *
 * Dropped (feature doc: the paging editor is gone, the generated adapter pages by offset only and reads
 * the items from a top-level key):
 * - Test on /character proposing "Next link (info.next) · 826 items" and the Rick and Morty API;
 * - Edit paging, the type select (Page number, Next link, None), the Total path field, Detect and
 *   "Test page 2";
 * - "50 of 826 items" / Load more in the table (the table reads the app's list route in one call).
 */
import { action, bildr, bildrFiles, check, openData, quiesce, quiet, run, shot, stubRest, until } from './lib.mjs'

await run('paging', async ({ page, errors }) => {
  const stub = await stubRest({ count: 60 })
  try {
    // The connection and the collection through the actions the Data screen calls.
    const source = await action('datasource_create', { name: 'paged', kind: 'rest', defaults: { baseUrl: stub.url } })
    await quiet()
    const entity = await action('entity_create', { module: 'blog', name: 'Paged post', source: source.datasourceId, fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }, { name: 'body', type: 'text' }], endpoints: { list: { path: '/posts', itemsPath: 'items', totalPath: 'total' } } })
    await quiesce().catch(() => {})
    await quiet()
    const repo = bildr(`modules/blog/repositories/${bildrFiles('modules/blog/repositories/').map(path => path.split('/').pop().replace('.json', '')).find(name => name.startsWith('paged'))}.json`)
    check(!!repo && repo.datasource === source.datasourceId, `the repository reads the data source (${repo?.id})`)
    check(JSON.stringify(repo?.rest?.list).includes('total'), `the list endpoint keeps its total path (${JSON.stringify(repo?.rest?.list)})`)

    await openData(page)
    await page.locator('[data-collection]').filter({ hasText: 'PagedPost' }).first().click().catch(async () => {
      await page.locator(`[data-collection="${entity.entityId.replace('ent_', '')}"]`).click()
    })
    // The app regenerates and restarts for the new route: refresh until it answers.
    await until(async () => {
      await page.locator('[aria-label="Refresh"]').first().click().catch(() => {})
      return (await page.locator('[data-record]').count()) > 0
    }, 60_000)
    const count = page.locator('[data-records-count]')
    check(await until(async () => /^60\b/.test((await count.innerText()).trim())), `the table shows the rows and their total ("${(await count.innerText()).trim()}", ${await page.locator('[data-record]').count()} rows)`)
    // The collection's endpoints are their own tab now.
    await page.locator('[role=tab][data-data-tab="endpoints"]').click()
    const summary = page.locator('[data-paging-summary]')
    check(await summary.count() > 0 && /offset/i.test(await summary.innerText()), `the Endpoints panel says the list pages by offset ("${(await summary.first().innerText().catch(() => '')).trim()}")`)
    await shot(page, 'paging-panel')
    check(stub.calls.some(call => call.method === 'GET' && call.path === '/posts'), 'the app asked the API for its rows')
  } finally {
    await stub.close()
  }
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/, /status of 503/] })
