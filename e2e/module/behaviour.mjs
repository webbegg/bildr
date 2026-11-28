/**
 * Bind to State and a conditional List source (B4, S3 and S4) on the module editor, all through the inspector: the golden blog's drafts
 * toggle is taken apart by the module's file actions (the checkbox `n_toggle` loses its value and its change, the page its use of the
 * State `preferences`, and the List its computed `posts`: it reads `featured`), and rebuilt with the UI only:
 *
 * 1. the Checkbox's value is bound to `showDrafts` from its binding dot, which lists the State "Blog preferences" although the page
 *    does not use it yet: picking the field adds the page's use first, then binds (the chip reads "showDrafts · Blog preferences");
 * 2. the List's Items become "Depends on a condition": If showDrafts is on, Then All posts, Otherwise Featured posts (the value is
 *    listed under its State, on a full-width row with the is on / is off select below it).
 *
 * The page's file is then the golden one (the same `uses.state`, `uses.computed` and `items` binding, and the same page but for the
 * toggle's change, which B3's UI makes), the running app renders it, and going back to one list drops the computed value, and unbinding the
 * checkbox's field then takes the page's use of the State off with it. Shots go to e2e/module/.shots/ (and to B4_SHOTS when it is set).
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, action, appShows, bildr, check, findNode, openEditor, quiesce, quiet, run, shot, until } from './lib.mjs'

const INDEX = '.bildr/modules/blog/pages/index.json'
const GOLDEN = join(REPO, 'fixtures/codegen/blog', INDEX)

/** A shot in e2e/module/.shots/, and in B4_SHOTS when it is set. */
async function snap(page, name) {
  await shot(page, name)
  if (process.env.B4_SHOTS) {
    mkdirSync(process.env.B4_SHOTS, { recursive: true })
    await page.screenshot({ path: join(process.env.B4_SHOTS, `${name}.png`) })
  }
}

/**
 * A page as what it means: names a page gives its uses (`preferences`, `all`, `posts`) are replaced by what they are (the state, the
 * query, the n-th computed value), and keys are sorted, so two pages that differ only in alias names are equal.
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

await run('behaviour', async ({ page, browser, errors }) => {
  // The blog without its drafts toggle's behaviour: no value and no change on the checkbox, no use of the State, no computed value.
  const index = structuredClone(bildr(INDEX))
  delete index.uses.state
  delete index.uses.computed
  const toggleOf = doc => findNode(doc.root, node => node.id === 'n_toggle')
  delete toggleOf(index).props.value
  delete toggleOf(index).interactions
  findNode(index.root, node => node.id === 'n_list').props.items = { $bind: 'featured' }
  await action('model_file_put', { path: INDEX, content: index })
  check(!bildr(INDEX).uses.state && !bildr(INDEX).uses.computed && !toggleOf(bildr(INDEX)).props.value, 'the blog has no use of the State, no computed value and an unbound checkbox to start with')

  await openEditor(page, 'pg_index')
  await page.locator('[data-sidebar-switcher] [role=tab]').filter({ hasText: /^Layers$/ }).click()

  // S3: the checkbox's value, bound to the State field from its binding dot.
  await page.locator('[data-layer-id="n_toggle"]').click()
  const row = page.locator('[data-prop-row="value"]')
  await row.waitFor()
  check((await row.locator('[data-field-label]').innerText()).trim() === 'Checked', 'the checkbox has a Checked row')
  check(await page.locator('[data-prop-group="Behaviour"] [data-prop-row="value"]').count() === 1, 'in Behaviour')
  await row.hover()
  await row.locator('[data-binding-dot]').click()
  const menu = page.locator('[role=menu]')
  await menu.waitFor()
  const picker = (await menu.innerText()).replace(/\s+/g, ' ').trim()
  check(picker.includes('Blog preferences') && picker.includes('showDrafts'), `its binding dot lists the State "Blog preferences" and its field showDrafts, which the page does not use yet (${picker})`)
  check(picker.includes('State, added to this page'), 'and says picking it adds it to the page')
  check(!/\bst_|entity|composable|\$bind/.test(picker), 'in none of the code\'s words')
  await snap(page, 'b4-picker-with-state')
  await page.getByRole('menuitem', { name: /showDrafts/ }).click()
  const bound = await until(() => toggleOf(bildr(INDEX)).props.value && bildr(INDEX))
  check(JSON.stringify(toggleOf(bound).props.value) === JSON.stringify({ $bind: 'preferences.showDrafts' }), `the checkbox's value is bound to preferences.showDrafts (${JSON.stringify(toggleOf(bound)?.props.value)})`)
  check(JSON.stringify(bound.uses.state) === JSON.stringify([{ as: 'preferences', state: 'st_preferences' }]), `and the page now uses the State, added by the same pick (${JSON.stringify(bound.uses.state)})`)
  const chip = (await row.locator('[data-bound-expression]').innerText()).replace(/\s+/g, ' ').trim()
  check(chip === 'showDrafts · Blog preferences', `the row shows the chip "showDrafts · Blog preferences" (${chip})`)
  await row.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await snap(page, 'b4-bound-chip')

  // A text's binding dot opens the one data picker (the page's data, its stores and APIs), which stays open over the row.
  await page.locator('[data-layer-id="n_h1"]').click()
  const textRow = page.locator('[data-prop-row="text"]')
  await textRow.waitFor()
  await textRow.hover()
  await textRow.locator('[data-binding-dot]').click()
  await page.getByRole('menuitem', { name: /Bind to data/ }).click()
  const dataPicker = page.locator('[data-data-picker]')
  check(await until(() => dataPicker.isVisible()), 'Bind to data on a text opens the data picker')
  await page.waitForTimeout(300)
  const offered = (await dataPicker.innerText()).replace(/\s+/g, ' ')
  check(await dataPicker.isVisible() && offered.includes('site') && offered.includes('Blog preferences'), `and it stays open, listing the page's data and its stores (${offered})`)
  await page.keyboard.press('Escape')
  await page.locator('[data-layer-id="n_toggle"]').click()

  // S4: the List's source depends on that value.
  await page.locator('[data-layer-id="n_list"]').click()
  const items = page.locator('[data-testid="list-items"]')
  await items.waitFor()
  check(await items.inputValue() === 'featured', 'the List reads Featured posts')
  const labels = await items.locator('option').allInnerTexts()
  check(labels.map(label => label.trim()).includes('Depends on a condition'), `the Items list offers "Depends on a condition" (${labels.map(label => label.trim()).join(' | ')})`)
  await items.selectOption('cond')
  const condition = page.locator('[data-testid="list-condition"]')
  await condition.waitFor()
  check(!bildr(INDEX).uses.computed, 'choosing it writes nothing until the condition and both lists are chosen')
  await page.locator('[data-testid="list-condition-then"]').selectOption({ label: 'All posts' })
  await page.locator('[data-testid="list-condition-else"]').selectOption({ label: 'Featured posts' })
  check(!bildr(INDEX).uses.computed, 'nor with the lists chosen and no condition')
  const ifSelect = page.locator('[data-testid="list-condition-if"]')
  const groups = await ifSelect.locator('optgroup').evaluateAll(list => list.map(group => `${group.label}: ${[...group.querySelectorAll('option')].map(option => option.textContent.trim()).join()}`))
  check(groups.join() === 'Blog preferences: showDrafts', `the If select lists the field under its State, named by the field alone (${groups})`)
  await ifSelect.selectOption({ label: 'showDrafts' })
  check(await ifSelect.getAttribute('title') === 'showDrafts · Blog preferences', `its title says the whole name (${await ifSelect.getAttribute('title')})`)
  const ifBox = await ifSelect.boundingBox()
  const notBox = await page.locator('[data-testid="list-condition-not"]').boundingBox()
  const formBox = await condition.boundingBox()
  check(!!ifBox && !!notBox && !!formBox && notBox.y > ifBox.y + ifBox.height - 1 && ifBox.width > formBox.width * 0.6, `the If select has a full-width row, with is on / is off below it (if ${ifBox?.width}px of ${formBox?.width}px, not at ${notBox?.y} below ${ifBox?.y})`)
  const written = await until(() => bildr(INDEX).uses.computed && bildr(INDEX))
  check(JSON.stringify(written?.uses.computed) === JSON.stringify([{ as: 'posts', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } }]), `the page gets the computed value posts: if showDrafts then all else featured (${JSON.stringify(written?.uses.computed)})`)
  check(await until(() => JSON.stringify(findNode(bildr(INDEX).root, node => node.id === 'n_list').props.items) === JSON.stringify({ $bind: 'posts' })), 'and the List\'s items bind posts')
  const summary = (await page.locator('[data-testid="list-condition-summary"]').innerText()).trim()
  check(summary === 'If showDrafts is on: Then All posts, Otherwise Featured posts', `the source reads "${summary}"`)
  check(await items.inputValue() === 'cond', 'the Items list shows the condition, not the name posts')
  const branches = await page.locator('[data-testid="source"]').evaluateAll(sources => sources.map(source => `${source.getAttribute('data-branch')}:${source.getAttribute('data-alias')}`))
  check(branches.join() === 'then:all,else:featured', `each query keeps its own sort, filter and limit, named by its branch (${branches})`)
  const words = (await page.locator('[data-testid="list-source"]').innerText()).replace(/\s+/g, ' ')
  check(!/computed|\$bind|st_|composable/.test(words), 'in none of the code\'s words')
  await page.locator('[data-testid="list-source"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await snap(page, 'b4-conditional-source')

  // The page is the golden one but for the toggle's change.
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
  delete toggleOf(golden).interactions
  check(meaning(bildr(INDEX)) === meaning(golden), 'the page\'s file means what the golden blog\'s page means, but for the checkbox\'s change (the same uses, computed value, bindings)')
  const now = bildr(INDEX)
  const goldenFull = JSON.parse(readFileSync(GOLDEN, 'utf8'))
  check(JSON.stringify(now.uses.state.map(use => use.state)) === JSON.stringify(goldenFull.uses.state.map(use => use.state)) && JSON.stringify(now.uses.computed) === JSON.stringify(goldenFull.uses.computed), 'the same uses.state and computed as the golden page')
  check(JSON.stringify(findNode(now.root, node => node.id === 'n_list').props.items) === JSON.stringify(findNode(goldenFull.root, node => node.id === 'n_list').props.items), 'and the same items binding')

  // The app renders it.
  check(await quiesce(60_000), 'the app regenerates')
  await quiet()
  const rendered = await appShows(browser, '/', 'Show drafts')
  check(rendered.html.includes('Show drafts') && rendered.html.includes('Posts'), 'the running app renders the page')

  // Going back to one list takes the computed value away, and leaves the page's use of the State.
  await items.selectOption('all')
  const single = await until(() => !bildr(INDEX).uses.computed && bildr(INDEX))
  check(!!single && JSON.stringify(findNode(single.root, node => node.id === 'n_list').props.items) === JSON.stringify({ $bind: 'all' }), 'choosing All posts binds the List to it and drops the computed value nothing else reads')
  check(await page.locator('[data-testid="list-condition"]').count() === 0, 'and the condition is gone from the panel')
  // Unbinding the checkbox's field takes the page's use of the State off with it: nothing else on the page reads or sets it now.
  await page.locator('[data-layer-id="n_toggle"]').click()
  await row.locator('[data-binding-chip-unbind]').click()
  const unbound = await until(() => !toggleOf(bildr(INDEX)).props.value && bildr(INDEX))
  check(!!unbound, 'unbinding the field removes the binding')
  check(await until(() => !bildr(INDEX).uses.state?.length), `and the page's use of the State, which nothing else reads (${JSON.stringify(bildr(INDEX).uses.state)})`)
  check(await quiesce(60_000), 'the app regenerates')
  await quiet()
  const after = await appShows(browser, '/', 'Show drafts')
  check(after.html.includes('Show drafts'), 'the running app still renders the page')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/] })
