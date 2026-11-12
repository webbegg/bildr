/**
 * Detail pages in the editor (S34.7): "Create detail page" from the Data
 * view (a page bound to the collection with a bound Heading and Text), the
 * canvas previewing the first record and the page inspector's Preview record
 * switching it, the not-public warning, the URL key select and its path
 * hint, the Pages badge and path hint, `editor_navigate` with a recordId,
 * the insert-variable picker's item fields, ⌘K, and the link picker's
 * "Detail: <page>" entry inside a List (disabled outside one), then Publish
 * and a click through on the published site to the record.
 */
import { action, BASE, canvas, check, openEditor, project, run, shot, toView, until } from './lib.mjs'

await run('detail-ui', async ({ page, errors }) => {
  const p = await project('detail-ui')
  const projectId = p.id
  const home = p.pages[0]
  const call = (name, input = {}) => action(name, { projectId, ...input })
  const doc = () => call('project_get')

  await call('collection_create', { name: 'Posts', fields: [{ key: 'title', type: 'text' }, { key: 'slug', type: 'text' }, { key: 'body', type: 'text' }] })
  await call('record_create', { collection: 'posts', values: { title: 'Hello', slug: 'hello-world', body: 'The first post' } })
  const second = await call('record_create', { collection: 'posts', values: { title: 'Second', slug: 'second', body: 'Another post' } })
  // Home: a List of posts with a Link in it, and a Link outside it.
  const { nodeId: list } = await call('node_insert', { pageId: home.id, type: 'List', props: { collection: 'posts' } })
  const { nodeId: listLink } = await call('node_insert', { pageId: home.id, parentId: list, type: 'Link', props: { label: 'Read {{ item.title }}' } })
  const { nodeId: looseLink } = await call('node_insert', { pageId: home.id, type: 'Link', props: { label: 'Loose' } })

  // Create detail page, from the collection's panel in the Data view.
  await openEditor(page, projectId)
  await toView(page, 'Data')
  await page.locator('[data-detail-page-section]').waitFor()
  await shot(page, 'detail/data-create')
  await page.locator('[data-create-detail-page]').click()
  const created = await until(async () => (await doc()).pages.find(pg => pg.collection?.slug === 'posts' && pg.root.children.length === 2))
  check(created?.name === 'Posts' && created.slug === 'posts', `Create detail page adds "Posts" bound to the collection (${created?.name}, /${created?.slug})`)
  const [heading, body] = created?.root.children ?? []
  check(heading?.type === 'Heading' && heading.props.text === '{{ item.title }}' && body?.type === 'Text' && body.props.text === '{{ item.body }}', 'it holds a Heading bound to the title and a Text bound to the body')
  await page.locator('[data-view-menu]').filter({ hasText: 'Canvas' }).waitFor()
  check(true, 'Create detail page opens the page on the Canvas')
  await canvas(page).getByRole('heading', { name: 'Hello' }).waitFor()
  check(await canvas(page).getByText('The first post').count() === 1, 'the canvas previews the first record')

  // Back in the Data view, the panel links to the page.
  await toView(page, 'Data')
  await page.getByLabel('Detail page: Posts').waitFor()
  check(true, 'the collection panel shows "Detail page: Posts"')
  await page.getByLabel('Detail page: Posts').click()
  await page.locator('[data-view-menu]').filter({ hasText: 'Canvas' }).waitFor()
  await canvas(page).getByRole('heading', { name: 'Hello' }).waitFor()
  check(true, 'its link opens the detail page')

  // Pages: the badge and the path hint.
  const row = page.locator(`[data-page-id="${created.id}"]`)
  check(await row.locator('[data-page-collection-badge="posts"]').count() === 1, 'the Pages row has the collection badge')
  check((await row.textContent()).includes('/posts/:slug'), `the Pages row reads /posts/:slug (${(await row.textContent()).trim()})`)

  // The page inspector: select the page root.
  await call('editor_navigate', { pageId: created.id, nodeId: created.root.id })
  await page.getByLabel('Page collection').waitFor()
  check((await page.getByLabel('Page collection').textContent()).includes('Posts'), 'the Collection select shows Posts')
  check(await page.locator('[data-page-not-public]').textContent().then(t => t.includes('Visitors can\'t open this page until the collection is public')), 'a warning shows while the collection is not public')
  await call('collection_update', { collection: 'posts', publicRead: true })
  check(await until(async () => (await page.locator('[data-page-not-public]').count()) === 0), 'the warning goes once the collection is public')
  await shot(page, 'detail/inspector')

  // Preview record: switching it changes the canvas.
  await page.getByLabel('Preview record').click()
  await page.getByRole('option', { name: 'Second', exact: true }).click()
  await canvas(page).getByRole('heading', { name: 'Second' }).waitFor()
  check(await canvas(page).getByText('Another post').count() === 1, 'choosing the Second preview record shows it on the canvas')

  // URL key: Title, then back to the default Slug.
  check((await page.getByLabel('URL key').textContent()).includes('Slug'), 'the URL key defaults to Slug')
  await page.getByLabel('URL key').click()
  check(await page.getByRole('option', { name: 'Record id' }).getAttribute('data-disabled') !== null, 'Record id is disabled while a slug field is the default')
  await page.getByRole('option', { name: 'Title (title)' }).click()
  const titled = await until(async () => (await doc()).pages.find(pg => pg.id === created.id)?.collection?.field === 'title')
  check(titled, 'the URL key select sets the key field to title')
  await until(async () => (await page.locator('[data-page-path]').textContent())?.includes('/posts/:title'))
  check((await page.locator('[data-page-path]').textContent()).trim() === '/posts/:title', 'the path hint follows the key (/posts/:title)')
  // A selection made while Pages shows reveals it in Layers, so back to Pages.
  await page.getByRole('tab', { name: 'Pages' }).click()
  check((await row.textContent()).includes('/posts/:title'), 'so does the Pages row')
  await page.getByLabel('URL key').click()
  await page.getByRole('option', { name: 'Slug (slug)' }).click()
  check(await until(async () => (await doc()).pages.find(pg => pg.id === created.id)?.collection?.field === 'slug'), 'and back to slug')

  // editor_navigate with a recordId previews that record.
  await page.getByLabel('Preview record').click()
  await page.getByRole('option', { name: 'Hello', exact: true }).click()
  await canvas(page).getByRole('heading', { name: 'Hello' }).waitFor()
  await call('editor_navigate', { pageId: created.id, recordId: second.id })
  await canvas(page).getByRole('heading', { name: 'Second' }).waitFor()
  check(true, 'editor_navigate with a recordId previews that record')

  // The insert-variable picker lists the record's fields on the detail page.
  await call('editor_navigate', { pageId: created.id, nodeId: heading.id })
  await page.getByLabel('Text', { exact: true }).waitFor()
  await page.locator('[data-prop-row="text"] [data-variable-picker]').click()
  const menu = page.getByRole('menu')
  await menu.waitFor()
  const entries = await menu.getByRole('menuitem').allTextContents()
  check(['item.title', 'item.slug', 'item.body', 'item.id', 'item.createdAt', 'item.updatedAt'].every(name => entries.some(e => e.includes(name))), `the variable picker lists item fields (${entries.length} entries)`)
  await shot(page, 'detail/variables')
  await menu.getByRole('menuitem').filter({ hasText: 'item.slug' }).click()
  const inserted = await until(async () => findIn((await doc()).pages.find(pg => pg.id === created.id).root, heading.id)?.props.text.includes('{{ item.slug }}'))
  check(inserted, 'picking item.slug inserts {{ item.slug }}')
  await page.keyboard.press('Escape')

  // ⌘K: the detail page commands.
  await page.locator('body').press('Control+k')
  const palette = page.locator('[data-quick-actions]')
  await palette.waitFor()
  await page.keyboard.type('Create detail page')
  check(await palette.getByText('Create detail page for Posts').count() === 1, '⌘K offers "Create detail page for Posts"')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Set page collection')
  check(await palette.getByText('Set page collection › None').count() === 1, '⌘K offers "Set page collection ›"')
  await page.keyboard.press('Escape')

  // The link picker on Home: Detail inside the List, disabled outside it.
  await call('editor_navigate', { pageId: home.id, nodeId: looseLink })
  await page.getByLabel('Link to', { exact: true }).click()
  const looseEntry = page.getByRole('option', { name: /Detail: Posts/ })
  check(await looseEntry.getAttribute('data-disabled') !== null, 'outside a List the Detail entry is disabled')
  check((await looseEntry.textContent()).includes('Put this inside a List of Posts'), 'with a hint')
  await page.keyboard.press('Escape')
  await call('editor_navigate', { pageId: home.id, nodeId: listLink })
  await page.getByLabel('Link to', { exact: true }).click()
  await page.getByRole('option', { name: /Detail: Posts/ }).click()
  const linked = await until(async () => findIn((await doc()).pages[0].root, listLink)?.props.to === 'posts/{{ item.slug }}')
  check(linked, 'inside the List, Detail: Posts stores posts/{{ item.slug }}')
  await until(async () => (await page.getByLabel('Link to', { exact: true }).textContent()).includes('Detail: Posts'))
  check((await page.getByLabel('Link to', { exact: true }).textContent()).includes('Detail: Posts'), 'the picker shows the stored link as Detail: Posts, not External URL')
  await shot(page, 'detail/link-picker')

  // Publish, then click through on the published site.
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  check(await until(async () => (await call('project_get')).publishedVersion ?? (await fetch(`${BASE}/p/${p.slug}`)).ok), 'Publish publishes the project')
  await until(async () => (await fetch(`${BASE}/p/${p.slug}`)).ok)
  await page.goto(`${BASE}/p/${p.slug}`)
  await page.getByText('Read Hello').click()
  await page.waitForURL(`**/p/${p.slug}/posts/hello-world`)
  await page.getByRole('heading', { name: 'Hello' }).waitFor()
  check(await page.getByText('The first post').count() === 1, 'the published List links through to the record\'s detail page')
  await shot(page, 'detail/published-ui')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})

function findIn(node, id) {
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const found = findIn(child, id)
    if (found) return found
  }
  return undefined
}
