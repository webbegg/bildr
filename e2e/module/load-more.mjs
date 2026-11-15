/**
 * Load more in Lists on the module (port of e2e/load-more.mjs, S34.9): the blog's Post table gets 7 rows
 * through the running app's own create route, and a List bound to the query of all posts with `loadMore: 3`
 * shows 3, then 6, and so on up to the table's total, then no button, in the running app; a plain List of
 * the same query shows every row; the editor's canvas never shows the button. The page, List and query
 * are checked in `.bildr/`. (The module's `loadMore` is the List's page size over the query's rows; the
 * hosted `limit 3` List prop is the query's own `limit`, which would end the rows before the button.)
 *
 * Dropped:
 * - the published app and the draft preview as two runs: the running app is the one app (the editor's
 *   preview mode is checked by the canvas assertions);
 * - the Rick and Morty connection List with Next-link paging and its 429 retries: the generated REST
 *   adapter pages by offset only (paging editor dropped, see paging.mjs).
 */
import { action, appApi, appShows, bildr, canvas, check, openApp, openEditor, run, scene, seedPosts, shot, until } from './lib.mjs'

await run('load-more', async ({ page, browser, errors }) => {
  const s = await scene('load-more')
  // 7 rows with their own marker: "LM <n>".
  await seedPosts(Array.from({ length: 7 }, (_, i) => ({ title: `LM ${i + 1}`, slug: `lm-${i + 1}-${Date.now().toString(36)}` })))
  const rows = await appApi('/api/blog/posts?limit=100&offset=0')
  const given = (rows?.body?.items ?? []).filter(row => row.title.startsWith('LM '))
  check(given.length >= 7, `the app lists the 7 rows it was given (${given.length} of ${rows?.body?.items?.length})`)

  const list = await s.ins({ type: 'List', props: {} })
  const made = await action('query_create_for_list', { page: s.file, entity: 'ent_post', as: 'posts', nodeId: list })
  // `loadMore` is the List's page size: it shows that many of the query's rows and a button for the next ones.
  await s.ins({ parentId: list, type: 'Text', props: { text: { $template: 'row {post.title}' } } })
  await action('node_update_props', { file: s.file, nodeId: list, props: { loadMore: 3 } })
  const plain = await s.ins({ type: 'List', props: { items: { $bind: 'posts' }, as: 'p' } })
  await s.ins({ parentId: plain, type: 'Text', props: { text: { $template: 'plain {p.title}' } } })
  const props = bildr(s.filePath).root.children[0].props
  check(props.loadMore === 3 && bildr(s.filePath).uses.queries.some(use => use.query === made.queryId), `the List has loadMore 3 over the page's query (${JSON.stringify(props)})`)

  // The running app: 3, 6, ... up to the table's total, then no button; the plain List keeps its 3.
  // (The table also holds the rows other scripts made, so the total is read from the app.)
  const total = rows?.body?.total ?? 7
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const live = await openApp(context, s.path)
  const marks = () => live.locator('p', { hasText: /^row / }).count()
  // The page is a new route of the app: wait until it renders rows (the app regenerates, and may restart, first).
  const warm = await appShows(browser, s.path, 'row ', 90_000)
  check(warm.html.includes('row '), 'the running app renders the new page')
  if (!await until(async () => (await marks()) > 0, 30_000)) await live.reload()
  await until(async () => (await marks()) > 0, 60_000)
  check(await marks() === 3, `the List shows 3 rows (${await marks()})`)
  check(await until(async () => (await live.locator('p', { hasText: /^plain / }).count()) === total), `a plain List of the same query shows every row (${total}) and no button of its own`)
  const more = live.getByRole('button', { name: /load more/i })
  for (let shown = 3; shown < total; shown += 3) {
    await more.click()
    const expected = Math.min(shown + 3, total)
    check(!!await until(async () => (await marks()) === expected), `Load more shows ${expected}`)
  }
  check(!!await until(async () => (await more.count()) === 0), `then there is no button (${total} rows)`)
  await shot(live, 'load-more-app')
  await context.close()

  // The editor's canvas never shows the button.
  await openEditor(page, s.file)
  check(!!await until(async () => (await canvas(page).locator('[data-node-type="Text"]').count()) > 0, 30_000), 'the canvas renders the List rows')
  check(await canvas(page).getByRole('button', { name: /load more/i }).count() === 0, 'the canvas never shows Load more')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
