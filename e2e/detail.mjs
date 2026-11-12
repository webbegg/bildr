/**
 * Detail pages (S34), driven by actions: an internal Posts collection with a
 * `slug` field and publicRead, a Post detail page in a layout with a bound
 * heading and body (and a List of all posts, whose own items win inside it),
 * a List on Home linking to it, the published and preview detail URLs with
 * their record and title, not-found keys and missing keys, a jsonplaceholder
 * connection detail page by id, the public record endpoint, and WebMCP
 * `list_pages` / `navigate_to_page` / `get_page_content` through a fake
 * `document.modelContext`.
 */
import { action, BASE, check, project, run, shot, until } from './lib.mjs'

const API = 'https://jsonplaceholder.typicode.com'

/** A fake WebMCP host: the tools the app registers land in `window.__webmcpTools`. */
function fakeModelContext() {
  window.__webmcpTools = []
  const modelContext = {
    registerTool: tool => window.__webmcpTools.push(tool),
    unregisterTool: (name) => {
      window.__webmcpTools = window.__webmcpTools.filter(tool => tool.name !== name)
    }
  }
  Object.defineProperty(document, 'modelContext', { value: modelContext, configurable: true })
}

const texts = async (page, type) => (await page.locator(`[data-bildr-type="${type}"]`).allTextContents()).map(t => t.trim())

await run('detail', async ({ page, context, errors }) => {
  const p = await project('detail')
  const projectId = p.id
  const home = p.pages[0].id
  const call = (name, input = {}) => action(name, { projectId, ...input })

  // Data: Posts (internal, slug field, publicRead) and Drafts (not public).
  await call('collection_create', { name: 'Posts', fields: [{ key: 'title', type: 'text' }, { key: 'slug', type: 'text' }, { key: 'body', type: 'text' }] })
  await call('collection_update', { collection: 'posts', publicRead: true })
  await call('record_create', { collection: 'posts', values: { title: 'Hello', slug: 'hello-world', body: 'The first post' } })
  await call('record_create', { collection: 'posts', values: { title: 'Second', slug: 'second', body: 'Another post' } })
  await call('collection_create', { name: 'Drafts', fields: [{ key: 'slug', type: 'text' }] })
  await call('record_create', { collection: 'drafts', values: { slug: 'secret' } })

  // The detail page, inside a layout whose own text reads the record too.
  const { pageId: postId } = await call('page_add', { name: 'Post', collection: { slug: 'posts' } })
  const { layoutId } = await call('layout_create', { name: 'Frame' })
  await call('node_insert', { layoutId, index: 0, type: 'Text', props: { text: 'Layout: {{ item.title }}' } })
  await call('page_set_layout', { pageId: postId, layoutId })
  await call('node_insert', { pageId: postId, type: 'Heading', props: { text: '{{ item.title }}' } })
  await call('node_insert', { pageId: postId, type: 'Text', props: { text: 'Body: {{ item.body }}' } })
  // A component instance whose property value binds the record.
  const { nodeId: tagText } = await call('node_insert', { pageId: postId, type: 'Text', props: { text: 'tag' } })
  const { componentId, nodeId: tagInstance } = await call('component_create', { pageId: postId, nodeId: tagText, name: 'Tag' })
  const tagRoot = (await call('project_get')).components.find(c => c.id === componentId).root.id
  const { propertyId } = await call('component_property_add', { componentId, name: 'Label', kind: 'textarea', bindings: [{ nodeId: tagRoot, prop: 'text' }] })
  await call('instance_set_values', { pageId: postId, nodeId: tagInstance, values: { [propertyId]: 'Tag: {{ item.slug }}' } })
  const { nodeId: innerList } = await call('node_insert', { pageId: postId, type: 'List', props: { collection: 'posts' } })
  await call('node_insert', { pageId: postId, parentId: innerList, type: 'Text', props: { text: 'Listed: {{ item.title }}' } })

  // Home: a List linking to each post's detail page.
  const { nodeId: list } = await call('node_insert', { pageId: home, type: 'List', props: { collection: 'posts' } })
  await call('node_insert', { pageId: home, parentId: list, type: 'Link', props: { label: 'Read {{ item.title }}', to: 'post/{{ item.slug }}' } })

  // A jsonplaceholder connection, its posts read by id (no slug field), and a detail page.
  const { connection } = await call('connection_create', { name: 'JSONPlaceholder', baseUrl: API })
  await call('collection_create', {
    name: 'JP posts',
    slug: 'jp-posts',
    source: { type: 'connection', connectionId: connection.id, endpoints: { list: { method: 'GET', path: '/posts' }, get: { method: 'GET', path: '/posts/{id}' } } },
    fields: [{ key: 'title', type: 'text' }, { key: 'body', type: 'text' }]
  })
  await call('collection_update', { collection: 'jp-posts', publicRead: true })
  const { pageId: jpId } = await call('page_add', { name: 'JP post' })
  const set = await call('page_set_collection', { pageId: jpId, collection: { slug: 'jp-posts' } })
  await call('node_insert', { pageId: jpId, type: 'Heading', props: { text: '{{ item.title }}' } })
  check(set.keyField === 'id' && set.path === '/jp-post/:id', `page_set_collection on a collection without slug keys by id (${set.keyField}, ${set.path})`)
  const jp1 = await (await fetch(`${API}/posts/1`)).json()

  // Keys that are not URL-safe: Notes keyed by title, listed on a Notes page that links to each.
  const tricky = ['What is new?', 'Part #2', 'a/b']
  await call('collection_create', { name: 'Notes', fields: [{ key: 'title', type: 'text' }] })
  await call('collection_update', { collection: 'notes', publicRead: true })
  for (const title of tricky) await call('record_create', { collection: 'notes', values: { title } })
  const { pageId: byTitle } = await call('page_add', { name: 'By title', slug: 'bytitle', collection: { slug: 'notes', field: 'title' } })
  await call('node_insert', { pageId: byTitle, type: 'Heading', props: { text: 'Note: {{ item.title }}' } })
  const { pageId: notesPage } = await call('page_add', { name: 'Notes', slug: 'notes' })
  const { nodeId: notesList } = await call('node_insert', { pageId: notesPage, type: 'List', props: { collection: 'notes' } })
  await call('node_insert', { pageId: notesPage, parentId: notesList, type: 'Link', props: { label: 'Open {{ item.title }}', to: 'bytitle/{{ item.title }}' } })

  await call('project_publish')

  /**
   * The Notes List links open each tricky key, and each detail URL shows it.
   * One load of the List, then back with history: every full load of the dev
   * server fetches hundreds of modules, and too many in one tab (about 24)
   * exhaust Chromium, so the direct loads go to a fresh tab, closed after.
   */
  async function checkTrickyKeys(base, suffix, label) {
    await page.goto(`${BASE}${base}/notes`)
    await page.getByText('Open Part #2').waitFor()
    for (const title of tricky) {
      await page.getByText(`Open ${title}`, { exact: true }).click()
      await page.waitForURL(url => url.pathname === `${base}/bytitle/${encodeURIComponent(title)}`)
      await page.getByRole('heading', { name: `Note: ${title}`, exact: true }).waitFor()
      check(true, `${label}: the List link of "${title}" opens it`)
      await page.goBack()
      await page.getByText(`Open ${title}`, { exact: true }).waitFor()
    }
    const fresh = await page.context().newPage()
    for (const title of tricky) {
      await fresh.goto(`${BASE}${base}/bytitle/${encodeURIComponent(title)}`)
      await fresh.getByRole('heading', { name: `Note: ${title}`, exact: true }).waitFor()
      check(await until(async () => (await fresh.title()) === `${title} · ${p.name}${suffix}`), `${label}: the detail URL of "${title}" shows it (${await fresh.title()})`)
    }
    await fresh.close()
  }

  // The published app, with a fake WebMCP host.
  await context.addInitScript(fakeModelContext)
  const live = page
  await live.goto(`${BASE}/p/${p.slug}`)
  await live.getByText('Read Hello').waitFor()
  const links = await live.locator('[data-bildr-type="Link"]').evaluateAll(els => els.map(a => a.getAttribute('href')))
  check(links.join() === `/p/${p.slug}/post/hello-world,/p/${p.slug}/post/second`, `the Home List links to each detail page (${links})`)

  await live.getByText('Read Hello').click()
  await live.waitForURL(`**/p/${p.slug}/post/hello-world`)
  await live.getByRole('heading', { name: 'Hello' }).waitFor()
  check((await texts(live, 'Text')).includes('Body: The first post'), 'the published detail page binds the body to the record')
  check((await live.getByText('Layout: Hello').count()) === 1, 'the layout around the detail page reads the record too')
  check((await live.getByText('Tag: hello-world').count()) === 1, 'a component property value on the detail page reads the record')
  const listed = (await texts(live, 'Text')).filter(t => t.startsWith('Listed: '))
  check(listed.join('|') === 'Listed: Hello|Listed: Second', `a List on the detail page keeps its own items (${listed})`)
  check(await until(async () => (await live.title()) === `Hello · ${p.name}`), `the published detail title is "<record title> · <project>" (${await live.title()})`)
  await shot(live, 'detail/published')

  // WebMCP: list_pages marks the detail page, navigate_to_page takes a key, get_page_content reads the record.
  const pages = JSON.parse(await live.evaluate(async () => (await window.__webmcpTools.find(t => t.name === 'list_pages').execute({})).content[0].text))
  const postEntry = pages.find(e => e.slug === 'post')
  check(postEntry?.collection === 'posts' && postEntry.keyField === 'slug' && postEntry.url === `/p/${p.slug}/post/:slug`, `WebMCP list_pages marks the detail page (${JSON.stringify(postEntry)})`)
  const navigated = await live.evaluate(async () => (await window.__webmcpTools.find(t => t.name === 'navigate_to_page').execute({ slug: 'post', key: 'second' })).content[0].text)
  await live.waitForURL(`**/p/${p.slug}/post/second`)
  await live.getByRole('heading', { name: 'Second' }).waitFor()
  check(navigated === `Navigated to /p/${p.slug}/post/second`, `WebMCP navigate_to_page with a key opens the record (${navigated})`)
  const outline = await until(async () => {
    const text = await live.evaluate(async () => (await window.__webmcpTools.find(t => t.name === 'get_page_content').execute({})).content[0].text)
    return text.includes('Heading: Second') && text
  })
  check(outline && outline.startsWith(`Page "Post" (/p/${p.slug}/post/second)`), `WebMCP get_page_content outlines the current record (${String(outline).split('\n')[0]})`)
  const keyless = await live.evaluate(async () => (await window.__webmcpTools.find(t => t.name === 'navigate_to_page').execute({ slug: 'post' })))
  check(keyless.isError === true && keyless.content[0].text.includes('give its key'), 'WebMCP navigate_to_page refuses a detail page without a key')

  // Not found: an unknown key, no key, a key on a plain page, and a collection without publicRead (in a fresh tab, see checkTrickyKeys).
  const fresh = await page.context().newPage()
  for (const [path, what] of [['post/nope', 'an unknown key'], ['post', 'a detail page without a key'], ['home/extra', 'a plain page with an extra segment'], ['post/hello-world/extra', 'a detail page with an extra segment'], ['home/a/b/c', 'a path of many segments']]) {
    await fresh.goto(`${BASE}/p/${p.slug}/${path}`)
    await fresh.getByText('Page not found').waitFor()
    check(await until(async () => (await fresh.title()) === 'Not found'), `${what} shows not found (/p/${p.slug}/${path})`)
  }
  await fresh.close()

  // The remote detail page, by id through the Get endpoint.
  await live.goto(`${BASE}/p/${p.slug}/jp-post/1`)
  await live.getByRole('heading', { name: jp1.title }).waitFor({ timeout: 20_000 })
  check(await until(async () => (await live.title()) === `${jp1.title} · ${p.name}`), `the jsonplaceholder detail page shows post 1 by id ("${jp1.title}")`)
  await live.goto(`${BASE}/p/${p.slug}/jp-post/99999`)
  await live.getByText('Page not found').waitFor({ timeout: 20_000 })
  check(true, 'an unknown jsonplaceholder id shows not found')

  // Keys with ?, # and /: the record read, the detail URL, the List links, and WebMCP.
  await live.goto(`${BASE}/p/${p.slug}/notes`)
  await live.getByText('Open Part #2').waitFor()
  const noteLinks = await live.locator('[data-bildr-type="Link"]').evaluateAll(els => els.map(a => a.getAttribute('href')))
  check(noteLinks.join() === tricky.map(t => `/p/${p.slug}/bytitle/${encodeURIComponent(t)}`).join(), `List links encode their key (${noteLinks})`)
  for (const title of tricky) {
    const response = await fetch(`${BASE}/api/public/${p.slug}/notes/record?key=${encodeURIComponent(title)}&field=title`)
    const read = response.ok ? await response.json() : null
    check(response.status === 200 && read?.record.values.title === title, `the record read finds "${title}" (${response.status})`)
  }
  await checkTrickyKeys(`/p/${p.slug}`, '', 'published')
  const cut = await fetch(`${BASE}/api/public/${p.slug}/notes/record?key=${encodeURIComponent('What is new')}&field=title`)
  check(cut.status === 404, `a key is never cut at an encoded ? (${cut.status})`)
  await live.evaluate(async () => window.__webmcpTools.find(t => t.name === 'navigate_to_page').execute({ slug: 'bytitle', key: 'Part #2' }))
  await live.getByRole('heading', { name: 'Note: Part #2', exact: true }).waitFor()
  check(new URL(live.url()).pathname === `/p/${p.slug}/bytitle/Part%20%232`, `WebMCP navigate_to_page encodes the key the same way (${live.url()})`)

  // The public record endpoint: GET only, publicRead only, 404 for unknown keys, declared fields only.
  const endpoint = `${BASE}/api/public/${p.slug}/posts/record`
  const one = await fetch(`${endpoint}?key=hello-world&field=slug`)
  const body = await one.json()
  check(one.status === 200 && body.record?.values.title === 'Hello' && Object.keys(body.record).sort().join() === 'createdAt,id,updatedAt,values', `GET /api/public/<p>/<c>/record?key= answers the record (${one.status})`)
  check((await fetch(`${endpoint}?key=nope`)).status === 404, 'an unknown key answers 404')
  check((await fetch(endpoint)).status === 404, 'no key answers 404')
  check((await fetch(`${BASE}/api/public/${p.slug}/drafts/record?key=secret`)).status === 404, 'a collection without publicRead answers 404')
  for (const method of ['DELETE', 'PUT', 'PATCH', 'POST']) {
    const response = await fetch(`${endpoint}?key=hello-world`, { method })
    check(response.status === 405 && response.headers.get('allow') === 'GET', `${method} on a record answers 405`)
  }
  const remote = await (await fetch(`${BASE}/api/public/${p.slug}/jp-posts/record?key=2`)).json()
  check(remote.record?.id === '2' && !JSON.stringify(remote).includes('typicode'), 'the remote record comes without source details')

  // The draft preview: record_find, the same not-found rules, the draft title.
  await live.goto(`${BASE}/preview/${projectId}/post/second`)
  await live.getByRole('heading', { name: 'Second' }).waitFor()
  check(await until(async () => (await live.title()) === `Second · ${p.name} (draft)`), `the preview detail page shows the record and title (${await live.title()})`)
  const missing = await page.context().newPage()
  await missing.goto(`${BASE}/preview/${projectId}/post/nope`)
  await missing.getByText('Page not found').waitFor()
  check(true, 'the preview shows not found for an unknown key')
  await missing.goto(`${BASE}/preview/${projectId}/post/second/extra`)
  await missing.getByText('Page not found').waitFor()
  check(true, 'the preview shows not found for an extra segment')
  await missing.close()
  await checkTrickyKeys(`/preview/${projectId}`, ' (draft)', 'preview')
  await live.goto(`${BASE}/preview/${projectId}`)
  await live.getByText('Read Second').waitFor()
  check(true, 'the preview still opens the first page without a segment')
  await shot(live, 'detail/preview')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/status of 404/] })
