/**
 * The simple Data section on the module editor (simple data, SD-1, S2, S3): the menu's Data opens the simple section at `#/data`, a list of Stores
 * and APIs; a store "cart" is made from the Stores section's "+" (kept for this tab), given a field in its form, saved with
 * one Save and shown again after a reload, each step checked in `.bildr/modules/blog/state/cart.json`. The Advanced switch opens today's
 * workspace at `#/data/advanced` on the same store and its Simple link comes back, an old `#/data?item=collection:…` link lands in the
 * workspace with its query, and the store is deleted from its form. The golden model is put back after. Shots go to e2e/module/.shots/.
 */
import { bildr, check, editorUrl, openSimpleData, run, shot, until } from './lib.mjs'

const CART = 'modules/blog/state/cart.json'
const route = page => decodeURIComponent(page.url()).replace(/.*#/, '#')

/** The words the simple section never uses: the workspace's and the code's. */
const JARGON = /\b(state|composable|collection|entity|artifact|datasource|data source)\b/i

/** Everything the user can read on the page: its text (dialogs included) and its labels, titles and placeholders. */
const said = page => page.evaluate(() => [
  document.body.innerText,
  ...[...document.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap(element => ['aria-label', 'title', 'placeholder'].map(name => element.getAttribute(name) ?? ''))
].join(' '))

/** Checks the section's words where it is now: `what` says where. */
const plain = async (page, what) => {
  const words = await said(page)
  check(!JARGON.test(words), `${what} is in plain words, with no state, composable, collection, entity, artifact or datasource (${JARGON.exec(words)?.[0] ?? ''})`)
  check(!/\buse[A-Z][A-Za-z0-9]+/.test(words), `${what} names no generated composable`)
}

await run('simple-data', async ({ page }) => {
  // The top bar's Data entry opens the simple section.
  await page.goto(editorUrl('/design'))
  await page.locator('[data-view-menu]').waitFor()
  await page.locator('[data-view-menu]').click()
  await page.locator('[role^=menuitem]').filter({ hasText: /^\s*Data\s*$/ }).click()
  await page.locator('[data-testid="simple-data"]').waitFor()
  check(route(page) === '#/data' && (await page.locator('[data-view-menu]').innerText()).trim() === 'Data', `the menu's Data opens the simple section (${route(page)})`)
  await page.locator('[data-simple-list]').waitFor()

  // The list: Stores and APIs.
  const headings = (await page.locator('[data-simple-section] h2').allInnerTexts()).map(name => name.trim())
  check(headings.join() === 'Stores,APIs', `the list has a Stores and an APIs section (${headings})`)
  check(await page.locator('[data-simple-store="st_preferences"]').count() === 1, 'the Stores section lists the blog\'s store')
  // The Advanced switch: its label and its hook are checked apart.
  check((await page.locator('[data-testid="simple-to-advanced"]').innerText()).trim() === 'Advanced', 'the switch to the workspace is labelled Advanced')
  check(await page.locator('[data-testid="simple-to-advanced"]').count() === 1, 'and has its hook')
  await plain(page, 'the list')
  await shot(page, 'simple-data-list')

  // Make a store: a name and how long it keeps its values.
  await page.locator('[data-simple-new-store]').click()
  await page.locator('[data-simple-create]').waitFor()
  const choices = await page.locator('[data-simple-persist]').evaluateAll(cards => cards.map(card => `${card.getAttribute('data-simple-persist')}${card.getAttribute('aria-checked') === 'true' ? '*' : ''}`))
  check(choices.join() === 'memory*,session,localStorage', `New store offers Forgotten on reload (chosen), Kept for this tab and Kept in this browser (${choices})`)
  check((await page.locator('[data-simple-shape]').innerText()).includes('One set of values'), 'and says a store holds one set of values')
  await plain(page, 'the New store form')
  await page.locator('[data-simple-name]').fill('cart')
  await page.locator('[data-simple-persist="session"]').click()
  await shot(page, 'simple-data-new-store')
  await page.locator('[data-simple-create-submit]').click()
  const made = await until(() => bildr(CART))
  check(made?.id === 'st_cart' && made.persist === 'session' && made.shape === 'single' && made.fields.length === 1, `Create writes the store, kept for this tab, with its one field (${made?.id} ${made?.persist})`)
  await page.locator('[data-simple-store-form="st_cart"]').waitFor()
  check(await until(() => route(page) === '#/data?item=state:st_cart'), `the store is in the URL (${route(page)})`)
  check(await page.locator('[data-simple-section="state"] [data-simple-store="st_cart"]').count() === 1, 'and a row in the State section')

  // A field, saved with the one Save.
  await page.locator('[data-simple-field-add]').click()
  const added = page.locator('[data-simple-field]').last()
  await added.locator('[data-simple-field-name]').fill('total')
  await added.locator('[data-simple-field-type]').click()
  await page.getByRole('option', { name: 'Integer', exact: true }).click()
  await added.locator('[data-simple-field-default]').fill('0')
  check((await page.locator('[data-simple-state-unsaved]').innerText()) === 'Unsaved changes', 'an edit says "Unsaved changes"')
  check(!bildr(CART).fields.some(field => field.name === 'total'), 'and writes nothing before Save')
  await page.locator('[data-simple-state-save]').click()
  const saved = await until(() => bildr(CART)?.fields.some(field => field.name === 'total') && bildr(CART))
  const total = saved?.fields.find(field => field.name === 'total')
  check(total?.type === 'integer' && total.default === 0 && saved.fields.length === 2, `Save writes the list with total, a whole number that starts at 0 (${JSON.stringify(saved?.fields)})`)
  check(await until(async () => await page.locator('[data-simple-state-unsaved]').count() === 0), 'and nothing is unsaved after it')

  // Discard writes nothing.
  await page.locator('[data-simple-persist="localStorage"]').click()
  check(await page.locator('[data-simple-state-discard]').isEnabled(), 'a change of how long it keeps its values can be discarded')
  await page.locator('[data-simple-state-discard]').click()
  check(await page.locator('[data-simple-persist="session"]').getAttribute('aria-checked') === 'true' && bildr(CART).persist === 'session', 'which puts the saved choice back and writes nothing')

  // Reload: the store is still there, with its fields.
  await page.reload()
  await page.locator('[data-simple-store-form="st_cart"]').waitFor()
  const names = await page.locator('[data-simple-field-name] input, input[data-simple-field-name]').evaluateAll(inputs => inputs.map(input => input.value))
  check(names.join() === 'value,total', `after a reload the store shows its fields (${names})`)
  await shot(page, 'simple-data-store')
  await plain(page, 'a store\'s form')
  await page.locator('[data-simple-rename]').click()
  await page.locator('[data-artifact-dialog="rename"]').waitFor()
  check((await page.locator('[role="dialog"]').innerText()).includes('Rename store'), 'the Rename dialog says store')
  await plain(page, 'the Rename dialog')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('[data-artifact-dialog="rename"]').waitFor({ state: 'detached' })

  // Advanced: today's workspace on its own route, on the same store; Simple comes back.
  await page.locator('[data-testid="simple-to-advanced"]').click()
  await page.locator('[data-testid="data"]').waitFor()
  await page.locator('[data-data-tree]').waitFor()
  check(await until(() => route(page).startsWith('#/data/advanced?item=state:st_cart')), `Advanced opens the workspace on the store (${route(page)})`)
  check((await page.locator('[data-view-menu]').innerText()).trim() === 'Data' && await page.locator('[data-data-title] h2').innerText() === 'Cart', 'the menu still says Data, and the workspace shows it')
  await page.locator('[data-testid="advanced-to-simple"]').click()
  await page.locator('[data-testid="simple-data"]').waitFor()
  await page.locator('[data-simple-list]').waitFor()
  check(route(page) === '#/data' && await page.locator('[data-simple-store="st_cart"]').count() === 1, `Simple comes back to the simple section (${route(page)})`)

  // An old Data link, with a part only the workspace has, lands in the workspace with its query.
  await page.goto(editorUrl('/data?item=collection:ent_post&tab=fields'))
  await page.locator('[data-testid="data"]').waitFor()
  check(await until(() => route(page) === '#/data/advanced?item=collection:ent_post&tab=fields'), `an old /data?item=collection link lands in the workspace (${route(page)})`)

  // Delete from the form: nothing uses it, so it goes.
  await openSimpleData(page)
  await page.locator('[data-simple-store="st_cart"]').click()
  await page.locator('[data-simple-delete]').click()
  await page.locator('[data-artifact-dialog="delete"]').waitFor()
  check(await page.locator('[data-artifact-uses]').count() === 0, 'a store nothing uses can be deleted')
  check((await page.locator('[role="dialog"]').innerText()).includes('Delete store'), 'the Delete dialog says store')
  await plain(page, 'the Delete dialog')
  await page.locator('[data-artifact-submit]').click()
  check(await until(() => bildr(CART) === undefined), 'Delete removes its file')
  check(await until(async () => await page.locator('[data-simple-store="st_cart"]').count() === 0), 'and its row')

  // A store a page uses is refused, and its places are listed.
  await page.locator('[data-simple-store="st_preferences"]').click()
  await page.locator('[data-simple-delete]').click()
  await page.locator('[data-artifact-uses]').waitFor()
  check(await page.locator('[data-artifact-submit]').isDisabled() && await page.locator('[data-artifact-uses] [data-use-open="page:pg_index"]').count() === 1, 'a store a page uses can\'t be deleted: the page is listed and Delete is off')
  await plain(page, 'the Delete dialog of a store a page uses')
})
