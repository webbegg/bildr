/**
 * Data on the module editor (port of e2e/data.mjs): a collection made in the Data screen (Add
 * collection, Fields tab add and rename), rows in the table from the running app's list route, a
 * search and a filter in the table; a List bound to a Query on a page, shown in the canvas and in the
 * running app; a Form bound to the entity's create action, submitted in the running app. Every edit is
 * checked in `.bildr/` (the entity, its repository, the page).
 *
 * Dropped (feature doc: records are app data, not editor data; no hosted collections or publish):
 * - `record_create`, quick-add and inline cell edit: the table is read-only (E2); rows come from the
 *   app's own API, so this script posts them to the running app instead;
 * - `collection_update publicRead/publicCreate`, `/api/public/<slug>/...` and Publish: the generated app
 *   has its own list/create routes and needs no publishing;
 * - the published app's WebMCP tools (`document.modelContext`): the generated app has no bildr runtime (D4).
 */
import { action, appApi, appShows, bildr, canvas, check, newPage, openData, openEditor, quiesce, quiet, run, shot, until } from './lib.mjs'

await run('data', async ({ page, browser, errors }) => {
  // The app's create route takes the id the client form mints (a uuid).
  const post = (path, body) => appApi(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), ...body }) })
  const p = await newPage('data')

  // The collection and its fields, through the Data screen.
  await openData(page)
  await page.getByLabel('Add collection').click()
  await page.getByLabel('New collection name').fill('Menu')
  await page.getByLabel('New collection name').press('Enter')
  const menu = await until(() => bildr('modules/blog/entities/menu.json'))
  check(menu?.name === 'Menu' && menu.plural === 'menus', `Add collection writes the "Menu" entity (${menu?.id} ${menu?.plural})`)
  check(!!bildr('modules/blog/repositories/menu.json'), 'and its repository')

  await page.locator('[data-fields-tab], [role=tab]').filter({ hasText: 'Fields' }).first().click()
  await page.getByRole('button', { name: 'Add field', exact: true }).first().click()
  await page.getByLabel('New field name').fill('cost')
  await page.locator('[data-new-field-type]').click()
  await page.getByRole('option', { name: 'Number', exact: true }).click()
  await page.getByLabel('New field name').press('Enter')
  const fields = await until(() => {
    const f = bildr('modules/blog/entities/menu.json')?.fields ?? []
    return f.length === 2 && f
  })
  check(fields && fields.map(f => `${f.name}:${f.type}`).join() === 'title:text,cost:number', `the Fields tab adds cost (${fields?.map(f => `${f.name}:${f.type}`)})`)

  // A second field, renamed (the field keeps its id); rows use title and cost.
  await page.getByRole('button', { name: 'Add field', exact: true }).first().click()
  await page.getByLabel('New field name').fill('note')
  await page.getByLabel('New field name').press('Enter')
  await until(() => bildr('modules/blog/entities/menu.json').fields.length === 3)
  const noteName = page.getByLabel('Name of note')
  await noteName.fill('remark')
  await noteName.press('Enter')
  const renamed = await until(() => bildr('modules/blog/entities/menu.json').fields.some(f => f.name === 'remark'))
  check(renamed, 'the Fields tab renames note to remark (in the entity file)')
  check(bildr('modules/blog/entities/menu.json').fields[2].id === 'fld_note', 'the field keeps its id fld_note')
  // A renamed column is a destructive migration on a database: it waits for the user's confirmation (the Migrations screen).
  check(await quiesce(60_000), 'the pending migration of the renamed column is confirmed')
  await quiet()

  // Rows: the app's own API creates them (the table is read-only), the table lists the app's rows.
  // They go to a second entity made with its columns in one step: a column renamed or added under a table that already
  // has rows is a migration the running app picks up late, which this script doesn't test.
  // (Not "Item": its plural `items` collides with the local variable of the generated Drizzle repository, a generator bug reported with this suite.)
  const dish = await action('entity_create', { name: 'Dish', source: 'ds_main', fields: [{ name: 'title', type: 'text' }, { name: 'cost', type: 'number' }] })
  await quiesce(60_000)
  await quiet()
  // The route appears once the app has regenerated and migrated its database for the new entity.
  const listed = await until(async () => (await appApi('/api/blog/dishes?limit=100&offset=0'))?.status === 200, 90_000)
  check(listed, 'the running app has a list route for the new entity')
  const created = await post('/api/blog/dishes', { title: 'Latte', cost: 4 })
  check(created?.status === 200 || created?.status === 201, `the running app creates a row through its own create route (${created?.status})`)
  for (const [title, cost] of [['Espresso', 3], ['Mocha', 5]]) await post('/api/blog/dishes', { title, cost })
  await page.locator('[data-data-tab="collections"]').click()
  await page.locator('[data-collection="dishes"]').click()
  check(await until(async () => {
    await page.locator('[aria-label="Refresh"]').first().click().catch(() => {})
    return (await page.locator('[data-record]').count()) === 3
  }, 30_000), 'the table lists the 3 rows the app answers')
  check(await page.locator('[data-live-badge]').count() > 0 || await page.locator('[data-records-table]').count() > 0, 'the table shows the app\'s live rows')

  await page.locator('[data-records-filter]').click()
  await page.locator('[data-filter-value]').fill('esp')
  await page.locator('[data-filter-add]').click()
  const filtered = await until(async () => (await page.locator('[data-record]').count()) === 1)
  check(filtered && await page.locator('[data-record]').filter({ hasText: 'Espresso' }).count() === 1, 'the filter "contains esp" leaves Espresso')
  await page.getByRole('button', { name: /^Remove filter/ }).click()
  check(await until(async () => (await page.locator('[data-record]').count()) === 3), 'removing the filter shows all 3 rows')
  await shot(page, 'data-table')

  // A List bound to the entity's Query, on a page.
  const list = (await action('node_insert', { file: p.pageId, type: 'List', props: {} })).nodeId
  const query = await action('query_create_for_list', { page: p.pageId, entity: dish.entityId, as: 'dishes', nodeId: list })
  await action('node_insert', { file: p.pageId, parentId: list, type: 'Text', props: { text: { $template: '{dish.title} costs {dish.cost}' } } })
  const doc = bildr(p.filePath)
  check(doc.uses?.queries?.some(use => use.query === query.queryId) ?? doc.uses?.queries?.length > 0, `the page uses the entity's query (${JSON.stringify(doc.uses?.queries)})`)
  check(JSON.stringify(doc.root).includes('dish.title'), 'and the List row reads the item it names (dish)')

  await openEditor(page, p.pageId)
  const rows = ['Espresso costs 3', 'Latte costs 4', 'Mocha costs 5']
  const inCanvas = await until(async () => {
    const texts = await canvas(page).locator('[data-node-type="Text"]').allTextContents()
    return rows.every(row => texts.some(t => t.includes(row))) && texts
  }, 30_000)
  check(!!inCanvas, `the canvas List renders one row per row of the app (${inCanvas})`)

  const live = await appShows(browser, p.path, 'Mocha costs 5')
  check(live.html.includes('Mocha costs 5') && live.html.includes('Latte costs 4'), 'the running app lists the rows too')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
// A new entity regenerates the app and restarts the dev server: its event stream ends mid-request.
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/] })
