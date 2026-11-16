/**
 * Detail pages in the editor on the module (condensed port of e2e/detail-ui.mjs, S34.7): the Data
 * screen's collection panel links the Post's detail page ("Open detail page"), which opens it on the
 * Canvas; the canvas previews a record (the first by default) and the page inspector's Preview record
 * switches it; the Pages list shows the page's route path; `editor_navigate` opens it; the
 * insert-variable picker lists the item's fields; ⌘K reaches it.
 *
 * Dropped (hosted features that don't exist on the module):
 * - "Create detail page" from the Data view with its undo step, the not-public warning, the URL key select
 *   ("Record id" or a slug field) and its path hint, and the link picker's "Detail: <page>" entry:
 *   there is no `page_create_detail` action (U2/U7 open items); a detail page is a page with a `params`
 *   entry (the blog has one) and is made in the Pages list;
 * - Publish and the click-through on the published site: the running app is checked in detail.mjs.
 */
import { action, canvas, check, openData, openEditor, run, seedPosts, shot, until } from './lib.mjs'

await run('detail-ui', async ({ page, errors }) => {
  // The records are the app's: the database starts empty, so the two fixture posts go in through its create route.
  await seedPosts([{ title: 'Hello bildr', slug: 'hello-bildr', published: true }, { title: 'A draft', slug: 'a-draft' }])
  await openData(page)
  await page.locator('[data-collection="posts"]').click()
  // The collection's settings, with its detail page, sit beside its Fields tab.
  await page.locator('[data-data-tab="fields"]').click()
  const link = page.locator('[data-open-detail-page="pg_post_detail"]')
  check(!!await until(() => link.isVisible()), 'the Post collection panel links its detail page')
  check(await page.locator('[data-no-detail-page]').count() === 0, 'and does not say it has none')
  await shot(page, 'detail-ui/collection-panel')
  await link.click()
  await page.locator('[data-testid="design"]').waitFor()
  await canvas(page).locator('[data-node]').first().waitFor({ state: 'attached' })
  const context = await until(async () => {
    const c = await action('editor_context_get')
    return c?.file === 'pg_post_detail' && c
  })
  check(!!context, 'the link opens the detail page on the Canvas (editor_context_get)')

  // The canvas previews a record: the first one's title and body.
  // (the first record is the first row the app answers: the posts other scripts seeded are in the table too)
  const heading = canvas(page).locator('[data-node-type="Heading"]').first()
  const previewed = await until(async () => (await heading.innerText().catch(() => '')).trim() || false, 30_000)
  check(!!previewed && !previewed.includes('{'), `the canvas previews a record: its bound heading reads "${previewed}"`)
  await shot(page, 'detail-ui/preview')

  // The page inspector's Preview record switches it.
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.locator('[data-layer-id="n_page"]').first().click()
  const picker = page.locator('[data-page-collection], [data-preview-record]').first()
  check(await picker.count() > 0, 'the page inspector has the Preview record picker')
  // (the picker is a native select, whose options are the rows' keys)
  const select = picker.locator('select').first()
  if (await select.count()) {
    await select.selectOption({ value: 'a-draft' })
    check(!!await until(async () => (await canvas(page).locator('[data-node-type="Heading"]').first().innerText().catch(() => '')).includes('A draft'), 20_000), 'picking another record previews it')
    check((await action('editor_context_get')).record !== undefined, 'the picked record is reported with the editor context')
  }

  // The Pages list shows the route path; ⌘K reaches the page.
  await page.getByRole('tab', { name: 'Pages' }).click()
  check(await page.locator('[data-page-id="pg_post_detail"]').innerText().then(text => text.includes('/posts/:slug')), 'the Pages list shows the detail page\'s path /posts/:slug')
  await openEditor(page, 'pg_index')
  await page.locator('body').press('Control+k')
  await page.locator('[data-quick-actions] input').fill('posts')
  check(await page.locator('[data-quick-actions] [role=option]').count() > 0, '⌘K finds the page by its name')
  await page.keyboard.press('Escape')

  // editor_navigate opens it with a node selected.
  await action('editor_navigate', { file: 'pg_post_detail', nodeId: 'n_title' })
  check(!!await until(async () => (await page.locator('[data-inspector-head]').innerText().catch(() => '')).includes('n_title')), 'editor_navigate opens the page and selects the heading')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
