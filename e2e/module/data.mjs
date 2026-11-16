/**
 * Data on the module editor (port of e2e/data.mjs): a collection made in the Data screen (Add
 * collection, Fields tab add and rename), rows in the table from the running app's list route, a
 * search and a filter in the table; a List bound to a Query on a page, shown in the canvas and in the
 * running app; a Form bound to the entity's create action, submitted in the running app. Every edit is
 * checked in `.bildr/` (the entity, its repository, the page). The last section is the Data workspace
 * (S2): the tree, the tabs of a collection and of a connection, the Live / Sample data switch, the item
 * and tab in the URL, and the keyboard.
 *
 * Dropped (feature doc: records are app data, not editor data; no hosted collections or publish):
 * - `record_create`, quick-add and inline cell edit: the table is read-only (E2); rows come from the
 *   app's own API, so this script posts them to the running app instead;
 * - `collection_update publicRead/publicCreate`, `/api/public/<slug>/...` and Publish: the generated app
 *   has its own list/create routes and needs no publishing;
 * - the published app's WebMCP tools (`document.modelContext`): the generated app has no bildr runtime (D4).
 */
import { action, appApi, appShows, bildr, canvas, check, editorUrl, newPage, openData, openEditor, quiesce, quiet, run, shot, until } from './lib.mjs'

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

  // A new collection is shown on its Rows tab; the fields are edited on the Fields tab.
  check(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'rows', 'a collection opens on its Rows tab')
  await page.locator('[role=tab][data-data-tab="fields"]').click()
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
  await page.locator('[data-collection="dishes"]').click()
  await page.locator('[role=tab][data-data-tab="rows"]').click()
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

  // ── The Data workspace (S2) ─────────────────────────────────────────────────────────────
  // The tree, the tabs of a collection and of a connection, the Live / Sample data switch, the item and tab in the URL, the keyboard.
  await openData(page)
  await page.locator('[data-collection="dishes"]').click()
  await page.locator('[role=tab][data-data-tab="rows"]').click()
  check(await until(async () => {
    await page.locator('[aria-label="Refresh"]').first().click().catch(() => {})
    return await page.locator('[data-live-badge]').getAttribute('data-source') === 'live' && await page.locator('[data-record]').count() === 3
  }, 30_000), 'Dish shows the app\'s 3 rows on Live')
  const sourceNames = (await page.locator('[data-live-badge] button').allInnerTexts()).map(name => name.trim())
  const pressed = (await page.locator('[data-live-badge] button[aria-pressed=true]').allInnerTexts()).map(name => name.trim())
  check(sourceNames.join('|') === 'Live|Sample data' && pressed.join() === 'Live', `the rows switch reads Live / Sample data and is pressed on the choice, Live (${sourceNames}, pressed ${pressed})`)
  check(await page.locator('[data-source-note]').count() === 0, 'with the app answering there is no "not answering" note')
  check(await page.locator('[data-insert-button], [data-insert-tool]').count() === 0, 'the Data screen has no canvas insert tools in its top bar')
  await page.waitForTimeout(400) // the tab pill's colour transition
  await page.evaluate(() => document.activeElement?.blur()) // the Refresh click above left its focus ring in the picture
  await shot(page, 'data-workspace-rows')
  await page.locator('[role=tab][data-data-tab="fields"]').click()
  check(await page.locator('[data-fields-tab] [data-field]').count() === 2 && await page.locator('[data-data-panel] [data-collection-panel]').count() === 1, 'the Fields tab lists the two fields of Dish, with the collection settings beside them')
  await page.waitForTimeout(400)
  await shot(page, 'data-workspace-fields')
  check(decodeURIComponent(page.url()).endsWith(`#/data?item=collection:${dish.entityId}&tab=fields`), `the item and the tab are in the URL (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  await page.reload()
  await page.locator('[role=tab][aria-selected=true]').waitFor()
  check(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'fields' && (await page.locator('[data-data-title] h2').innerText()) === 'Dish', 'a reload restores Dish on its Fields tab')
  await page.locator('[role=tab][data-data-tab="fields"]').focus()
  await page.keyboard.press('ArrowRight')
  check(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'endpoints' && await page.locator('[data-endpoints-empty]').count() === 1, 'the arrow keys move along the tab strip: Endpoints says a stored collection has none')
  await page.keyboard.press('End')
  const json = await page.locator('[data-data-json]').innerText()
  check(json.includes('Raw model files') && await page.locator('[data-data-json] a').getAttribute('href').then(href => href?.endsWith('#/model')), `the JSON tab points to the raw model files (${json.replace(/\s+/g, ' ')})`)
  const treeItem = () => page.evaluate(() => document.activeElement?.hasAttribute('data-tree-item') ? document.activeElement.getAttribute('title') : false)
  const stops = await page.locator('[data-data-tree] [role=treeitem][tabindex="0"]').count()
  check(await page.locator('[data-data-tree]').getAttribute('role') === 'tree' && stops === 1, `the tree is one tab stop (${stops})`)
  await page.locator('[data-collection="dishes"]').focus()
  await page.keyboard.press('Home')
  const first = await treeItem()
  check(!!first, `Home moves focus to the first item of the tree (${first})`)
  await page.keyboard.press('ArrowDown')
  const second = await treeItem()
  check(typeof second === 'string' && second !== first, `ArrowDown moves it to the next one (${second})`)
  await page.keyboard.press('Enter')
  check(typeof second === 'string' && await page.locator('[data-data-title] h2').innerText() === second, 'Enter picks it')
  const quotes = page.locator('[data-tree-item="connection:ds_quotes"]')
  await quotes.focus()
  await page.keyboard.press('ArrowLeft')
  check(await quotes.getAttribute('aria-expanded') === 'false', 'ArrowLeft collapses a connection')
  await page.keyboard.press('ArrowRight')
  check(await quotes.getAttribute('aria-expanded') === 'true', 'ArrowRight expands it again')
  await page.goto(editorUrl('/data?item=connection:ds_quotes&tab=json'))
  await page.reload()
  await page.locator('[data-data-json]').waitFor()
  const connectionTabs = (await page.locator('[role=tab]').allInnerTexts()).map(name => name.trim())
  check(connectionTabs.join('|') === 'Endpoints|JSON' && await page.locator('[data-data-title] h2').innerText() === 'quotes', `a deep link opens the quotes connection on JSON, with the tabs ${connectionTabs}`)
  await page.locator('[role=tab][data-data-tab="endpoints"]').click()
  check(await page.locator('[data-connection-endpoints] [data-connection-panel]').count() === 1, 'the connection\'s Endpoints tab holds its settings')
  await page.waitForTimeout(400)
  await shot(page, 'data-tree-connection')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
// A new entity regenerates the app and restarts the dev server: its event stream ends mid-request.
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/] })
