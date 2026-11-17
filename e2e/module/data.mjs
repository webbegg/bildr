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
 * Dropped (feature doc: records are app data, not editor data; no hosted collections or publish):
 * - `record_create`, quick-add and inline cell edit: the table is read-only (E2); rows come from the
 *   app's own API, so this script posts them to the running app instead;
 * - `collection_update publicRead/publicCreate`, `/api/public/<slug>/...` and Publish: the generated app
 *   has its own list/create routes and needs no publishing;
 * - the published app's WebMCP tools (`document.modelContext`): the generated app has no bildr runtime (D4).
 */
import { action, appApi, appShows, bildr, call, canvas, check, editorUrl, newPage, openData, openEditor, quiesce, quiet, run, settled, shot, until } from './lib.mjs'

await run('data', async ({ page, browser, errors }) => {
  // The app's create route takes the id the client form mints (a uuid).
  const post = (path, body) => appApi(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), ...body }) })
  const p = await newPage('data')
  // A module refusal is answered 422, which Chromium logs as a console error: the steps that expect one filter it out.
  const refused422 = /status of 422 \(Unprocessable Entity\)/

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
  // Nothing uses it: Delete removes it.
  await page.locator(`[data-artifact-menu="${archive.id}"]`).click({ force: true })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.locator('[data-artifact-submit]').click()
  check(await until(() => bildr('modules/blog/actions/archive-dish.json') === undefined), 'an action nothing uses is deleted')
  await quiesce(60_000)
  await quiet()

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

  // An action with steps is deleted (it had load and update steps, saved above). The generated route of an action goes with it, and
  // Nitro rebuilds the app: for about a second every route of the app answers 500 (the dev log says "Could not load ...
  // restock-dish.post.ts: ENOENT", the rebuild met the file the sync had just removed), then it answers again. The editor's own routes
  // answer throughout. So this step collects the 500s the browser sees while it happens (`response`, with the URL), and checks that
  // every one is on a route the app generated and none on the editor (`/__bildr`), and that all the editor's own requests succeeded.
  // The console error Chromium logs for a 500 does not name the route, so it is ignored only as often as a 500 the browser logged for
  // an app route (the console message's own location): any other console error stays an error here, as it does in the rest of the script.
  const consoleBefore = errors.length
  const onEditor = url => new URL(url).pathname.startsWith('/__bildr')
  const onAppRoute = (url, type) => {
    const { pathname } = new URL(url)
    return !onEditor(url) && (pathname.startsWith('/api/blog/') || type === 'document')
  }
  const answered = []
  const consoleFailures = []
  const onResponse = response => answered.push({ url: response.url(), status: response.status(), type: response.request().resourceType() })
  const onConsole = (message) => {
    if (message.type() === 'error' && /status of 500 \(Internal Server Error\)/.test(message.text())) consoleFailures.push(message.location().url ?? '')
  }
  page.on('response', onResponse)
  page.on('console', onConsole)
  await page.waitForTimeout(400)
  await page.locator(`[data-artifact-menu="${restock.id}"]`).click({ force: true })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.locator('[data-artifact-submit]').click()
  check(await until(() => bildr('modules/blog/actions/restock-dish.json') === undefined), 'an action with load and update steps is deleted')
  await quiesce(60_000)
  await quiet()
  check(await until(async () => (await appApi('/api/blog/dishes?limit=1&offset=0'))?.status === 200, 60_000), 'the app answers again after Nitro rebuilt (a 500 for about a second, not a route left behind)')
  check(await settled(), 'and the model loads with no drift, the generated files of the action gone')
  page.off('response', onResponse)
  page.off('console', onConsole)
  const fiveHundreds = answered.filter(entry => entry.status === 500)
  check(fiveHundreds.every(entry => onAppRoute(entry.url, entry.type)), `every 500 of the rebuild is on a route the app generated, none on /__bildr (${fiveHundreds.length}: ${[...new Set(fiveHundreds.map(entry => new URL(entry.url).pathname))].join(', ') || 'none'})`)
  const editorFailed = answered.filter(entry => onEditor(entry.url) && entry.status >= 400)
  check(editorFailed.length === 0 && answered.some(entry => onEditor(entry.url)), `the editor's own requests all succeeded during the rebuild (${answered.filter(entry => onEditor(entry.url)).length} answered${editorFailed.length ? `; failed: ${editorFailed.map(entry => `${entry.status} ${new URL(entry.url).pathname}`).join(', ')}` : ''})`)
  // A console 500 is expected once per 500 the browser logged for an app route; the others stay in `errors`.
  let expected = consoleFailures.filter(url => fiveHundreds.some(entry => entry.url === url && onAppRoute(entry.url, entry.type))).length
  const rebuildErrors = errors.splice(consoleBefore)
  errors.push(...rebuildErrors.filter(message => !(expected > 0 && /status of 500 \(Internal Server Error\)/.test(message) && expected--)))
  console.log(`INFO ${rebuildErrors.length - (errors.length - consoleBefore)} console 500(s) on app routes from the rebuild were expected here`)
  await quiet()

  // The Used in link opens the page on the Canvas.
  await page.locator('[data-tree-item^="query:"]').first().waitFor()
  await page.locator(`[data-tree-item="query:${cheap.id}"]`).click()
  await page.locator('[role=tab][data-data-tab="used"]').click()
  await page.locator(`[data-use-open="page:${p.pageId}"]`).click()
  check(await until(() => decodeURIComponent(page.url()).includes('#/design')), `a Used in link opens the page on the Canvas (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  await openData(page)

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
  await action('page_delete', { page: p.pageId })
  await action('query_delete', { query: query.queryId })
  await action('entity_delete', { entity: menu.id })
  await action('query_update', { query: cheap.id, inPlace: true, orderBy: [{ field: 'title', direction: 'asc' }], limit: 6 })
  await quiesce(60_000)
  await quiet()
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

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
// A new entity regenerates the app and restarts the dev server: its event stream ends mid-request.
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/] })
