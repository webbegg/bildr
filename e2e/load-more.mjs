/**
 * Load more in published Lists and the preview (S34.9), driven by actions:
 * an internal Posts collection of 7 records (publicRead) and a List with
 * limit 3 and `loadMore` shows 3, then 6, then 7, then no button, in the
 * published app and the draft preview; a plain List of the same query keeps
 * its 3; the canvas never shows the button. A Rick and Morty connection List
 * (Next link paging) loads its second page in the published app, retrying
 * while the API answers 429.
 */
import { action, BASE, check, canvas, openEditor, project, run, shot, until } from './lib.mjs'

const API = 'https://rickandmortyapi.com/api'

const titles = async (page, prefix) => (await page.locator('[data-bildr-type="Text"]').allTextContents()).map(t => t.trim()).filter(t => t.startsWith(prefix))

/** Clicks Load more under the List holding `marker` texts until it shows `count` of them; true when it did. */
async function loadTo(page, prefix, count) {
  await page.locator('[data-bildr-load-more] button').click()
  return !!(await until(async () => (await titles(page, prefix)).length === count))
}

/** The 3, 6, 7 and done run of the Posts List, at `url`; `label` names the app. */
async function checkPosts(page, url, label) {
  await page.goto(url)
  await page.getByText('More: Post 1', { exact: true }).waitFor()
  const button = page.locator('[data-bildr-load-more] button')
  check((await titles(page, 'More:')).length === 3, `${label}: the List shows its limit of 3 (${await titles(page, 'More:')})`)
  check(await button.count() === 1 && (await button.innerText()).trim() === 'Load more', `${label}: a Load more button shows under the List`)
  check((await titles(page, 'Plain:')).length === 3, `${label}: the plain List of the same query shows 3`)
  check(await page.getByRole('button', { name: 'Load more' }).isEnabled(), `${label}: the button is enabled`)
  await shot(page, `load-more-${label}-3`)

  // Keyboard: focus and Enter.
  await button.focus()
  await page.keyboard.press('Enter')
  const six = !!(await until(async () => (await titles(page, 'More:')).length === 6))
  check(six, `${label}: Enter on the focused button loads 3 more (${(await titles(page, 'More:')).length})`)
  const focused = await until(() => page.evaluate(() => (document.activeElement?.closest('[data-bildr-load-more]') && document.activeElement.textContent.trim() === 'Load more' && !document.activeElement.getAttribute('aria-busy')) || false))
  check(!!focused, `${label}: the keyboard focus stays on the Load more button once the load finishes (${await page.evaluate(() => document.activeElement?.tagName)})`)
  const seven = await loadTo(page, 'More:', 7)
  const shown = await titles(page, 'More:')
  check(seven && shown.join() === [1, 2, 3, 4, 5, 6, 7].map(n => `More: Post ${n}`).join(), `${label}: the next click loads the last one, in order without repeats (${shown})`)
  check(!!(await until(async () => (await button.count()) === 0)), `${label}: no button once every record shows`)
  check((await titles(page, 'Plain:')).length === 3, `${label}: the plain List still shows 3`)
  await shot(page, `load-more-${label}-7`)
}

await run('load-more', async ({ page, errors }) => {
  const p = await project('load-more')
  const projectId = p.id
  const home = p.pages[0].id
  const call = (name, input = {}) => action(name, { projectId, ...input })

  await call('collection_create', { name: 'Posts', fields: [{ key: 'title', type: 'text' }] })
  await call('collection_update', { collection: 'posts', publicRead: true })
  for (let n = 1; n <= 7; n++) await call('record_create', { collection: 'posts', values: { title: `Post ${n}` } })

  const { nodeId: more } = await call('node_insert', { pageId: home, type: 'List', props: { collection: 'posts', limit: 3, loadMore: true } })
  await call('node_insert', { pageId: home, parentId: more, type: 'Text', props: { text: 'More: {{ item.title }}' } })
  const { nodeId: plain } = await call('node_insert', { pageId: home, type: 'List', props: { collection: 'posts', limit: 3 } })
  await call('node_insert', { pageId: home, parentId: plain, type: 'Text', props: { text: 'Plain: {{ item.title }}' } })
  const saved = (await call('project_get')).pages[0].root.children.find(n => n.id === more)
  check(saved?.props.loadMore === true, 'node_insert keeps loadMore on the List')

  // Rick and Morty: a paged connection collection on its own page.
  const created = await call('connection_create', { name: 'Rick', baseUrl: API })
  const connectionId = created.connectionId ?? created.connection?.id
  await call('collection_create', {
    name: 'Characters',
    slug: 'characters',
    fields: [{ key: 'name', type: 'text', path: 'name' }],
    source: { type: 'connection', connectionId, endpoints: { list: { method: 'GET', path: '/character', itemsPath: 'results', paging: { type: 'next', nextPath: 'info.next', totalPath: 'info.count' } }, get: { method: 'GET', path: '/character/{id}' } } }
  })
  await call('collection_update', { collection: 'characters', publicRead: true })
  const { pageId: rick } = await call('page_add', { name: 'Rick' })
  const { nodeId: chars } = await call('node_insert', { pageId: rick, type: 'List', props: { collection: 'characters', limit: 20, loadMore: true } })
  await call('node_insert', { pageId: rick, parentId: chars, type: 'Text', props: { text: 'Character: {{ item.id }} {{ item.name }}' } })

  await call('project_publish')

  await checkPosts(page, `${BASE}/p/${p.slug}`, 'published')
  await checkPosts(page, `${BASE}/preview/${projectId}`, 'preview')

  // A failed read: the button stays, with a generic message.
  await page.goto(`${BASE}/p/${p.slug}`)
  await page.getByText('More: Post 1', { exact: true }).waitFor()
  await page.route('**/api/public/**offset=**', route => route.fulfill({ status: 502, body: '{}' }))
  await page.locator('[data-bildr-load-more] button').click()
  const alert = page.locator('[data-bildr-load-more] [role="alert"]')
  await alert.waitFor()
  check((await alert.innerText()).trim() === 'Could not load more, try again later', `a failed read shows "${(await alert.innerText()).trim()}"`)
  check((await titles(page, 'More:')).length === 3 && await page.locator('[data-bildr-load-more] button').isEnabled(), 'it keeps the 3 records and the button to retry')
  await page.unroute('**/api/public/**offset=**')
  check(await loadTo(page, 'More:', 6), 'a retry loads the next 3')

  // The canvas shows the limit and no button.
  await openEditor(page, projectId)
  const frame = canvas(page)
  await frame.getByText('More: Post 3', { exact: true }).waitFor()
  check(await frame.getByText('More: Post 4', { exact: true }).count() === 0, 'the canvas shows only the limit of 3')
  check(await frame.locator('[data-bildr-load-more]').count() === 0, 'the canvas has no Load more button')

  // Rick and Morty: page two through the public endpoint (offset 20), retried on 429.
  const characters = () => titles(page, 'Character:')
  let first = false
  for (let attempt = 1; attempt <= 4 && !first; attempt++) {
    await page.goto(`${BASE}/p/${p.slug}/rick`)
    first = !!(await until(async () => (await characters()).length === 20, 20_000))
    if (!first) {
      console.log('NOTE Rick: the first page did not load (likely 429), retrying')
      await page.waitForTimeout(5000)
    }
  }
  check(first, `Rick and Morty: the published List shows its first 20 (${(await characters()).length})`)
  let second = false
  for (let attempt = 1; attempt <= 4 && first && !second; attempt++) {
    await page.locator('[data-bildr-load-more] button').click()
    await until(async () => (await characters()).length === 40 || (await page.locator('[data-bildr-load-more] [role="alert"]').count()) > 0, 30_000)
    second = (await characters()).length === 40
    if (!second) {
      console.log('NOTE Rick: Load more failed (likely 429), retrying')
      await page.waitForTimeout(5000)
    }
  }
  const names = await characters()
  check(second && new Set(names).size === 40, `Rick and Morty: Load more reads the second page (${names.length} records, ${new Set(names).size} distinct ids, ${names[19]} → ${names[20]})`)
  check(await page.locator('[data-bildr-load-more] button').count() === 1, 'the button stays: more characters follow')
  await shot(page, 'load-more-rick')

  check(errors.length === 0, `no console errors besides the API's 429s and the forced failure${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/HTTP 429/, /rate limiting/, /502/] })
