/**
 * Data on the module editor (port of e2e/data.mjs): a collection made in the Data screen (Add
 * collection, Fields tab add and rename), rows in the table from the running app's list route, a
 * search and a filter in the table; a List bound to a Query on a page, shown in the canvas and in the
 * running app; a Form bound to the entity's create action, submitted in the running app. Every edit is
 * checked in `.bildr/` (the entity, its repository, the page). The last section is the Data workspace
 * (S2): the tree, the tabs of a collection and of a connection, the Live / Sample data switch, the item
 * and tab in the URL, and the keyboard. Then Queries and Actions (S10): a query made from the tree's "+", its
 * Definition and Results, a page that uses it, its rename (the page still renders) and a delete that is
 * refused while it is used; an action made from a template, on its Overview, and its Steps (D10c): a load and an update added, saved, in the JSON tab and
 * regenerated, and then deleted with its steps (the dev server answers 500 for a moment while Nitro rebuilds, and recovers).
 *
 * The last section is the Sample rows (D4, S4): Live is read-only with its hint; on Sample data a cell is edited in
 * place, by keyboard too, a refusal stays on the cell, a reload keeps the value, rows are added and deleted (one, and the
 * checked ones), the record panel edits the open row, and the app's own rows are the same at the end (E2).
 *
 * Dropped (feature doc: records are app data, not editor data; no hosted collections or publish):
 * - `record_create` and quick-add of the app's rows: Live is read-only (E2); rows come from the
 *   app's own API, so this script posts them to the running app instead (sample rows are the editor's: D4);
 * - `collection_update publicRead/publicCreate`, `/api/public/<slug>/...` and Publish: the generated app
 *   has its own list/create routes and needs no publishing;
 * - the published app's WebMCP tools (`document.modelContext`): the generated app has no bildr runtime (D4).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { action, app, appApi, appShows, bildr, call, canvas, check, editorUrl, newPage, openData, openEditor, quiesce, quiet, run, settled, shot, storageChoices, until, whileAppRebuilds } from './lib.mjs'

/** How long the migrations step waits (D6): for the app to regenerate and plan the migration, for the editor to show it, and for the module to write it. */
const MIGRATION_PLANNED_MS = 60_000
const MIGRATION_SHOWN_MS = 30_000
const MIGRATION_WRITTEN_MS = 60_000
/** How long the linked-findings step lets a screen settle before a screenshot (D8): the menu's open animation, and the focus ring and hover colour of a link. */
const SETTLE_MS = 400

await run('data', async ({ page, browser, errors }) => {
  // The app's create route takes the id the client form mints (a uuid).
  const post = (path, body) => appApi(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), ...body }) })
  const p = await newPage('data')
  // A module refusal is answered 422, which Chromium logs as a console error: the steps that expect one filter it out.
  const refused422 = /status of 422 \(Unprocessable Entity\)/

  // The collection and its fields, through the Data screen. New collection (D7, S7) asks for a name and where the rows live.
  await openData(page)
  await page.getByLabel('Add collection').click()
  await page.locator('[data-new-collection-name]').waitFor()
  const storages = await storageChoices(page)
  check(storages.join() === 'sample*,database,rest', `New collection offers Sample data (chosen), Database and REST API (${storages})`)
  check(await page.locator('[data-storage="sample"] [data-choice-dot]').count() === 1 && await page.locator('[data-storage="database"] [data-choice-dot]').count() === 0, 'the chosen choice shows a dot, not a colour only')
  await page.locator('[data-new-collection-name]').fill('Menu')
  await page.waitForTimeout(400)
  await shot(page, 'd7-new-collection')
  // REST API: the name becomes optional and a connection is chosen; Continue would hand on to step 2.
  await page.locator('[data-storage="rest"]').click()
  await page.locator('[data-new-collection-connection]').waitFor()
  check((await storageChoices(page)).join() === 'sample,database,rest*' && await page.locator('[data-form-row="Name (optional)"]').count() === 1, 'REST API is chosen, with the name optional')
  await page.waitForTimeout(400)
  await shot(page, 'd7-new-collection-rest')
  await page.locator('[data-storage="sample"]').click()
  // Cancel makes nothing: no entity, and no source made for it.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('[data-new-collection-name]').waitFor({ state: 'detached' })
  check(!bildr('modules/blog/entities/menu.json') && !bildr('datasources/sample.json'), 'Cancel makes no collection and no data source')
  await page.getByLabel('Add collection').click()
  await page.locator('[data-new-collection-name]').fill('Menu')
  await page.locator('[data-artifact-submit]').click()
  const menu = await until(() => bildr('modules/blog/entities/menu.json'))
  check(menu?.name === 'Menu' && menu.plural === 'menus', `Create on the default writes the "Menu" entity (${menu?.id} ${menu?.plural})`)
  check(!!bildr('modules/blog/repositories/menu.json'), 'and its repository')
  const sample = bildr('datasources/sample.json')
  check(sample?.kind === 'memory' && sample.name === 'sample' && bildr('modules/blog/repositories/menu.json')?.datasource === sample.id, `over the Sample data source made for it, named "sample" (${sample?.kind} ${sample?.name}, read through ${bildr('modules/blog/repositories/menu.json')?.datasource})`)

  // A new collection opens on its Fields tab, where the fields are added.
  await page.locator('[data-new-collection-name]').waitFor({ state: 'detached' })
  check(await until(async () => await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'fields'), 'a new collection opens on its Fields tab')
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
  // The file is written before the action answers and the add row closes: reopening it earlier gets it closed under the typing.
  await page.locator('[data-new-field-label]').waitFor({ state: 'detached' })
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
  // Sample data has no table, so a renamed field leaves nothing to migrate (a stored collection's does: the Migrations step below).
  check(await quiesce(60_000), 'the app regenerates after the rename, with no migration waiting')
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
  // The JSON tab (S3) edits the collection's own file, with a switcher to the files it is linked to.
  await page.locator('[data-data-json] [data-file-path]').waitFor()
  const switcher = (await page.locator('[data-file-switcher] button').allInnerTexts()).map(name => name.trim())
  check(await page.locator('[data-data-json] [data-file-path]').innerText() === '.bildr/modules/blog/entities/dish.json' && switcher.slice(0, 2).join('|') === 'Collection|Repository', `the JSON tab shows Dish's own file, with the files it is linked to (${switcher})`)
  check(await page.locator('[data-data-json] [data-testid="raw-save"]').count() === 1 && await page.locator('[data-data-json] [data-testid="raw-delete"]').count() === 0, 'with the raw editor, which saves and does not delete')
  await page.waitForTimeout(400)
  await shot(page, 'd3-json-tab')
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

  // ── Queries and Actions (S10) ────────────────────────────────────────────────────────────
  // A query is made from the tree's "+" over Dish, with a condition in its Definition; Results run it over the app's rows.
  const pickCollection = async (name) => {
    await page.locator('[data-artifact-collection-select]').click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  await page.getByLabel('New query').click()
  await pickCollection('Dish')
  await page.locator('[data-artifact-name]').fill('cheap dishes')
  await page.locator('[data-artifact-submit]').click()
  const cheap = await until(() => bildr('modules/blog/queries/cheap-dishes.json'))
  check(cheap?.name === 'cheapDishes' && cheap.from === dish.entityId && cheap.result === 'many', `"+" on Queries writes a query over Dish (${cheap?.name} ${cheap?.from})`)
  check(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'definition' && await page.locator('[data-data-title] h2').innerText() === 'Cheap dishes', 'a new query opens on its Definition')
  check(decodeURIComponent(page.url()).endsWith(`#/data?item=query:${cheap.id}&tab=definition`), `its item and tab are in the URL (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  await page.locator('[data-def-where-add]').click()
  await page.locator('[data-def-where-field]').click()
  await page.getByRole('option', { name: 'cost', exact: true }).click()
  await page.locator('[data-def-where-op]').click()
  await page.getByRole('option', { name: 'is less than', exact: true }).click()
  await page.locator('[data-def-where-value]').fill('5')
  await page.locator('[data-def-save]').click()
  const bounded = await until(() => bildr('modules/blog/queries/cheap-dishes.json')?.where)
  check(bounded?.op === 'lt' && bounded.field === 'cost' && bounded.value === 5, `the Definition writes the condition (${JSON.stringify(bounded)})`)
  check(await page.locator('[data-def-where-preview]').innerText() === 'Rows where cost is less than 5', 'the condition is also said as a sentence')
  // The footer says what is unsaved, and Discard gives the edit up without asking.
  check(await page.locator('[data-def-unsaved]').count() === 0, 'a saved Definition has nothing unsaved')
  await page.locator('[data-def="label"]').fill('Cheaper dishes')
  check(await page.locator('[data-def-footer] [data-def-unsaved]').innerText() === 'Unsaved changes', 'an edit says "Unsaved changes" in the footer')
  await page.locator('[data-def-discard]').click()
  check(await page.locator('[data-def="label"]').inputValue() === 'Cheap dishes' && await page.locator('[data-def-unsaved]').count() === 0, 'Discard puts the saved query back')
  await page.locator('[data-def="label"]').fill('Cheaper dishes')
  await page.locator('[role=tab][data-data-tab="results"]').click()
  await page.locator('[data-confirm]').waitFor()
  check((await page.locator('[role=dialog]').innerText()).includes('Discard unsaved changes to Cheap dishes?'), 'leaving the Definition with an unsaved edit asks to discard it')
  await page.locator('[data-confirm-ok]').click()
  await page.locator('[data-query-results]').waitFor()
  check(await until(async () => {
    await page.locator('[data-records-refresh]').click().catch(() => {})
    return await page.locator('[data-query-results] [data-record]').count() === 2
  }, 30_000), 'Results run the query over the app\'s rows: the two dishes that cost less than 5')
  const resultTexts = await page.locator('[data-query-results] [data-record]').allInnerTexts()
  check(resultTexts.some(text => text.includes('Espresso')) && resultTexts.some(text => text.includes('Latte')) && !resultTexts.some(text => text.includes('Mocha')), `and they are Espresso and Latte (${resultTexts.map(text => text.replace(/\s+/g, ' ')).join(' | ')})`)
  check(await page.locator('[data-results-count]').innerText() === '2 results', 'with their count')
  check((await page.locator('[data-query-summary-text]').innerText()).includes('cost is less than 5'), 'a line above them says what the query does')
  await page.locator('[data-edit-definition]').click()
  check(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'definition', 'and its Edit definition link opens the Definition')
  await page.locator('[role=tab][data-data-tab="results"]').click()

  // A page uses the query, so Used in lists it, and the page renders what the query returns.
  await action('page_use_add', { page: p.pageId, as: 'cheap', query: cheap.id })
  const cheapList = (await action('node_insert', { file: p.pageId, type: 'List', props: { items: { $bind: 'cheap' }, as: 'cheapDish' } })).nodeId
  await action('node_insert', { file: p.pageId, parentId: cheapList, type: 'Text', props: { text: { $template: '{cheapDish.title} is cheap' } } })
  await page.locator('[role=tab][data-data-tab="used"]').click()
  check(await until(async () => await page.locator(`[data-used-in] [data-use="page:${p.pageId}"]`).count() === 1), 'Used in lists the page that reads the query')
  const cheapApp = await appShows(browser, p.path, 'Espresso is cheap')
  check(cheapApp.html.includes('Espresso is cheap') && cheapApp.html.includes('Latte is cheap') && !cheapApp.html.includes('Mocha is cheap'), 'the running app shows the query\'s rows on that page')

  // Rename: the page holds the query's id, so it still renders; hand-written code that imports the old name is warned.
  await page.locator(`[data-artifact-menu="${cheap.id}"]`).click({ force: true })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  check((await page.locator('[data-artifact-warning]').innerText()).includes('Hand-written code that imports `useCheapDishes` needs the same rename.'), 'Rename warns that hand-written code importing the old name needs the same rename')
  await page.locator('[data-artifact-name]').fill('budgetDishes')
  await page.locator('[data-artifact-submit]').click()
  check(await until(() => bildr('modules/blog/queries/cheap-dishes.json')?.name === 'budgetDishes'), 'the rename writes the query\'s name, in its own file')
  check(bildr(p.filePath).uses.queries.some(use => use.query === cheap.id && use.as === 'cheap'), 'and the page still uses it by its id')
  await quiesce(60_000)
  await quiet()
  const renamedApp = await appShows(browser, p.path, 'Espresso is cheap')
  check(renamedApp.html.includes('Espresso is cheap') && renamedApp.html.includes('Latte is cheap') && !renamedApp.html.includes('Mocha is cheap'), 'the page still renders the query\'s rows after the rename')
  check(await page.locator(`[data-used-in] [data-use="page:${p.pageId}"]`).count() === 1, 'and Used in still lists the page')

  // Delete is not offered while the page uses the query: the dialog lists the page and disables the button; the module refuses it too.
  await page.locator(`[data-artifact-menu="${cheap.id}"]`).click({ force: true })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  check(await page.locator(`[data-artifact-uses] [data-use-open="page:${p.pageId}"]`).count() === 1, 'Delete lists the page that uses the query')
  check(await page.locator('[data-artifact-submit]').isDisabled() && await page.locator('[data-artifact-submit]').getAttribute('title') === 'Used in 1 place: change it first', 'and its button is disabled, with the uses as the reason')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const deleteAnswer = await call('query_delete', { query: cheap.id })
  check(deleteAnswer.status === 422 && deleteAnswer.message.includes('is still used') && !!bildr('modules/blog/queries/cheap-dishes.json'), `the module refuses it too, and the file stays (${deleteAnswer.status} ${deleteAnswer.message?.slice(0, 80)})`)

  // The keyboard: F2 on the focused row renames, and the Queries header folds its section (remembered).
  await page.locator(`[data-tree-item="query:${cheap.id}"]`).focus()
  await page.keyboard.press('F2')
  check(await page.locator('[data-artifact-dialog="rename"]').count() === 1, 'F2 on a query row opens Rename')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('[data-artifact-toggle="query"]').click()
  check(await page.locator('[data-artifacts="query"] [data-tree-item]').count() === 0 && await page.locator('[data-artifact-toggle="query"]').getAttribute('aria-expanded') === 'false', 'the Queries header folds its section')
  await page.reload()
  await page.locator('[data-artifact-toggle="query"]').waitFor()
  check(await page.locator('[data-artifact-toggle="query"]').getAttribute('aria-expanded') === 'false', 'and a reload keeps it folded')
  await page.locator('[data-artifact-toggle="query"]').click()
  check(await page.locator(`[data-tree-item="query:${cheap.id}"]`).count() === 1, 'unfolded, the rows are back')

  // An action is made from a template, and opens on its Overview.
  await page.getByLabel('New action').click()
  await pickCollection('Dish')
  await page.locator('[data-action-template="blank"]').click()
  await page.locator('[data-artifact-name]').fill('archive dish')
  await page.locator('[data-artifact-submit]').click()
  const archive = await until(() => bildr('modules/blog/actions/archive-dish.json'))
  check(archive?.name === 'archiveDish' && archive.steps?.length === 1 && archive.steps[0].kind === 'return', `"+" on Actions writes an action from the Blank template (${archive?.name}, steps ${archive?.steps?.map(step => step.kind)})`)
  check(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'overview', 'a new action opens on its Overview')
  check(await page.locator('[data-action-route]').innerText() === 'POST /dishes/archive-dish' && await page.locator('[data-action-name]').innerText() === 'archiveDish', 'which shows its route and its code name')
  check(await page.locator('[data-action-output]').innerText() === 'No data' && await page.locator('[data-steps-note]').innerText() === '1 step — Edit the steps', 'says it returns no data, and counts its step, with a link to the Steps tab')
  await page.locator('[data-action-field="label"]').fill('Archive a dish')
  await page.locator('[data-action-field="label"]').press('Enter')
  check(await until(() => bildr('modules/blog/actions/archive-dish.json')?.label === 'Archive a dish'), 'the Overview saves the label with action_update')
  // The tree shows the new label once the model is read again: the row is not rebuilt under the menu that is opened next.
  await page.locator(`[data-tree-item="action:${archive.id}"] [data-artifact-label]`).filter({ hasText: 'Archive a dish' }).waitFor()
  await page.waitForTimeout(400)
  await page.evaluate(() => document.activeElement?.blur())
  // Nothing uses it: Delete removes it. Its generated route goes with it, and Nitro rebuilds the app (see whileAppRebuilds).
  await whileAppRebuilds(page, errors, async () => {
    await page.locator(`[data-artifact-menu="${archive.id}"]`).click({ force: true })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.locator('[data-artifact-submit]').click()
    check(await until(() => bildr('modules/blog/actions/archive-dish.json') === undefined), 'an action nothing uses is deleted')
  }, 'the rebuild after the first delete')

  // The Steps tab (D10c): a blank action gets a load and an update, saved with one action_update. The picture is taken of it, and
  // then the action, with its steps, is deleted (below).
  await page.getByLabel('New action').click()
  await pickCollection('Dish')
  await page.locator('[data-action-template="blank"]').click()
  await page.locator('[data-artifact-name]').fill('restock dish')
  await page.locator('[data-artifact-submit]').click()
  const restock = await until(() => bildr('modules/blog/actions/restock-dish.json'))
  await page.locator('[data-steps-link]').click()
  await page.locator('[data-action-steps]').waitFor()
  check(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'steps' && decodeURIComponent(page.url()).endsWith(`#/data?item=action:${restock?.id}&tab=steps`), `the Overview links to the Steps tab, which is in the URL (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  check(await page.locator('[data-step-card]').count() === 1 && await page.locator('[data-step-card="0"]').getAttribute('data-step-kind') === 'return', 'a blank action has one return step')
  check(await page.locator('[data-step-card="0"] [data-step-toggle]').getAttribute('aria-expanded') === 'true', 'the first card is open to start with')
  // A load goes before the return; the write takes the place of the bare return, which only ended the action.
  await page.locator('[data-step-add]').click()
  await page.getByRole('menuitem', { name: 'Load a row' }).click()
  await page.locator('[data-step-add]').click()
  await page.getByRole('menuitem', { name: /^Write\b/ }).click()
  check((await page.locator('[data-step-card]').evaluateAll(cards => cards.map(card => card.getAttribute('data-step-kind')))).join() === 'load,repository', 'a write replaces the blank action\'s bare return, and a load goes before it')
  await page.locator('[data-step-card="1"] [data-step-field="op"]').click()
  await page.getByRole('option', { name: 'Update', exact: true }).click()
  check(await page.locator('[data-step-card="0"] [data-step-field="as"]').inputValue() === 'dish' && await page.locator('[data-step-card="1"] [data-step-field="from"] [data-value-source]').innerText() === 'Variable: dish', 'a new load is named after its collection, and the update writes it back')
  check(await page.locator('[data-step-problem]').count() === 0 && await page.locator('[data-steps-unsaved]').count() === 1, 'the editor finds nothing wrong, and says "Unsaved changes"')
  await page.locator('[data-steps-save]').click()
  const restocked = await until(() => {
    const steps = bildr('modules/blog/actions/restock-dish.json')?.steps
    return steps?.length === 2 && steps
  })
  check(restocked && restocked[0].kind === 'load' && restocked[0].as === 'dish' && restocked[0].op === 'get' && restocked[1].kind === 'repository' && restocked[1].op === 'update' && restocked[1].from?.$var === 'dish', `Save writes the load and the update with one action_update (${restocked?.map(step => step.kind)})`)
  await page.locator('[data-steps-unsaved]').waitFor({ state: 'detached' })
  check(await page.locator('[data-steps-error]').count() === 0, 'and the module has no refusal')
  await page.locator('[role=tab][data-data-tab="json"]').click()
  const restockJson = page.locator('textarea[data-testid="raw-content"], [data-testid="raw-content"] textarea').first()
  await restockJson.waitFor()
  check(await until(async () => /"kind": "load"[\s\S]*"kind": "repository"/.test(await restockJson.inputValue())), 'the JSON tab shows them')
  check(await settled(), 'and the app still regenerates (the model loads, nothing drifts)')
  await quiesce(60_000)
  await quiet()
  await page.locator('[role=tab][data-data-tab="steps"]').click()
  await page.locator('[data-step-card="1"] [data-step-toggle]').click()
  await page.locator('[data-step-card="1"] [data-step-form]').waitFor()
  check(await page.locator('[data-errors-jump]').innerText() === 'Errors (0)', 'the Errors link near the top counts the action\'s errors')
  await page.waitForTimeout(400)
  await page.evaluate(() => document.activeElement?.blur())
  await shot(page, 'd10c-action-steps')

  // An action with steps is deleted (it had load and update steps, saved above): the same rebuild (whileAppRebuilds).
  await page.waitForTimeout(400)
  await whileAppRebuilds(page, errors, async () => {
    await page.locator(`[data-artifact-menu="${restock.id}"]`).click({ force: true })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.locator('[data-artifact-submit]').click()
    check(await until(() => bildr('modules/blog/actions/restock-dish.json') === undefined), 'an action with load and update steps is deleted')
  }, 'the rebuild after the second delete')
  check(await until(async () => (await appApi('/api/blog/dishes?limit=1&offset=0'))?.status === 200, 60_000), 'the app answers again after Nitro rebuilt (a 500 for about a second, not a route left behind)')

  // The Used in link opens the page on the Canvas.
  await page.locator('[data-tree-item^="query:"]').first().waitFor()
  await page.locator(`[data-tree-item="query:${cheap.id}"]`).click()
  await page.locator('[role=tab][data-data-tab="used"]').click()
  await page.locator(`[data-use-open="page:${p.pageId}"]`).click()
  check(await until(() => decodeURIComponent(page.url()).includes('#/design')), `a Used in link opens the page on the Canvas (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  await openData(page)

  // ── Used in, for a collection and its fields ────────────────────────────────────────────
  // Dish is read by the page `p` (its list and the cheap query): the collection's Used in tab lists the page, and its link opens it on the Canvas.
  await page.locator('[data-collection="dishes"]').click()
  await page.locator('[role=tab][data-data-tab="used"]').click()
  check(await until(async () => (await page.locator(`[data-used-in-outside] [data-use="page:${p.pageId}"]`).count()) === 1), 'a collection\'s Used in tab lists the page that reads it')
  check((await page.locator('[data-used-in] p').first().innerText()).startsWith('Used in '), 'with the number of places')
  await page.locator(`[data-used-in-outside] [data-use-open="page:${p.pageId}"]`).click()
  check(await until(() => decodeURIComponent(page.url()).includes('#/design')), `its link opens the Canvas (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  check(await until(async () => (await canvas(page).locator('[data-node-type="Text"]').allTextContents()).some(text => text.includes(' costs '))), 'with that page open: its list is on the canvas')
  await openData(page)

  // A field the page binds shows its count, its list under the row, and warns before it is removed or renamed.
  await page.locator('[data-collection="dishes"]').click()
  await page.locator('[role=tab][data-data-tab="fields"]').click()
  const titleUses = page.locator('[data-field="title"] [data-field-uses]')
  check(await until(async () => (await titleUses.count()) === 1), 'a field the page binds shows how many places use it')
  await titleUses.click()
  check(await page.locator(`[data-field-uses-list="title"] [data-use="page:${p.pageId}"]`).count() === 1, 'its list names the page')
  await page.locator('[data-field="title"]').hover()
  await page.locator('[data-field="title"] [data-row-remove]').click()
  const warning = page.locator('[data-confirm]')
  const dialog = page.getByRole('dialog')
  await warning.waitFor()
  check(/“title” is used in \d+ places?/.test(await dialog.innerText()), 'removing it says "“title” is used in N places" first')
  check(await page.locator(`[data-confirm-uses] [data-use-open="page:${p.pageId}"]`).count() === 1 && await page.locator('[data-confirm-ok]').count() === 0, 'lists the page, and there is nothing to confirm: one Close button')
  await page.waitForTimeout(400)
  await shot(page, 'd5-used-in')
  await page.locator('[data-confirm-cancel]').click()
  await warning.waitFor({ state: 'detached' })
  check(bildr('modules/blog/entities/dish.json').fields.some(field => field.name === 'title'), 'nothing was removed')
  // Esc on the name cancels the edit: nothing is asked and the name stays.
  await page.getByLabel('Name of title').fill('heading')
  await page.getByLabel('Name of title').press('Escape')
  await page.waitForTimeout(400)
  check(await warning.count() === 0 && await page.getByLabel('Name of title').inputValue() === 'title', 'Esc on a field name cancels the rename and puts the name back')
  // A rename of a used field is blocked the same, and the name goes back.
  await page.getByLabel('Name of title').fill('heading')
  await page.getByLabel('Name of title').press('Enter')
  await warning.waitFor()
  check(/pages and queries name it directly/.test(await page.locator('[data-confirm-description]').innerText()), 'renaming it says pages and queries name it directly')
  await page.locator('[data-confirm-cancel]').click()
  await warning.waitFor({ state: 'detached' })
  check(await until(async () => (await page.getByLabel('Name of title').count()) === 1) && bildr('modules/blog/entities/dish.json').fields.some(field => field.name === 'title'), 'and the name is back')
  // The collection too: deleting it is blocked while the page reads it.
  await page.locator('[data-collection="dishes"]').hover()
  await page.locator('[data-collection="dishes"]').locator('xpath=..').getByLabel('Collection actions').click({ force: true })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await warning.waitFor()
  check(/“Dish” is used in \d+ places?/.test(await dialog.innerText()) && await page.locator('[data-confirm-ok]').count() === 0, 'deleting the collection says "“Dish” is used in N places" and cannot be confirmed')
  await page.locator('[data-confirm-cancel]').click()
  await warning.waitFor({ state: 'detached' })

  // ── The JSON tab and All model files (S3) ────────────────────────────────────────────────
  // An edit of Menu's file in the JSON tab shows in its Fields tab (Menu has no rows, so a new column is a plain addition).
  const rawContent = page.locator('textarea[data-testid="raw-content"], [data-testid="raw-content"] textarea').first()
  await page.locator('[data-collection="menus"]').click()
  await page.locator('[role=tab][data-data-tab="json"]').click()
  await rawContent.waitFor()
  const menuFile = JSON.parse(await rawContent.inputValue())
  check(menuFile.id === menu.id && !menuFile.fields.some(field => field.name === 'price'), 'the JSON tab of Menu holds its entity file')
  menuFile.fields.push({ id: 'fld_price', name: 'price', type: 'number' })
  await rawContent.fill(JSON.stringify(menuFile))
  await page.locator('[data-testid="raw-save"]').click()
  check(await until(() => bildr('modules/blog/entities/menu.json').fields.some(field => field.name === 'price')), 'saving the JSON writes the entity file')
  check((await page.locator('[data-data-json]').innerText()).includes('Saved.'), 'and the tab says it is saved')
  await page.locator('[role=tab][data-data-tab="fields"]').click()
  check(await until(async () => await page.locator('[data-fields-tab] [data-field="price"]').count() === 1), 'the Fields tab shows the field the JSON added')
  await page.locator('[role=tab][data-data-tab="json"]').click()
  await rawContent.waitFor()
  const reread = JSON.parse(await rawContent.inputValue())
  check(reread.fields.some(field => field.name === 'price'), 'and the JSON tab shows the file as the module saved it')

  // A problem the module refuses is shown inline, and the text stays. The refusal is answered 422, which Chromium logs as a console error: this step expects it, and no other does.
  const refused = refused422
  const errorsBefore = errors.length
  await rawContent.fill(JSON.stringify({ ...reread, idStrategy: 'ent_missing' }))
  await page.locator('[data-testid="raw-save"]').click()
  await page.locator('[data-data-json]').getByText('Not saved').first().waitFor()
  errors.push(...errors.splice(errorsBefore).filter(message => !refused.test(message)))
  const refusal = await page.locator('[data-data-json]').innerText()
  check(refusal.includes('idStrategy') && (await rawContent.inputValue()).includes('ent_missing'), `a save the module refuses shows its problem and keeps the text (${refusal.replace(/\s+/g, ' ').slice(-200)})`)
  check(bildr('modules/blog/entities/menu.json').idStrategy === 'uuid', 'and the file is as it was')

  // The text is not saved: moving away asks first, and Cancel keeps it.
  await page.locator('[data-raw-model]').click()
  await page.locator('[data-confirm]').waitFor()
  check((await page.locator('[role=dialog]').innerText()).includes('Discard unsaved changes to .bildr/modules/blog/entities/menu.json?'), 'leaving the JSON tab with unsaved edits asks to discard them')
  await page.locator('[data-confirm-cancel]').click()
  check(await page.locator('[data-data-json]').count() === 1 && (await rawContent.inputValue()).includes('ent_missing'), 'Cancel keeps the tab and the text')

  // All model files: every file by kind, the editor beside it, the selection in the URL.
  await page.locator('[data-raw-model]').click()
  await page.locator('[data-confirm-ok]').click()
  await page.locator('[data-data-files] [data-files-group]').first().waitFor()
  const pageFile = p.filePath.startsWith('.bildr/') ? p.filePath : `.bildr/${p.filePath}`
  const groups = (await page.locator('[data-files-group] h3').allInnerTexts()).map(name => name.trim())
  check(groups.includes('Collections') && groups.includes('Pages') && groups.includes('Queries') && await page.locator('[data-data-tree]').count() === 1 && await page.locator('[role=tablist]').count() === 0, `All model files lists the files by kind inside the Data workspace (${groups})`)
  check(await page.locator('[data-raw-model]').getAttribute('aria-selected') === 'true' && (await page.locator('[data-raw-model]').innerText()).trim() === 'All model files', 'it is the tree\'s last entry and shows as chosen')
  await page.locator(`[data-file="${pageFile}"]`).click()
  await rawContent.waitFor()
  check(JSON.parse(await rawContent.inputValue()).id === p.pageId, 'a page, which has no collection, opens in the raw editor')
  check(decodeURIComponent(page.url()).endsWith(`#/data?item=files&file=${pageFile}`), `the file is in the URL (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  await page.waitForTimeout(400)
  await shot(page, 'd3-all-files')
  await page.reload()
  await rawContent.waitFor()
  check(JSON.parse(await rawContent.inputValue()).id === p.pageId && await page.locator(`[data-file="${pageFile}"]`).getAttribute('aria-current') === 'true', 'a reload restores the file')

  // A new file's path is typed behind "New file…": the URL names it once it is saved, and choosing the file again goes back to it.
  await page.getByRole('button', { name: 'New file…' }).click()
  await page.locator('[data-testid="raw-path"] input, input[data-testid="raw-path"]').first().fill('.bildr/modules/blog/pages/typed.json')
  await page.locator('[data-testid="raw-path-open"]').click()
  check(await page.locator('[data-data-files] [data-file-path]').innerText() === '.bildr/modules/blog/pages/typed.json' && decodeURIComponent(page.url()).endsWith('#/data?item=files') && await page.locator('[data-file][aria-current="true"]').count() === 0, `a typed path is shown, and not in the URL (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  await page.locator(`[data-file="${pageFile}"]`).click()
  await rawContent.waitFor()
  check(JSON.parse(await rawContent.inputValue()).id === p.pageId && decodeURIComponent(page.url()).endsWith(`#/data?item=files&file=${pageFile}`), 'choosing the chosen file again goes back to it')

  // The Model screen is retired: its deep link opens All model files, keeping the path.
  await page.goto(editorUrl('/model'))
  await page.locator('[data-data-files]').waitFor()
  check(decodeURIComponent(page.url()).endsWith('#/data?item=files'), `/model redirects to All model files (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  await page.goto(editorUrl(`/model?path=${encodeURIComponent(pageFile)}`))
  await rawContent.waitFor()
  check(decodeURIComponent(page.url()).endsWith(`#/data?item=files&file=${pageFile}`) && JSON.parse(await rawContent.inputValue()).id === p.pageId, '/model?path= redirects to that file')
  await quiesce(60_000)
  await quiet()

  // ── The pictures of Queries and Actions ──────────────────────────────────────────────────
  // The checks above left their own data in the project (Menu, a page and its list query, the page that reads the cheap query): the
  // pictures are of a project re-seeded with only what they show, the blog and Dish with the query and the action over it.
  await whileAppRebuilds(page, errors, async () => {
    await action('page_delete', { page: p.pageId })
    await action('query_delete', { query: query.queryId })
    await action('entity_delete', { entity: menu.id })
    await action('query_update', { query: cheap.id, inPlace: true, orderBy: [{ field: 'title', direction: 'asc' }], limit: 6 })
  }, 'the rebuild after the re-seed')
  await openData(page)
  await page.locator(`[data-tree-item="query:${cheap.id}"]`).click()
  await page.locator('[role=tab][data-data-tab="definition"]').click()
  await page.locator('[data-query-definition]').waitFor()
  const seeded = (await page.locator('[data-artifacts="query"] [data-artifact-label]').allInnerTexts()).map(label => label.trim())
  check(await page.locator(`[data-tree-item="collection:${menu.id}"]`).count() === 0 && seeded.length <= 8 && !seeded.some(label => /^Data-|menu/i.test(label)), `the re-seeded project has only the blog's queries and Dish's (${seeded.join(' | ')})`)
  // One edit is left unsaved, so the picture shows the footer and the sentence that follow what is typed.
  await page.locator('[data-def-where-value]').fill('4')
  check(await page.locator('[data-def-where-preview]').innerText() === 'Rows where cost is less than 4' && await page.locator('[data-def-unsaved]').count() === 1, 'an unsaved edit changes the sentence and shows "Unsaved changes"')
  await page.waitForTimeout(400)
  await page.evaluate(() => document.activeElement?.blur())
  await shot(page, 'd10b-query-definition')
  await page.locator('[data-def-discard]').click()
  await page.locator('[role=tab][data-data-tab="results"]').click()
  check(await until(async () => {
    await page.locator('[data-records-refresh]').click().catch(() => {})
    return await page.locator('[data-query-results] [data-record]').count() === 2
  }, 30_000), 'the re-seeded query still has its two results')
  check((await page.locator('[data-query-summary-text]').innerText()) === 'cost is less than 5 · title ascending · limit 6', 'and its summary line')
  await page.waitForTimeout(400)
  await page.evaluate(() => document.activeElement?.blur())
  await shot(page, 'd10b-query-results')
  await page.locator(`[data-tree-item="action:${dish.actionId}"]`).click()
  await page.locator('[data-action-overview]').waitFor()
  await page.waitForTimeout(400)
  await page.evaluate(() => document.activeElement?.blur())
  await shot(page, 'd10b-action-overview')

  // ── Sample rows (D4, S4) ─────────────────────────────────────────────────────────────────
  // Live rows are the app's: read-only, with a hint. Sample data is the entity's fixtures: cells, add and delete are module actions that
  // write .bildr/modules/blog/fixtures/dish.json, and the app's own rows never change (E2).
  const appRows = async () => {
    const answer = await appApi('/api/blog/dishes?limit=100&offset=0')
    return answer?.status === 200 ? JSON.stringify((answer.body.items ?? []).map(row => [row.id, row.title, row.cost]).sort()) : undefined
  }
  const appBefore = await appRows()
  check(appBefore !== undefined, 'the app answers with its rows before the sample rows are edited')
  // Sample rows are generated into the app's seed files, so the writes rebuild the dev server (once, when they pause: the module waits for that)
  // and the app's routes can answer 500 while it does. The editor reads the app's rows in the background, so the browser may log such a 500
  // as a console error. That one is expected, and it is recognized by what it names: the console message's own URL has to be a route of
  // the app that the browser got a 500 from, once for each such response. Every other console error stays an error.
  const sampleErrorsFrom = errors.length
  const appFiveHundreds = []
  const consoleFiveHundreds = []
  const onSampleResponse = (response) => {
    if (response.status() === 500 && new URL(response.url()).pathname.startsWith('/api/blog/')) appFiveHundreds.push(response.url())
  }
  const onSampleConsole = (message) => {
    // The harness's own listener (lib.mjs launch) ran first: the error it kept for this message is the last one, when it kept one.
    const kept = errors.at(-1)
    if (message.type() === 'error' && /status of 500 \(/.test(message.text()) && kept?.endsWith(`: ${message.text()}`)) consoleFiveHundreds.push({ kept, url: message.location().url })
  }
  page.on('response', onSampleResponse)
  page.on('console', onSampleConsole)
  const fixturesFile = () => bildr('modules/blog/fixtures/dish.json')
  const sampleData = () => page.locator('[data-live-badge]').getByRole('button', { name: 'Sample data', exact: true })
  await openData(page)
  await page.locator('[data-collection="dishes"]').click()
  await page.locator('[role=tab][data-data-tab="rows"]').click()
  check(await until(async () => (await page.locator('[data-live-hint]').count()) === 1), 'on Live the Rows tab shows a hint')
  check((await page.locator('[data-live-hint]').innerText()) === 'Live rows come from your app. Switch to Sample data to edit.', 'which says to switch to Sample data to edit')
  check(await page.locator('[data-add-row], [data-row-select], [data-record-delete]').count() === 0, 'and Live has no Add row, checkbox or delete')
  await page.locator('[data-cell="0-0"]').dblclick()
  check(await page.locator('[data-cell-input]').count() === 0 && fixturesFile() === undefined, 'a double-click on a live cell edits nothing (there are no sample rows yet either)')

  await sampleData().click()
  check(await until(async () => (await page.locator('[data-add-row]').count()) === 1 && (await page.locator('[data-live-hint]').count()) === 0), 'Sample data takes the hint away and offers Add row')
  check(await page.locator('[data-record]').count() === 0, 'Dish has no sample rows yet')
  await page.locator('[data-add-row]').click()
  const firstRow = await until(() => fixturesFile()?.rows?.length === 1 && fixturesFile().rows[0])
  check(!!firstRow && /^[0-9a-f-]{36}$/.test(firstRow.id), `Add row writes a row with a new id to the fixtures file, which was made for it (${JSON.stringify(firstRow)})`)
  check(await until(async () => (await page.locator('[data-record]').count()) === 1), 'and the table shows it')

  // A cell is edited in place, and saved when Enter is pressed.
  await page.locator('[data-cell="0-0"]').dblclick()
  await page.locator('[data-cell-input]').fill('Flat white')
  await page.locator('[data-cell-input]').press('Enter')
  check(await until(() => fixturesFile()?.rows?.[0]?.title === 'Flat white'), 'a text cell saved with Enter is written to the fixtures file')
  // The keyboard: the arrow moves to the next cell, Enter edits it, and a number is a number.
  await page.locator('[data-cell="0-0"]').press('ArrowRight')
  check(await page.locator('[data-cell="0-1"]').getAttribute('data-cell-active') === 'true' && await page.locator('[data-cell-active]').count() === 1, 'ArrowRight moves the active cell')
  await page.locator('[data-cell="0-1"]').press('Enter')
  await page.locator('[data-cell-input]').fill('4.5')
  await page.locator('[data-cell-input]').press('Enter')
  check(await until(() => fixturesFile()?.rows?.[0]?.cost === 4.5), 'a number cell is saved as a number (4.5)')
  // A value the field can't take is refused on the cell, and what was typed stays; nothing is written.
  await page.locator('[data-cell="0-1"]').press('F2')
  await page.locator('[data-cell-input]').fill('abc')
  await page.locator('[data-cell-input]').press('Enter')
  check(await until(async () => (await page.locator('[data-cell="0-1"] [data-cell-error]').count()) === 1), 'a bad number is refused on its cell')
  check((await page.locator('[data-cell="0-1"] [data-cell-error]').innerText()).includes('cost must be a number') && await page.locator('[data-cell-input]').inputValue() === 'abc', 'with the module\'s words, and the typed text kept')
  check(fixturesFile().rows[0].cost === 4.5, 'and the file keeps the value it had')
  await page.locator('[data-cell-input]').press('Escape')
  check(await page.locator('[data-cell-input]').count() === 0 && (await page.locator('[data-cell="0-1"]').innerText()).trim() === '4.5', 'Escape gives the cell back as it was saved')
  errors.push(...errors.splice(sampleErrorsFrom).filter(message => !refused422.test(message)))

  // The new row's file is a change the app regenerates for; once it is calm, a reload keeps the value.
  await quiesce(60_000)
  await quiet()
  await page.reload()
  await page.locator('[data-records]').waitFor()
  await sampleData().click()
  check(await until(async () => (await page.locator('[data-cell="0-0"]').innerText()).trim() === 'Flat white'), 'after a reload the edited cell still reads Flat white (the value persists)')
  check((await page.locator('[data-cell="0-1"]').innerText()).trim() === '4.5', 'and the number too')

  // More rows by the module's own action, then a delete from the row, and the rows checked deleted together.
  await action('fixture_row_create', { entity: dish.entityId, values: { title: 'Espresso', cost: 3 } })
  await action('fixture_row_create', { entity: dish.entityId, values: { title: 'Mocha', cost: 5 } })
  check(await until(async () => (await page.locator('[data-record]').count()) === 3), 'rows the module adds show in the table')
  const [flat, espresso, mocha] = fixturesFile().rows.map(row => row.id)
  await page.locator(`[data-record="${flat}"]`).hover()
  await page.locator(`[data-record="${flat}"] [data-record-delete]`).click()
  check(await until(() => fixturesFile()?.rows?.length === 2 && !fixturesFile().rows.some(row => row.id === flat)), 'the trash button on a row deletes that row from the fixtures file')
  await action('fixture_row_create', { entity: dish.entityId, values: { title: 'Flat white', cost: 4.5 } })
  check(await until(async () => (await page.locator('[data-record]').count()) === 3), 'a third row is added again')
  await page.locator('[data-record]').nth(0).locator('[data-row-select]').check()
  await page.locator('[data-record]').nth(1).locator('[data-row-select]').check()
  check((await page.locator('[data-delete-selected]').innerText()).trim() === 'Delete 2 rows', 'two checked rows offer Delete 2 rows')
  await page.locator('[data-delete-selected]').click()
  check((await page.locator('[role=dialog]').innerText()).includes('Delete 2 rows?'), 'which asks first')
  await page.getByRole('button', { name: 'Delete rows', exact: true }).click()
  check(await until(() => fixturesFile()?.rows?.length === 1 && fixturesFile().rows[0].id !== espresso && fixturesFile().rows[0].id !== mocha), 'and confirming deletes both rows in one action, in the fixtures file')

  // The record panel edits the open row too.
  await page.locator('[role=dialog]').waitFor({ state: 'detached' })
  await page.locator('[data-record]').first().hover()
  await page.locator('[data-record-open]').first().click()
  await page.locator('[data-record-panel]').waitFor()
  await page.locator('[data-record-panel] [data-record-field="title"] input').fill('Cortado')
  await page.locator('[data-record-panel] [data-record-field="title"] input').press('Enter')
  check(await until(() => fixturesFile()?.rows?.[0]?.title === 'Cortado'), 'a field of the record panel saves the sample row')

  // Rows for the picture: a few, with one cell refused.
  await action('fixture_row_create', { entity: dish.entityId, values: { title: 'Espresso', cost: 3 } })
  await action('fixture_row_create', { entity: dish.entityId, values: { title: 'Mocha', cost: 5 } })
  await page.locator('[data-record-close]').click()
  check(await until(async () => (await page.locator('[data-record]').count()) === 3), 'three sample rows are shown')
  await page.locator('[data-cell="2-1"]').dblclick()
  await page.locator('[data-cell-input]').fill('five')
  await page.locator('[data-cell-input]').press('Enter')
  await page.locator('[data-cell="2-1"] [data-cell-error]').waitFor()
  await page.waitForTimeout(400)
  await shot(page, 'd4-sample-rows')
  await page.locator('[data-cell-input]').press('Escape')
  errors.push(...errors.splice(sampleErrorsFrom).filter(message => !refused422.test(message)))

  // The module regenerates once the writes have paused: wait for that rebuild, then for the app (a request that reaches the dev server
  // while it rebuilds can be lost, so `appApi` gives up on one after 10 s and this asks again).
  await quiesce(60_000)
  await quiet()
  check(await settled(), 'the app is regenerated from the sample rows: the model loads with no drift')

  // E2: through all of this the app's own rows did not change.
  const appAfter = await until(appRows, 60_000)
  check(appAfter !== undefined, 'the app answers its list route')
  check(appBefore !== undefined && appAfter === appBefore, 'the app\'s own rows are what they were: the editor wrote only sample data')
  page.off('response', onSampleResponse)
  page.off('console', onSampleConsole)
  const unmatched = [...appFiveHundreds]
  const expectedErrors = consoleFiveHundreds.filter(({ url }) => {
    const at = unmatched.indexOf(url)
    if (at >= 0) unmatched.splice(at, 1)
    return at >= 0
  }).map(({ kept }) => kept)
  const sampleErrors = errors.splice(sampleErrorsFrom)
  for (const kept of expectedErrors) {
    const at = sampleErrors.indexOf(kept)
    if (at >= 0) sampleErrors.splice(at, 1)
  }
  errors.push(...sampleErrors)
  console.log(`INFO ${expectedErrors.length} console 500(s) matched a 500 of the app's routes while it rebuilt for the sample rows; ${consoleFiveHundreds.length - expectedErrors.length} did not and stay errors`)

  // ── Migrations in context (D6, S6) ───────────────────────────────────────────────────────
  // A field dropped from a collection the database stores is a migration that loses data: it waits for confirmation, and says so on the
  // collection (a banner with Review and Apply), in the tree (a Migrations entry with its count) and, elsewhere, in the global banner.
  const ledger = await action('entity_create', { name: 'Ledger', source: 'ds_main', fields: [{ name: 'title', type: 'text' }, { name: 'memo', type: 'text' }] })
  await quiesce(MIGRATION_PLANNED_MS)
  await quiet()
  const memo = bildr('modules/blog/entities/ledger.json')?.fields.find(field => field.name === 'memo')
  await action('entity_field_remove', { entity: ledger.entityId, field: memo.id })
  const waiting = await until(async () => (await call('migration_pending_get').catch(() => undefined))?.result?.pending, MIGRATION_PLANNED_MS)
  check(!!waiting && waiting.statements.some(statement => /DROP COLUMN `memo`/.test(statement)), `removing a field of a stored collection leaves a migration pending (${waiting?.statements})`)

  await openData(page)
  await page.locator('[data-collection="ledgers"]').click()
  const banner = page.locator('[data-testid="collection-migration-banner"]')
  await banner.waitFor({ timeout: MIGRATION_SHOWN_MS })
  const bannerText = (await banner.innerText()).replace(/\s+/g, ' ')
  check(/This collection has a database change that loses data: Ledger · memo/.test(bannerText), `the collection says it has a database change that loses data, and what (${bannerText})`)
  check(await page.locator('[data-testid="migration-banner"]').count() === 0, 'the global banner is not repeated on the collection\'s own screen')
  check(await page.locator('[data-tree-item="migrations"] [data-migrations-count]').innerText() === '1', 'the tree lists Migrations, with one collection changed')
  await page.locator('[data-collection="posts"]').click()
  check(await page.locator('[data-testid="collection-migration-banner"]').count() === 0 && await page.locator('[data-testid="migration-banner"]').count() === 1, 'a collection the plan does not change has no banner, and the global one is back')
  await page.locator('[data-raw-model]').click()
  check(await page.locator('[data-testid="migration-banner"]').count() === 1, 'All model files shows no plan, so the global banner is there')
  await page.locator('[data-collection="ledgers"]').click()
  await banner.waitFor()
  // The picture shows the Migrations entry: the Queries section is folded for it (and opened again), and the pointer is moved off the tree.
  await page.locator('[data-artifact-toggle="query"]').click()
  await page.mouse.move(900, 600)
  await page.waitForTimeout(400)
  await page.evaluate(() => document.activeElement?.blur())
  await shot(page, 'd6-migration-banner')
  await page.locator('[data-artifact-toggle="query"]').click()

  // A plan that loses data has no Apply on the banner: nothing is confirmed without the review.
  check(await page.locator('[data-testid="collection-migration-apply"]').count() === 0, 'a plan that loses data offers no Apply on the collection')
  await page.locator('[data-testid="collection-migration-review"]').click()
  await page.locator('[data-testid="statements"]').waitFor()
  check(new URL(page.url()).hash.includes('item=migrations'), `Review opens the plan in the workspace (${new URL(page.url()).hash})`)
  check(/DROP COLUMN `memo`/.test(await page.locator('[data-testid="statements"]').innerText()) && (await page.locator('[data-testid="losing"]').innerText()).includes('Ledger · memo'), 'the review lists the statements and what the plan loses, by collection and field')
  check((await call('migration_pending_get')).result?.pending?.hash === waiting.hash, 'and the plan is still pending')
  await page.locator('[data-testid="confirm"]').click()
  await page.locator('[data-testid="confirm-migration"]').click()
  await page.locator('[data-testid="migration-outcome"]').waitFor({ timeout: MIGRATION_WRITTEN_MS })
  check(/written/.test(await page.locator('[data-testid="migration-outcome"]').innerText()), 'confirming by the plan\'s hash writes the migration')
  check(await until(async () => !(await call('migration_pending_get'))?.result?.pending), 'no migration is pending any more')
  check(await until(async () => (await page.locator('[data-tree-item="migrations"]').count()) === 0), 'the Migrations entry is gone from the tree')
  await page.locator('[data-collection="ledgers"]').click()
  check(await page.locator('[data-testid="collection-migration-banner"]').count() === 0 && await page.locator('[data-testid="migration-banner"]').count() === 0, 'the collection\'s banner is gone, and so is the global one')
  await quiesce(MIGRATION_PLANNED_MS)
  await quiet()

  // ── Linked findings (D8, S8) ─────────────────────────────────────────────────────────────
  // Drift is made cheaply: a generated file is edited by hand in the scratch project (no check is run). Checks then shows a failure dot on the
  // toolbar and on its menu entry, and the drift item links to the file in Code, and to the page it is generated from.
  const homeFile = 'layers/blog/app/pages/index.vue'
  const homeModel = '.bildr/modules/blog/pages/index.json'
  const homePath = join(app.root, homeFile)
  const generated = readFileSync(homePath, 'utf8')
  const viewMenu = page.locator('[data-view-menu]')
  const dot = viewMenu.locator('[data-checks-dot]')
  // The Health report's drift is refreshed by a regeneration, and the module's watcher only sees `.bildr/`: writing the model file the page comes from again
  // with the bytes it has (no change to the model) is the cheap way to make the module look at the generated files.
  const touchPath = join(app.root, homeModel)
  const regenerate = () => writeFileSync(touchPath, readFileSync(touchPath, 'utf8'))
  try {
    writeFileSync(homePath, `${generated}<!-- edited by hand -->\n`)
    regenerate()
    check(!!await until(async () => (await call('health_get').catch(() => undefined))?.result?.drift?.files?.some(file => file.path === homeFile)), 'a generated page edited by hand is drift in the Health report')
    await page.goto(editorUrl('/health'))
    await page.locator('[data-testid="drift"]').waitFor()
    await dot.waitFor()
    // The dot is decoration (aria-hidden): its reason is the button's description.
    const reason = await viewMenu.getAttribute('title')
    check(reason === '1 file bildr wrote was edited by hand.' && await dot.getAttribute('aria-hidden') === 'true', `Checks shows a failure dot on the toolbar's menu button, in plain words (${reason})`)
    await viewMenu.click()
    const entry = page.locator('[role^=menuitem]').filter({ hasText: /^\s*Checks\b/ })
    check(await entry.locator('[data-checks-dot]').count() === 1 && await page.locator('[role^=menuitem] [data-checks-dot]').count() === 1, 'and on the Checks entry of the menu, and on no other')
    await page.waitForTimeout(SETTLE_MS)
    await shot(page, 'd8-checks-menu')
    await page.keyboard.press('Escape')
    const drifted = page.locator(`[data-testid="drift"] [data-target="code:${homeFile}"]`)
    check(await drifted.count() === 1 && await page.locator(`[data-testid="drift"] [data-target="page:pg_index"]`).count() === 1, 'the drift item links to its file in Code and to the page it is generated from')
    check((await page.locator('[data-testid="checks-summary"]').innerText()) === reason, 'the Checks screen says the same at its top')
    await page.mouse.move(900, 600)
    await page.evaluate(() => document.activeElement?.blur())
    await page.waitForTimeout(SETTLE_MS)
    await shot(page, 'd8-checks-links')
    await drifted.click()
    await page.locator('[data-testid="code-tabs"]').waitFor()
    const landed = new URLSearchParams(new URL(page.url()).hash.split('?')[1])
    check(new URL(page.url()).hash.startsWith('#/code?') && landed.get('file') === homeFile && landed.get('path') === homeModel, `clicking it lands on Code with that file (${new URL(page.url()).hash})`)
    check(/index\.vue/.test(await page.locator('[data-testid="code-tabs"] [role=tab][aria-selected=true]').innerText()), 'on the tab of the edited file')
    check(!!await until(async () => /edited by hand/.test(await page.locator('[data-testid="code-tabs"]').innerText())), 'which shows the edit')
    // The page it comes from opens on the canvas.
    await page.goto(editorUrl('/health'))
    await page.locator('[data-testid="drift"] [data-target="page:pg_index"]').click()
    await canvas(page).locator('[data-node]').first().waitFor({ state: 'attached' })
    check(new URL(page.url()).hash.startsWith('#/design') && await canvas(page).locator('[data-node]').count() > 0, `the page link opens the canvas (${new URL(page.url()).hash})`)
  } finally {
    writeFileSync(homePath, generated)
    regenerate()
  }
  check(await settled(), 'the file is as generated again: no drift')
  await page.goto(editorUrl('/health'))
  await page.locator('[data-testid="drift"]').waitFor()
  check(await until(async () => (await dot.count()) === 0), 'and the failure dot is gone')

  // A model that does not load: the file with the problem is linked from the Data screen's list, in All model files, where it is fixed.
  const detailFile = '.bildr/modules/blog/pages/post-detail.json'
  const detailPath = join(app.root, detailFile)
  const detail = readFileSync(detailPath, 'utf8')
  // The module answers a model that does not load 422, which Chromium logs as a console error: expected here.
  const problemErrorsFrom = errors.length
  try {
    writeFileSync(detailPath, '{}\n')
    check(!!await until(async () => (await call('health_get').catch(() => undefined))?.result?.model?.ok === false), 'a page file the model cannot load is a model problem')
    await page.goto(editorUrl('/data'))
    await page.locator('[data-testid="data-problems"]').waitFor()
    // Each problem of the file has its own link (the file is `{}`, so every field it lacks is one).
    const problem = page.locator(`[data-testid="data-problems"] [data-target="files:${detailFile}"]`)
    check(await problem.count() === await page.locator('[data-testid="data-problems"] [data-problem]').count() && await problem.count() > 0 && !/Model screen/.test(await page.locator('[data-testid="data-problems"]').innerText()), 'the Data screen links the problem to its file, with no "(Model screen)"')
    check(/Some model files have problems/.test(await viewMenu.getAttribute('title')), `and the toolbar's failure dot says so (${await viewMenu.getAttribute('title')})`)
    await problem.first().click()
    await page.locator('[data-testid="raw-content"]').waitFor()
    const hash = new URL(page.url()).hash
    check(hash.includes('item=files') && decodeURIComponent(hash).includes(`file=${detailFile}`), `clicking it opens All model files on that file (${hash})`)
    check((await page.locator('[data-testid="raw-content"]').inputValue().catch(() => '')).trim() === '{}', 'which shows the file as it is')
  } finally {
    writeFileSync(detailPath, detail)
  }
  check(await settled(), 'the page file is restored: the model loads again, with no drift')
  errors.push(...errors.splice(problemErrorsFrom).filter(message => !refused422.test(message)))

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
// A new entity regenerates the app and restarts the dev server: its event stream ends mid-request.
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/] })
