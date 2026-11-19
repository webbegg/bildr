/**
 * The drafts toggle, built from nothing through the editor's UI alone (B6, the close of "App behaviour in the UI"): the golden blog's
 * toggle is taken apart by the module's file actions (the State `preferences`, the Checkbox `n_toggle`, the page's use of the State
 * and the computed value `posts`; the List reads `featured`), and then, with no action called, rebuilt:
 *
 * 1. Data → State → +: "preferences", Kept in this browser;
 * 2. Fields: the starter field renamed to `showDrafts`, a Toggle that starts off, Save;
 * 3. Canvas: a Checkbox inserted into the header row `n_head` from the Insert panel, labelled "Show drafts";
 * 4. its Checked bound to `preferences.showDrafts` from the binding menu;
 * 5. Interactions: When Change → Set state, showDrafts, to the control's value;
 * 6. the List's Items depend on a condition: If showDrafts is on, Then All posts, Otherwise Featured posts;
 * 7. Preview: ticking the box shows "A draft" in the canvas's List, unticking takes it away;
 * 8. the `.bildr` files mean what the golden `index.json` and `preferences.json` mean (the minted ids, the aliases, the label and the id
 *    of the new node may differ: the comparison is of meaning, as behaviour.mjs and the module's drafts-toggle test do);
 * 9. the running app renders the toggle and the list.
 *
 * Setup is the only place a module action is called (and `openEditor`, which only tells the editor which page to show first); every
 * step after it is the UI. Shots go to e2e/module/.shots/.
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { REPO, action, appShows, bildr, canvas, check, findNode, openData, openEditor, quiesce, quiet, run, seedPosts, shot, toView, until } from './lib.mjs'

const INDEX = '.bildr/modules/blog/pages/index.json'
const PREFERENCES = '.bildr/modules/blog/state/preferences.json'
const PERSISTED = 'modules/blog/state/preferences.json'
const GOLDEN_INDEX = join(REPO, 'fixtures/codegen/blog', INDEX)
const GOLDEN_PREFERENCES = join(REPO, 'fixtures/codegen/blog', PREFERENCES)

/**
 * A page as what it means: names a page gives its uses (`preferences`, `all`, `posts`) are replaced by what they are (the state, the
 * query, the n-th computed value), and keys are sorted, so two pages that differ only in alias names are equal (as behaviour.mjs).
 */
function meaning(doc) {
  const names = new Map()
  for (const use of doc.uses?.state ?? []) names.set(use.as, `state:${use.state}`)
  for (const use of doc.uses?.queries ?? []) names.set(use.as, `query:${use.query}`)
  for (const use of doc.uses?.actions ?? []) names.set(use.as, `action:${use.action}`)
  ;(doc.uses?.computed ?? []).forEach((use, index) => names.set(use.as, `computed:${index}`))
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      if (key !== '$bind' || typeof value[key] !== 'string') return [key, walk(value[key])]
      const [root, ...rest] = value[key].split('.')
      return [key, [names.get(root) ?? root, ...rest].join('.')]
    }))
  }
  const { uses = {}, ...rest } = doc
  const named = Object.fromEntries(Object.entries(uses).map(([kind, list]) => [kind, list.map(use => walk(Object.fromEntries(Object.entries(use).filter(([name]) => name !== 'as'))))]))
  return JSON.stringify({ uses: named, page: walk(rest) })
}

/** A State file as what it means: no `$schema`, no label, no field ids (the editor mints them), fields in order. */
function stateMeaning(doc) {
  const sorted = value => Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
  const { fields = [], ...rest } = doc
  for (const key of ['$schema', 'label', 'id']) delete rest[key]
  return JSON.stringify({ ...sorted(rest), fields: fields.map((field) => {
    const { id, ...others } = field
    return sorted(id ? others : field)
  }) })
}

await run('drafts-toggle', async ({ page, browser, errors }) => {
  const listOf = doc => findNode(doc.root, node => node.id === 'n_list')

  // Setup (module actions): the blog without its drafts toggle, as state.mjs and behaviour.mjs leave it.
  const index = structuredClone(bildr(INDEX))
  delete index.uses.state
  delete index.uses.computed
  const head = findNode(index.root, node => node.id === 'n_head')
  head.children = head.children.filter(child => child.id !== 'n_toggle')
  listOf(index).props.items = { $bind: 'featured' }
  await action('model_file_put', { path: INDEX, content: index })
  await action('model_file_delete', { path: PREFERENCES })
  await seedPosts([{ title: 'Hello bildr', slug: 'hello-bildr', published: true, publishedAt: '2026-11-01T09:00:00.000Z' }, { title: 'A draft', slug: 'a-draft' }])
  // Tells the editor which page the Canvas shows (the one thing the editor remembers on its host); nothing of the model.
  await openEditor(page, 'pg_index')
  check(!bildr(PERSISTED) && !bildr(INDEX).uses.state && !bildr(INDEX).uses.computed && !findNode(bildr(INDEX).root, node => node.type === 'Checkbox') && JSON.stringify(listOf(bildr(INDEX)).props.items) === JSON.stringify({ $bind: 'featured' }), 'the blog has no state, no checkbox, no use of State and no computed value to start with: the List reads Featured posts')

  // ── 1. Data → State → +: preferences, Kept in this browser ────────────────────────────────────────────────────────────────
  await openData(page)
  await page.getByLabel('New state').click()
  await page.locator('[data-artifact-name]').waitFor()
  await page.locator('[data-artifact-name]').fill('preferences')
  await page.locator('[data-state-persistence="localStorage"]').click()
  check(await page.locator('[data-state-persistence="localStorage"]').getAttribute('aria-checked') === 'true', 'the New state dialog has Kept in this browser chosen')
  await page.locator('[data-artifact-submit]').click()
  const made = await until(() => bildr(PERSISTED))
  check(made?.name === 'preferences' && made.persist === 'localStorage' && made.shape === 'single', `Create writes the State "preferences", kept in this browser (${made?.id} ${made?.persist})`)
  check(await until(async () => await page.locator('[role=tab][aria-selected=true]').getAttribute('data-data-tab') === 'fields'), 'and opens it on its Fields tab')

  // ── 2. Fields: the starter field becomes showDrafts, a Toggle that starts off ─────────────────────────────────────────────
  const starter = page.locator('[data-state-fields] [data-state-field]').first()
  await starter.locator('[data-state-name]').fill('showDrafts')
  await starter.locator('[data-state-type]').click()
  await page.getByRole('option', { name: 'Toggle', exact: true }).click()
  check(!(await starter.locator('[data-state-default]').isChecked()), 'the Toggle starts off')
  await page.locator('[data-state-fields-save]').click()
  const saved = await until(() => bildr(PERSISTED)?.fields.some(field => field.name === 'showDrafts') && bildr(PERSISTED))
  check(saved?.fields.length === 1 && saved.fields[0].type === 'boolean' && saved.fields[0].default === false, `Save writes one field: showDrafts, a toggle, off (${JSON.stringify(saved?.fields)})`)
  check(await until(async () => await page.locator('[data-state-fields-unsaved]').count() === 0), 'and nothing is unsaved after it')
  await shot(page, 'b6-drafts-state')

  // ── 3. Canvas: a Checkbox "Show drafts" in the header row ─────────────────────────────────────────────────────────────────
  await toView(page, 'Canvas')
  await canvas(page).locator('[data-node]').first().waitFor({ state: 'attached' })
  await page.locator('[data-sidebar-switcher] [role=tab]').filter({ hasText: /^Layers$/ }).click()
  await page.locator('[data-layer-id="n_head"]').click()
  await page.locator('[data-insert-button]').click()
  await page.locator('[data-palette-type="Checkbox"]').click()
  const inserted = await until(() => findNode(bildr(INDEX).root, node => node.id === 'n_head').children.find(node => node.type === 'Checkbox'))
  check(!!inserted, `the Insert panel puts a Checkbox in the header row (${inserted?.id})`)
  check(await until(async () => (await page.locator('[data-inspector-head] p').first().innerText()).includes(inserted.id)), 'and selects it')
  const toggleId = inserted.id
  const label = page.locator('[data-prop-row="label"] input').first()
  await label.fill('Show drafts')
  await label.press('Enter')
  check(!!await until(() => findNode(bildr(INDEX).root, node => node.id === toggleId)?.props?.label === 'Show drafts'), 'its Label is "Show drafts"')

  // ── 4. Bind its Checked to preferences.showDrafts ─────────────────────────────────────────────────────────────────────────
  const row = page.locator('[data-prop-row="value"]')
  await row.waitFor()
  await row.hover()
  await row.locator('[data-binding-dot]').click()
  const menu = page.locator('[role=menu]')
  await menu.waitFor()
  check((await menu.innerText()).includes('showDrafts'), 'the binding menu lists the State field showDrafts')
  await page.getByRole('menuitem', { name: /showDrafts/ }).click()
  const bound = await until(() => findNode(bildr(INDEX).root, node => node.id === toggleId)?.props?.value && bildr(INDEX))
  check(JSON.stringify(findNode(bound.root, node => node.id === toggleId).props.value) === JSON.stringify({ $bind: 'preferences.showDrafts' }), 'the checkbox is bound to preferences.showDrafts')
  check(bound.uses.state?.length === 1 && bound.uses.state[0].state === made.id, `and the page uses the State, added by the same pick (${JSON.stringify(bound.uses.state)})`)

  // ── 5. Interactions: When Change → Set state, showDrafts, to the control's value ──────────────────────────────────────────
  const section = page.locator('[data-node-interactions]')
  await section.waitFor()
  await section.locator('[data-section-action="add"]').click()
  await page.getByRole('menuitem', { name: 'Change', exact: true }).click()
  await page.locator('[data-node-interaction-fields]').waitFor()
  await page.locator('[data-interaction-add-step]').click()
  await page.getByRole('menuitem', { name: 'Set state', exact: true }).click()
  await page.locator('[data-step="0"] [data-step-state]').click()
  await page.getByRole('option', { name: /Preferences/ }).click()
  await page.locator('[data-step="0"] [data-step-field]').click()
  await page.getByRole('option', { name: 'showDrafts', exact: true }).click()
  check(JSON.stringify(findNode(bildr(INDEX).root, node => node.id === toggleId).interactions ?? null) === 'null', 'nothing is written before the step is whole')
  await page.locator('[data-step="0"] [data-value-way-select]').click()
  await page.getByRole('option', { name: 'The control\'s value', exact: true }).click()
  const withChange = await until(() => findNode(bildr(INDEX).root, node => node.id === toggleId).interactions && bildr(INDEX))
  check(JSON.stringify(findNode(withChange.root, node => node.id === toggleId).interactions) === JSON.stringify([{ on: 'change', do: [{ kind: 'setState', state: made.id, field: 'showDrafts', value: { $event: 'checked' } }] }]), `the file has change → Set state showDrafts to the control's value (${JSON.stringify(findNode(withChange.root, node => node.id === toggleId).interactions)})`)
  await section.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await shot(page, 'b6-drafts-interaction')

  // ── 6. The List: If showDrafts is on, Then All posts, Otherwise Featured posts ────────────────────────────────────────────
  await page.locator('[data-layer-id="n_list"]').click()
  const items = page.locator('[data-testid="list-items"]')
  await items.waitFor()
  await items.selectOption('cond')
  await page.locator('[data-testid="list-condition"]').waitFor()
  await page.locator('[data-testid="list-condition-then"]').selectOption({ label: 'All posts' })
  await page.locator('[data-testid="list-condition-else"]').selectOption({ label: 'Featured posts' })
  await page.locator('[data-testid="list-condition-if"]').selectOption({ label: 'showDrafts' })
  const written = await until(() => bildr(INDEX).uses.computed && bildr(INDEX))
  check(JSON.stringify(written?.uses.computed?.map((use) => {
    const rest = { ...use }
    delete rest.as
    return rest
  })) === JSON.stringify([{ if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } }]), `the page gets one computed value: if showDrafts then all else featured (${JSON.stringify(written?.uses.computed)})`)
  check(!!await until(() => JSON.stringify(listOf(bildr(INDEX)).props.items) === JSON.stringify({ $bind: written.uses.computed[0].as })), 'and the List\'s items bind it')
  const summary = (await page.locator('[data-testid="list-condition-summary"]').innerText()).trim()
  check(summary === 'If showDrafts is on: Then All posts, Otherwise Featured posts', `the source reads "${summary}"`)

  // ── 7. Preview: tick it and the canvas List shows "A draft"; untick it and it is gone ─────────────────────────────────────
  check(await quiesce(60_000), 'the app regenerates')
  await quiet()
  const frame = canvas(page)
  const list = frame.locator('[data-node="n_list"]')
  const control = frame.getByRole('checkbox', { name: 'Show drafts' })
  const text = async () => (await list.innerText()).replace(/\s+/g, ' ')
  const shows = async (title, there) => until(async () => (await text()).includes(title) === there, 20_000)
  check(await until(async () => await page.locator('[data-testid="data-badge"]').getAttribute('data-state') === 'live', 60_000), 'the canvas shows the app\'s own rows (the badge says Live)')
  check(await shows('Hello bildr', true) && await shows('A draft', false), 'the canvas List shows the featured posts, not "A draft", before the toggle is used')
  const interact = page.locator('[data-testid="preview-toggle"]')
  await interact.click()
  check(await interact.getAttribute('aria-pressed') === 'true', 'Interact puts the canvas in preview')
  await control.click()
  check(await shows('A draft', true) && await control.getAttribute('aria-checked') === 'true', 'ticking "Show drafts" shows "A draft" in the canvas List')
  await shot(page, 'b6-drafts-preview-on')
  await control.click()
  check(await shows('A draft', false) && await control.getAttribute('aria-checked') === 'false', 'unticking it takes "A draft" away')
  await interact.click()
  check(await interact.getAttribute('aria-pressed') === 'false', 'and preview ends')

  // ── 8. The files mean what the golden blog's files mean ───────────────────────────────────────────────────────────────────
  const goldenIndex = JSON.parse(readFileSync(GOLDEN_INDEX, 'utf8'))
  const goldenState = JSON.parse(readFileSync(GOLDEN_PREFERENCES, 'utf8'))
  const builtState = bildr(PERSISTED)
  check(stateMeaning(builtState) === stateMeaning(goldenState), `preferences.json means what the golden one means (its persistence, shape and the field showDrafts, a toggle, off; ${stateMeaning(builtState)})`)
  // The new node differs by its id (and a label, if the editor gave it one); the State by the id it minted, which the page holds.
  const renamed = JSON.parse(JSON.stringify(bildr(INDEX)).replaceAll(`"${toggleId}"`, '"n_toggle"').replaceAll(`"${builtState.id}"`, `"${goldenState.id}"`))
  for (const doc of [renamed, goldenIndex]) {
    const toggle = findNode(doc.root, node => node.id === 'n_toggle')
    delete toggle.label
  }
  check(meaning(renamed) === meaning(goldenIndex), 'index.json means what the golden one means (the same uses, the checkbox bound and with its change, the computed value, the List\'s items)')
  check(JSON.stringify(findNode(renamed.root, node => node.id === 'n_head').children.map(node => node.id)) === JSON.stringify(['n_h1', 'n_toggle']), 'the checkbox sits in the header row, after the heading')

  // ── 9. The running app renders the toggle and the list ────────────────────────────────────────────────────────────────────
  check(await quiesce(60_000), 'the app regenerates')
  await quiet()
  const rendered = await appShows(browser, '/', 'Show drafts')
  check(rendered.html.includes('Show drafts') && rendered.html.includes('Posts'), 'the running app renders the page with its "Show drafts" toggle')
  check(await until(async () => (await appShows(browser, '/', 'Hello bildr')).html.includes('Hello bildr'), 30_000), 'and its list (the featured post is in it)')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/] })
