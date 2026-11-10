/**
 * Data: an internal collection made in the Data view (Add collection, Fields
 * tab add and rename), records from actions, quick-add, inline edit and a
 * filter in the table; a List of `{{ item.field }}` rows in the canvas and the
 * published app; a `publicCreate` Form that posts through `/api/public`; and
 * the published app's WebMCP tools, probed with a fake `document.modelContext`.
 */
import { action, BASE, canvas, check, openEditor, project, run, shot, toView, until } from './lib.mjs'

const records = async (projectId, collection) => (await action('record_list', { projectId, collection })).records

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

await run('data', async ({ page, context, errors }) => {
  const p = await project('data')
  const pageId = p.pages[0].id

  // The collection and its fields, through the Data view.
  await openEditor(page, p.id)
  await toView(page, 'Data')
  await page.getByLabel('Add collection').click()
  await page.getByLabel('New collection name').fill('Menu')
  await page.getByLabel('New collection name').press('Enter')
  const menu = await until(async () => (await action('project_get', { projectId: p.id })).collections.find(c => c.name === 'Menu'))
  check(menu?.slug === 'menu', 'Add collection creates "Menu"')

  await page.locator('[data-data-tab="fields"]').click()
  for (const [label, type] of [['Name', 'Text'], ['Price', 'Number']]) {
    await page.getByRole('button', { name: 'Add field', exact: true }).click()
    await page.getByLabel('New field label').fill(label)
    if (type !== 'Text') {
      await page.locator('[data-new-field-type]').click()
      await page.getByRole('option', { name: type, exact: true }).click()
    }
    await page.locator('[data-add-field]').getByRole('button', { name: 'Add field' }).click()
    await page.locator(`[data-field="${label.toLowerCase()}"]`).first().waitFor()
  }
  let fields = (await action('project_get', { projectId: p.id })).collections[0].fields
  check(fields.map(f => `${f.key}:${f.type}`).join() === 'name:text,price:number', `the Fields tab adds name and price (${fields.map(f => f.key)})`)

  const priceLabel = page.getByLabel('Label of price')
  await priceLabel.fill('Cost')
  await priceLabel.press('Enter')
  fields = await until(async () => {
    const f = (await action('project_get', { projectId: p.id })).collections[0].fields
    return f[1]?.label === 'Cost' && f
  })
  check(fields, 'the Fields tab renames Price to Cost (the key stays price)')

  // Records: two from actions, one quick-added, one edited inline, then a filter.
  const latte = await action('record_create', { projectId: p.id, collection: 'menu', values: { name: 'Latte', price: 4 } })
  await action('record_create', { projectId: p.id, collection: 'menu', values: { name: 'Espresso', price: 3 } })
  check(await until(async () => (await page.locator('[data-record]').count()) === 2), 'records created over HTTP show in the table')

  await page.getByLabel('New item Name').fill('Mocha')
  await page.getByLabel('New item Cost').fill('5')
  await page.getByLabel('New item Cost').press('Enter')
  const added = await until(async () => (await records(p.id, 'menu')).find(r => r.values.name === 'Mocha'))
  check(added?.values.price === 5, 'quick-add creates Mocha with price 5')
  await page.locator('[data-record]').nth(2).waitFor()

  await page.locator(`[data-record="${latte.id}"] [data-cell$="-0"]`).click()
  await page.locator('[data-cell-input]').fill('Flat white')
  await page.locator('[data-cell-input]').press('Enter')
  const edited = await until(async () => (await records(p.id, 'menu')).find(r => r.id === latte.id && r.values.name === 'Flat white'))
  check(edited, 'inline edit renames Latte to Flat white')

  await page.locator('[data-records-filter]').click()
  await page.locator('[data-filter-value]').fill('esp')
  await page.locator('[data-filter-add]').click()
  const filtered = await until(async () => (await page.locator('[data-record]').count()) === 1)
  check(filtered && await page.locator('[data-record]').filter({ hasText: 'Espresso' }).count() === 1, 'the filter "Name contains esp" leaves Espresso')
  await page.getByRole('button', { name: /^Remove filter/ }).click()
  check(await until(async () => (await page.locator('[data-record]').count()) === 3), 'removing the filter shows all 3 records')
  await shot(page, 'data-table')

  // A List and a Form on the page.
  await action('collection_update', { projectId: p.id, collection: 'menu', publicRead: true })
  await action('collection_create', {
    projectId: p.id,
    name: 'Messages',
    fields: [{ key: 'email', type: 'text' }, { key: 'message', type: 'text' }]
  })
  await action('collection_update', { projectId: p.id, collection: 'messages', publicCreate: true })
  const list = await action('node_insert', { projectId: p.id, pageId, type: 'List', props: { collection: 'menu', sortField: 'price' } })
  await action('node_insert', { projectId: p.id, pageId, parentId: list.nodeId, type: 'Text', props: { text: '{{ item.name }} costs {{ item.price }}' } })
  const form = await action('node_insert', { projectId: p.id, pageId, type: 'Form', props: { collection: 'messages', successMessage: 'Got it' } })
  for (const field of ['email', 'message']) {
    await action('node_insert', { projectId: p.id, pageId, parentId: form.nodeId, type: 'Input', props: { field, label: field } })
  }
  await action('node_insert', { projectId: p.id, pageId, parentId: form.nodeId, type: 'Button', props: { label: 'Send', action: 'submit' } })

  await toView(page, 'Canvas')
  const rows = ['Espresso costs 3', 'Flat white costs 4', 'Mocha costs 5']
  const inCanvas = await until(async () => {
    const texts = await canvas(page).locator('[data-bildr-type="Text"]').allTextContents()
    return rows.every(row => texts.some(t => t.includes(row))) && texts
  })
  check(inCanvas, `the canvas List renders one row per record (${inCanvas})`)

  await action('project_publish', { projectId: p.id })

  // The published app, with a fake WebMCP host.
  await context.addInitScript(fakeModelContext)
  const live = await context.newPage()
  await live.goto(`${BASE}/p/${p.slug}`)
  await live.getByText('Mocha costs 5').waitFor()
  const publishedRows = (await live.locator('[data-bildr-type="Text"]').allTextContents()).map(t => t.trim()).filter(t => t.includes('costs'))
  check(publishedRows.join('|') === rows.join('|'), `the published List renders the rows sorted by price (${publishedRows})`)

  await live.locator('input[name="email"]').fill('e2e@example.com')
  await live.locator('input[name="message"]').fill('Hello from the published app')
  const posted = live.waitForResponse(r => r.url().includes(`/api/public/${p.slug}/messages`) && r.request().method() === 'POST').catch(() => null)
  await live.getByRole('button', { name: 'Send' }).click()
  const response = await posted
  check(response?.ok(), `the published Form posts to /api/public (${response?.status()})`)
  const messages = await until(async () => {
    const stored = await records(p.id, 'messages')
    return stored.length === 1 && stored
  })
  check(messages?.[0]?.values.email === 'e2e@example.com', 'the submitted message is stored')

  const tools = await until(() => live.evaluate(() => (window.__webmcpTools ?? []).map(t => t.name).sort()))
  const expected = ['get_page_content', 'list_pages', 'list_records', 'navigate_to_page', 'submit_form']
  check(expected.every(name => tools.includes(name)), `WebMCP registers ${expected.join(', ')} (got ${tools})`)
  const listed = await live.evaluate(async () => {
    const tool = window.__webmcpTools.find(t => t.name === 'list_records')
    return (await tool.execute({ collection: 'menu' })).content[0].text
  })
  check(listed.includes('Espresso') && listed.includes('Mocha'), 'the WebMCP list_records tool returns the menu')
  await shot(live, 'data-published')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
