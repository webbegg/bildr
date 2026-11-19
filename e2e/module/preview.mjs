/**
 * State in the canvas preview (B5, S5) on the module editor, on the golden blog's index page: its Checkbox "Show drafts" sets the
 * State `preferences.showDrafts` on change, and its List reads the computed `posts` (the featured posts, or every post when it is on).
 *
 * 1. The canvas shows the featured list (the draft post "A draft" is not in it) and the checkbox is off, as the app first renders.
 * 2. A click in design mode selects the checkbox and changes nothing on the canvas.
 * 3. In preview (the Interact toggle) a click on "Show drafts" shows the draft in the List; a second click takes it away; the
 *    control and its label both toggle.
 * 4. Reset state (shown in preview) puts the State back to its default while preview goes on; so does leaving preview, and so does
 *    reloading the editor, which holds the value in memory only.
 * 5. Design mode is still design mode afterwards: a click selects. (In preview, Space and Enter on the focused checkbox toggle it.)
 * 6. "Is off" (a `not` over the field, B4) flips the List the other way: with the field off, as it starts, the List shows the Then
 *    list; in preview the toggle sends it to the Otherwise list; and "is on" puts the page back as it was.
 *
 * The canvas reads the app's rows when the app answers and the model's Sample data when it does not. The app's database starts
 * empty, so the script seeds it with a published post and the draft (as visual-editor.mjs does), and waits for the Live badge: the
 * List then shows the app's own rows, not the fixtures. Shots go to e2e/module/.shots/ (and to B5_SHOTS when it is set).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { bildr, canvas, check, openEditor, run, seedPosts, shot, until } from './lib.mjs'

const INDEX = '.bildr/modules/blog/pages/index.json'

/** A shot in e2e/module/.shots/, and in B5_SHOTS when it is set. */
async function snap(page, name) {
  await shot(page, name)
  if (process.env.B5_SHOTS) {
    mkdirSync(process.env.B5_SHOTS, { recursive: true })
    await page.screenshot({ path: join(process.env.B5_SHOTS, `${name}.png`) })
  }
}

await run('preview', async ({ page, errors }) => {
  await seedPosts([{ title: 'Hello bildr', slug: 'hello-bildr', published: true, publishedAt: '2026-11-01T09:00:00.000Z' }, { title: 'A draft', slug: 'a-draft' }])
  await openEditor(page, 'pg_index')
  await page.locator('[data-sidebar-switcher] [role=tab]').filter({ hasText: /^Layers$/ }).click()
  const frame = canvas(page)
  const list = frame.locator('[data-node="n_list"]')
  const control = frame.getByRole('checkbox', { name: 'Show drafts' })
  const label = frame.locator('label', { hasText: 'Show drafts' })
  const text = async () => (await list.innerText()).replace(/\s+/g, ' ')
  const shows = async (title, there) => until(async () => (await text()).includes(title) === there)
  const checked = async () => await control.getAttribute('aria-checked')
  const interact = page.locator('[data-testid="preview-toggle"]')
  const reset = page.locator('[data-testid="reset-state"]')
  const badge = page.locator('[data-testid="data-badge"]')
  check(await until(async () => await badge.getAttribute('data-state') === 'live', 60_000), 'the canvas shows the app\'s own rows (the badge says Live)')

  // 1. The featured list.
  check(await shows('Hello bildr', true), 'the canvas shows the featured list: the published post is in it')
  check(!(await text()).includes('A draft'), 'and the draft post "A draft" is not')
  check(await checked() === 'false', 'the "Show drafts" checkbox is off, as the app\'s first render')
  check(await reset.count() === 0, 'there is no Reset state while the canvas is in design mode')

  // 2. A click in design mode selects.
  await control.click()
  check(await until(async () => await page.locator('[data-layer-id="n_toggle"][aria-selected="true"]').count() === 1), 'a click on the checkbox in design mode selects it')
  check(await checked() === 'false' && !(await text()).includes('A draft'), 'and changes nothing on the canvas')

  // 3. Preview: the toggle switches the List.
  await snap(page, 'b5-preview-before')
  await interact.click()
  check(await interact.getAttribute('aria-pressed') === 'true', 'Interact puts the canvas in preview')
  check(await reset.isVisible() && await reset.isDisabled(), 'Reset state is there, with nothing to reset yet')
  await label.click()
  check(await shows('A draft', true), 'in preview a click on "Show drafts" shows the draft post in the List')
  check(await shows('Hello bildr', true) && await checked() === 'true', 'the published post stays, and the checkbox is on')
  check(await reset.isEnabled(), 'Reset state can be used now')
  await frame.locator('[data-node="n_list"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await snap(page, 'b5-preview-after')
  await control.click()
  check(await shows('A draft', false) && await checked() === 'false', 'a second click, on the control itself, takes the draft away again')
  check(await shows('Hello bildr', true), 'and leaves the featured list')

  // 4. Reset.
  await label.click()
  check(await shows('A draft', true), 'the draft is in the List again')
  await reset.click()
  check(await shows('A draft', false) && await checked() === 'false', 'Reset state puts the checkbox and the List back to the State\'s default')
  check(await interact.getAttribute('aria-pressed') === 'true' && await reset.isDisabled(), 'preview goes on, with nothing left to reset')
  await control.click()
  check(await shows('A draft', true), 'and the toggle works again')
  // Keys: Space and Enter on the focused checkbox toggle it in preview, as they toggle the app's.
  await control.focus()
  await page.keyboard.press('Space')
  check(await shows('A draft', false) && await checked() === 'false', 'Space on the focused checkbox toggles it in preview')
  await page.keyboard.press('Enter')
  check(await shows('A draft', true) && await checked() === 'true', 'and so does Enter')
  await interact.click()
  check(await shows('A draft', false) && await checked() === 'false' && await reset.count() === 0, 'leaving preview shows the page as the app first renders it')
  await interact.click()
  check(await shows('A draft', false) && await checked() === 'false', 'and coming back to preview starts from the default')

  await label.click()
  check(await shows('A draft', true), 'the draft is in the List once more')
  await page.reload()
  await page.locator('[data-view-menu]').waitFor()
  await frame.locator('[data-node]').first().waitFor({ state: 'attached' })
  await page.locator('[data-testid="preview-toggle"]').click()
  check(await shows('Hello bildr', true) && await shows('A draft', false) && await checked() === 'false', 'a reload of the editor starts over: the value is not kept')

  // 5. Design mode selects.
  await page.locator('[data-testid="preview-toggle"]').click()
  await frame.locator('[data-canvas-mode="edit"]').waitFor()
  await page.locator('[data-sidebar-switcher] [role=tab]').filter({ hasText: /^Layers$/ }).click()
  await frame.locator('[data-node="n_h1"]').click()
  check(await until(async () => await page.locator('[data-layer-id="n_h1"][aria-selected="true"]').count() === 1), 'back in design mode a click selects the heading')

  // 6. "Is off": the condition read the other way flips the List the other way.
  await page.locator('[data-layer-id="n_list"]').click()
  const isOn = page.locator('[data-testid="list-condition-not"]')
  await isOn.waitFor()
  const condition = () => JSON.stringify(bildr(INDEX).uses.computed?.[0]?.if)
  check(condition() === JSON.stringify({ $bind: 'preferences.showDrafts' }), 'the golden page\'s List shows All posts when showDrafts is on')
  await isOn.selectOption('off')
  check(await until(() => condition() === JSON.stringify({ not: { $bind: 'preferences.showDrafts' } })), `"is off" writes the condition as a not (${condition()})`)
  check(await shows('A draft', true) && await checked() === 'false', 'with the field off, as it starts, the List shows the Then list: all posts, the draft too')
  await interact.click()
  await label.click()
  check(await shows('A draft', false) && await shows('Hello bildr', true) && await checked() === 'true', 'in preview the toggle turns the field on and sends the List to the Otherwise list: the featured posts')
  await label.click()
  check(await shows('A draft', true) && await checked() === 'false', 'and turning it off again flips it back')
  await interact.click()
  await isOn.selectOption('on')
  check(await until(() => condition() === JSON.stringify({ $bind: 'preferences.showDrafts' })), 'choosing "is on" again puts the page\'s condition back')
  check(await shows('A draft', false), 'and the List back to the featured posts')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
