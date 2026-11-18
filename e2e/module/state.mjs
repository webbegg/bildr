/**
 * State in the Data workspace (B2, S1) on the module editor: a state "preferences" made from the State section's "+", given a
 * toggle `showDrafts` (yes or no, no to start) in its Fields tab and kept in this browser from its header, each step checked in
 * `.bildr/modules/blog/state/preferences.json`. The page index then binds it (the module's own actions: binding is the inspector's, B4), and
 * Used in lists the page; removing the field a page uses warns, a delete is refused while it is used (the dialog lists the page, the
 * module refuses it too), a rename keeps the page bound (the app still renders), and a delete goes through once nothing uses it.
 *
 * The golden blog already has its drafts toggle (the state `preferences`, the checkbox, the computed `posts`): this script starts by
 * taking that toggle out through the module's file actions, so the state is made from nothing, and the golden model is put back after.
 * Shots go to e2e/module/.shots/.
 */
import { action, appShows, bildr, call, check, findNode, openData, quiesce, quiet, run, shot, until } from './lib.mjs'

const INDEX = '.bildr/modules/blog/pages/index.json'
const PREFERENCES = '.bildr/modules/blog/state/preferences.json'
const PERSISTED = 'modules/blog/state/preferences.json'

await run('state', async ({ page, browser, errors }) => {
  // The module answers a refusal 422, which Chromium logs as a console error: the steps that expect one filter it out.
  const refused422 = /status of 422 \(Unprocessable Entity\)/

  // The blog without its drafts toggle (what `withoutDraftsToggle` of the module's own tests makes): the page first, then the state it used.
  const index = structuredClone(bildr(INDEX))
  delete index.uses.state
  delete index.uses.computed
  const head = findNode(index.root, node => node.id === 'n_head')
  head.children = head.children.filter(child => child.id !== 'n_toggle')
  findNode(index.root, node => node.id === 'n_list').props.items = { $bind: 'featured' }
  await action('model_file_put', { path: INDEX, content: index })
  await action('model_file_delete', { path: PREFERENCES })
  check(!bildr(PERSISTED), 'the blog has no state to start with')

  await openData(page)
  const section = page.locator('[data-artifacts="state"]')
  check(await section.count() === 1 && (await section.locator('[data-artifact-toggle]').innerText()).trim() === 'State', 'the tree has a State section')
  check((await section.locator('[data-artifacts-empty]').innerText()).trim() === 'No state yet. Values the app remembers while it runs, like a filter or a toggle.', 'which says what state is, in one line, while it is empty')
  const order = await page.locator('[data-artifacts], [data-raw-model]').evaluateAll(blocks => blocks.map(block => block.getAttribute('data-artifacts') ?? 'files'))
  check(order.join() === 'query,action,state,files', `after Actions and before All model files (${order})`)

  // New state: a name and how long it keeps its values (Forgotten on reload to start with), and what it starts with.
  await page.getByLabel('New state').click()
  await page.locator('[data-artifact-name]').waitFor()
  const choices = await page.locator('[data-state-persistence]').evaluateAll(cards => cards.map(card => `${card.getAttribute('data-state-persistence')}${card.getAttribute('aria-checked') === 'true' ? '*' : ''}`))
  check(choices.join() === 'memory*,session,localStorage', `New state offers Forgotten on reload (chosen), Kept for this tab and Kept in this browser (${choices})`)
  const words = await page.locator('[data-artifact-dialog="create"]').innerText()
  check(words.includes('Forgotten on reload') && words.includes('Kept for this tab') && words.includes('Kept in this browser') && words.includes('It starts with one text field, “value”.'), 'in the words of the workspace, and says it starts with one text field')
  check(!/composable|entity|shape|localStorage/i.test(words), 'with none of the code\'s words')
  await page.locator('[data-artifact-name]').fill('preferences')
  await page.waitForTimeout(400)
  await shot(page, 'b2-state-new')
  await page.locator('[data-artifact-submit]').click()
  const made = await until(() => bildr(PERSISTED))
  check(made?.id === 'st_preferences' && made.name === 'preferences' && made.persist === 'memory' && made.shape === 'single', `Create writes the state, forgotten on reload (${made?.id} ${made?.persist} ${made?.shape})`)
  check(made?.fields.length === 1 && made.fields[0].name === 'value' && made.fields[0].type === 'text', 'with its one text field, value')
  check(await until(async () => await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'fields'), 'a new state opens on its Fields tab')
  check(decodeURIComponent(page.url()).endsWith('#/data?item=state:st_preferences&tab=fields'), `its item and tab are in the URL (${decodeURIComponent(page.url()).replace(/.*#/, '#')})`)
  check((await page.locator('[data-data-tab]').allInnerTexts()).map(name => name.trim()).join() === 'Fields,Used in,JSON', 'it has the tabs Fields, Used in and JSON')
  check(await page.locator('[data-artifacts="state"] [data-tree-item="state:st_preferences"]').count() === 1, 'and a row in the State section')

  // Fields: the one it starts with goes, and showDrafts, a toggle that starts on no, comes.
  const fieldRows = page.locator('[data-state-fields] [data-state-field]')
  await page.locator('[data-state-field="fld_value"] [data-state-remove]').click()
  await page.locator('[data-state-add]').click()
  const added = fieldRows.last()
  await added.locator('[data-state-name]').fill('showDrafts')
  await added.locator('[data-state-type]').click()
  await page.getByRole('option', { name: 'Toggle', exact: true }).click()
  check(!(await added.locator('[data-state-default]').isChecked()), 'a toggle\'s default is a checkbox, which starts on no')
  check((await page.locator('[data-state-fields-unsaved]').innerText()) === 'Unsaved changes', 'an edit says "Unsaved changes"')
  check(!bildr(PERSISTED).fields.some(field => field.name === 'showDrafts'), 'and writes nothing before Save')
  await page.locator('[data-state-fields-save]').click()
  const saved = await until(() => bildr(PERSISTED)?.fields.some(field => field.name === 'showDrafts') && bildr(PERSISTED))
  check(JSON.stringify(saved?.fields) === JSON.stringify([{ id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false }]), `Save writes the list: showDrafts, a toggle, no to start (${JSON.stringify(saved?.fields)})`)
  check(await until(async () => await page.locator('[data-state-fields-unsaved]').count() === 0), 'and nothing is unsaved after it')

  // The header: how long it keeps its values.
  check((await page.locator('[data-state-header]').innerText()).includes('Forgotten on reload'), 'the header says it is forgotten on reload')
  await page.locator('[data-state-persist]').click()
  await page.getByRole('option', { name: 'Kept in this browser', exact: true }).click()
  const kept = await until(() => bildr(PERSISTED)?.persist === 'localStorage' && bildr(PERSISTED))
  check(!!kept, 'choosing Kept in this browser writes persist: localStorage')
  const golden = JSON.parse(JSON.stringify({ id: 'st_preferences', name: 'preferences', persist: 'localStorage', shape: 'single', fields: [{ id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false }] }))
  const { $schema, label, ...rest } = bildr(PERSISTED)
  check(JSON.stringify(rest) === JSON.stringify(golden) && label === 'Preferences', `the file is the golden blog's preferences, but for its label and its $schema line (${JSON.stringify({ $schema, label, ...rest })})`)
  await page.waitForTimeout(400)
  await shot(page, 'b2-state-fields')

  // Used in: nothing uses it yet; the page index then binds it (the module's own actions) and Used in lists the page.
  await page.locator('[role=tab][data-data-tab="used"]').click()
  check(await page.locator('[data-used-in-empty]').innerText() === 'Not used yet. No page reads or sets this state.', 'Used in says nothing uses it yet')
  await action('page_use_add', { page: 'pg_index', as: 'preferences', state: 'st_preferences' })
  const toggle = (await action('node_insert', { file: 'pg_index', parentId: 'n_head', index: 1, type: 'Checkbox', exact: true, props: { label: 'Show drafts', value: { $bind: 'preferences.showDrafts' } } })).nodeId
  await action('node_interaction_add', { file: 'pg_index', nodeId: toggle, on: 'change', do: [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { $event: 'checked' } }] })
  await action('page_computed_set', { page: 'pg_index', as: 'posts', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } })
  await action('node_update_props', { file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'posts' } } })
  check(await until(async () => await page.locator('[data-used-in] [data-use="page:pg_index"]').count() === 1), 'Used in lists the page index once it binds the state')
  // The editor reads the model again after each of the actions above: the list is whole once it has the computed value too.
  await until(async () => (await page.locator('[data-use="page:pg_index"]').innerText().catch(() => '')).includes('A computed value reads'))
  const uses = await page.locator('[data-use="page:pg_index"]').innerText()
  check(uses.includes('Reads it as “preferences”') && uses.includes('A computed value reads “preferences”') && uses.includes('changes it on an interaction'), `with how it does (${uses.replace(/\s+/g, ' ')})`)
  check(!/composable|entity|shape|\bids?\b|pg_index/i.test(uses), 'in words, with no ids')

  // The field a page uses is counted on its row, and removing it warns first, listing the page.
  await page.locator('[role=tab][data-data-tab="fields"]').click()
  check(await until(async () => (await page.locator('[data-state-field="fld_show_drafts"] [data-field-uses]').innerText().catch(() => '')) === '1'), 'the Fields tab counts the places that use showDrafts on its row')
  await page.locator('[data-state-field="fld_show_drafts"] [data-state-remove]').click()
  await page.locator('[data-confirm]').waitFor()
  const warning = await page.locator('[role=dialog]').innerText()
  check(warning.includes('“showDrafts” is used in 1 place') && await page.locator('[data-confirm] [data-use-open="page:pg_index"]').count() > 0, `removing it says it is used, and links the page (${warning.replace(/\s+/g, ' ')})`)
  check(await page.locator('[data-confirm-ok]').count() === 0 && (await page.locator('[data-confirm-cancel]').innerText()).trim() === 'Close', 'with only a Close button')
  await page.locator('[data-confirm-cancel]').click()
  check(await fieldRows.count() === 1 && await page.locator('[data-state-fields-unsaved]').count() === 0, 'and the field stays')
  // A rename of it is refused by the module, next to the field.
  await page.locator('[data-state-field="fld_show_drafts"] [data-state-name]').fill('showAll')
  await page.locator('[data-state-fields-save]').click()
  await page.locator('[data-state-field-error]').waitFor()
  check((await page.locator('[data-state-field="fld_show_drafts"] [data-state-field-error]').innerText()).includes('is still used') && bildr(PERSISTED).fields[0].name === 'showDrafts', 'the module\'s refusal of a rename is shown next to the field, and the file is unchanged')
  errors.splice(0, errors.length, ...errors.filter(message => !refused422.test(message)))
  await page.locator('[data-state-fields-discard]').click()
  check(await page.locator('[data-state-field-error]').count() === 0 && await page.locator('[data-state-fields-unsaved]').count() === 0, 'Discard puts the saved list back')

  // The JSON tab is the state's own file.
  await page.locator('[role=tab][data-data-tab="json"]').click()
  await page.locator('[data-testid="raw-content"]').waitFor()
  const jsonTab = await page.locator('[data-data-json]').innerText()
  const jsonText = await page.locator('[data-testid="raw-content"]').inputValue().catch(() => '')
  check(jsonTab.includes(`.bildr/${PERSISTED}`) && jsonText.includes('"st_preferences"'), `the JSON tab shows the state's file (${jsonTab.replace(/\s+/g, ' ').slice(0, 120)} | ${jsonText.slice(0, 60).replace(/\s+/g, ' ')})`)
  await page.locator('[role=tab][data-data-tab="fields"]').click()

  // Delete is not offered while the page uses the state: the dialog lists the page and disables the button; the module refuses it too.
  await page.locator('[data-artifact-menu="st_preferences"]').click({ force: true })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  check(await page.locator('[data-artifact-uses] [data-use-open="page:pg_index"]').count() === 1, 'Delete lists the page that uses the state')
  check(await page.locator('[data-artifact-submit]').isDisabled() && await page.locator('[data-artifact-submit]').getAttribute('title') === 'Used in 1 place: change it first', 'and its button is disabled, with the uses as the reason')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('[data-artifact-dialog]').waitFor({ state: 'detached' })
  const refusal = await call('state_delete', { state: 'st_preferences' })
  check(refusal.status === 422 && refusal.message.includes('is still used') && !!bildr(PERSISTED), `the module refuses it too, and the file stays (${refusal.status} ${refusal.message?.slice(0, 80)})`)
  errors.splice(0, errors.length, ...errors.filter(message => !refused422.test(message)))

  // Rename: the page holds the state's id, so it stays bound and the app renders; code the user wrote that uses the state is warned, with the generated name as a hint.
  await page.locator('[data-artifact-menu="st_preferences"]').click({ force: true })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  check((await page.locator('[data-artifact-warning]').innerText()).includes('Code you wrote yourself that uses this state needs the same rename.') && (await page.locator('[data-artifact-hint]').innerText()).includes('`useBlogPreferences`'), 'Rename warns that code the user wrote needs the same rename, and hints at the generated name')
  await page.locator('[data-artifact-name]').fill('settings')
  await page.locator('[data-artifact-submit]').click()
  await page.locator('[data-artifact-dialog]').waitFor({ state: 'detached' })
  check(await until(() => bildr(PERSISTED)?.name === 'settings'), 'the rename writes the state\'s name, in its own file')
  check(bildr('modules/blog/pages/index.json').uses.state.some(use => use.state === 'st_preferences' && use.as === 'preferences'), 'and the page still uses it by its id')
  check(decodeURIComponent(page.url()).includes('item=state:st_preferences') && await page.locator('[data-artifacts="state"] [data-tree-item="state:st_preferences"]').getAttribute('title') === 'settings', 'the state stays shown, under its new name')
  check(await quiesce(60_000), 'the app regenerates after the rename')
  await quiet()
  const rendered = await appShows(browser, '/', 'Show drafts')
  check(rendered.html.includes('Show drafts'), 'the running app renders the page with its toggle after the rename')
  await page.waitForTimeout(400)
  await shot(page, 'b2-state-item')

  // Nothing uses it any more: the page's toggle, interaction, computed value and use go, and the delete goes through.
  await action('node_update_props', { file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'featured' } } })
  await action('page_computed_remove', { page: 'pg_index', as: 'posts' })
  await action('node_delete', { file: 'pg_index', nodeId: toggle })
  await action('page_use_remove', { page: 'pg_index', state: 'st_preferences' })
  await page.locator('[role=tab][data-data-tab="used"]').click()
  check(await until(async () => await page.locator('[data-used-in-empty]').count() === 1), 'Used in is empty again')
  await page.locator('[data-artifact-menu="st_preferences"]').click({ force: true })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  check(await page.locator('[data-artifact-uses]').count() === 0 && !await page.locator('[data-artifact-submit]').isDisabled(), 'Delete offers the delete of a state nothing uses')
  await page.locator('[data-artifact-submit]').click()
  check(await until(() => !bildr(PERSISTED)), 'Delete removes the state\'s file')
  check(await until(async () => await page.locator('[data-tree-item="state:st_preferences"]').count() === 0), 'and its row')
  check(await quiesce(60_000), 'the app regenerates without it')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/] })
