/**
 * The Design view and the theme library (S36): open it from the view menu,
 * ⌘K and Assets; a primary change and a colour-picker drag restyle the live
 * style guide; save the theme as "Brand A", apply it to a second project
 * (its primary matches) and undo it; rename, duplicate and delete from the
 * row menu. Shots go to e2e/.shots/design/.
 */
import { action, check, openEditor, project, run, shot, toView, trackTheme, until } from './lib.mjs'

const guide = page => page.frameLocator('iframe[title="Token preview"]')
const shade = (page, name) => guide(page).locator(`[data-token-shade="${name}"]`).evaluate(el => getComputedStyle(el).backgroundColor)
const themeOf = async projectId => (await action('theme_get', { projectId })).theme
const library = async () => (await action('theme_library_list')).themes
const row = (page, id) => page.locator(`[data-theme-row="${id}"]`)

async function rowMenu(page, id, item) {
  await row(page, id).hover()
  await row(page, id).getByLabel('Theme actions').click()
  await page.locator('[role^=menuitem]').filter({ hasText: item }).click()
}

/** Whether the field stays focused a moment later (a closing menu once took the focus back). */
async function staysFocused(page, field) {
  await field.waitFor()
  await page.waitForTimeout(500)
  return await field.isVisible() && await field.evaluate(el => el === document.activeElement)
}

await run('design-system', async ({ page, errors }) => {
  const a = await project('design system a')
  const b = await project('design system b')

  // Open it from the view menu.
  await openEditor(page, a.id)
  await toView(page, 'Design')
  await guide(page).locator('[data-style-guide]').waitFor()
  check(await page.locator('[data-theme-library]').isVisible() && await page.locator('[data-design-panel]').isVisible(), 'the view menu opens the Design view: library, style guide and controls')
  const guideCounts = await guide(page).locator('[data-style-guide]').evaluate(el => ({
    shades: el.querySelectorAll('[data-token-shade]').length,
    buttons: el.querySelectorAll('[data-token-button]').length,
    type: el.querySelectorAll('[data-type-sample]').length,
    radii: el.querySelectorAll('[data-token-radius]').length
  }))
  check(guideCounts.shades === 77 && guideCounts.buttons === 21 && guideCounts.type === 5 && guideCounts.radii === 5, `the style guide shows 7×11 shades, 7×3 buttons, h1–h4 and body, 5 radii (${JSON.stringify(guideCounts)})`)
  await page.waitForTimeout(500)
  await shot(page, 'design/view')
  await guide(page).locator('[data-token-button]').first().scrollIntoViewIfNeeded()
  await shot(page, 'design/view-components')

  // And from ⌘K.
  await toView(page, 'Canvas')
  await page.locator('body').press('Control+k')
  await page.locator('[data-quick-actions] input').fill('Design system')
  await page.locator('[data-quick-actions] [role=option][data-highlighted]').filter({ hasText: 'Design system' }).waitFor()
  await page.locator('[data-quick-actions] input').press('Enter')
  check(await until(() => page.locator('[data-view-menu]').filter({ hasText: 'Design' }).isVisible()), '⌘K "Design system" opens the Design view')
  await guide(page).locator('[data-style-guide]').waitFor()

  // A primary change restyles the style guide.
  const green = await shade(page, 'primary-500')
  await page.locator('[data-theme-color="primary"]').click()
  await page.getByRole('option', { name: 'rose', exact: true }).click()
  const rose = await until(async () => {
    const bg = await shade(page, 'primary-500')
    return bg !== green && bg
  })
  check(rose && (await themeOf(a.id)).colors.primary === 'rose', `primary → rose updates the theme and the style guide (${green} → ${rose})`)

  // Dragging the colour picker previews live, and closing it commits.
  await page.getByLabel('Primary custom colour').click()
  const picker = page.locator('[data-slot="selector"], [class*="selector"]').filter({ visible: true }).first()
  const box = await picker.boundingBox()
  if (check(box, 'the colour picker opens')) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 5 })
    const dragged = await until(async () => {
      const bg = await shade(page, 'primary-500')
      return bg !== rose && bg
    })
    check(dragged && (await themeOf(a.id)).colors.primary === 'rose', `the drag previews in the style guide before it commits (${dragged})`)
    await page.mouse.up()
    await page.keyboard.press('Escape')
    const hex = await until(async () => {
      const value = (await themeOf(a.id)).colors.primary
      return value.startsWith('#') && value
    })
    check(hex, `closing the picker commits the colour (${hex})`)
    await page.locator('[data-theme-color="primary"]').click()
    await page.getByRole('option', { name: 'rose', exact: true }).click()
    await until(async () => (await themeOf(a.id)).colors.primary === 'rose')
  }

  // Save it as "Brand A".
  await page.locator('[data-theme-save]').click()
  const saveField = page.locator('[data-theme-save-name]')
  check(await staysFocused(page, saveField), '"Save current as theme" shows a focused name field')
  await saveField.fill('Brand A')
  await saveField.press('Enter')
  const brand = await until(async () => (await library()).find(t => t.name === 'Brand A'))
  if (brand) trackTheme(brand.id)
  check(brand && brand.theme.colors.primary === 'rose', 'saves the theme as "Brand A"')
  await row(page, brand.id).waitFor()
  check(await row(page, brand.id).locator('[data-theme-current]').isVisible(), 'the row shows it matches the project theme')

  // Apply it to the second project.
  await openEditor(page, b.id)
  await toView(page, 'Design')
  await guide(page).locator('[data-style-guide]').waitFor()
  const before = await themeOf(b.id)
  await row(page, brand.id).hover()
  await row(page, brand.id).getByLabel('Theme actions').click()
  await page.locator('[role^=menuitem]').first().waitFor()
  await page.waitForTimeout(500)
  await shot(page, 'design/library-menu')
  await page.locator('[role^=menuitem]').filter({ hasText: 'Apply' }).click()
  const applied = await until(async () => (await themeOf(b.id)).colors.primary === 'rose')
  const bRose = await until(async () => {
    const bg = await shade(page, 'primary-500')
    return bg === rose && bg
  })
  check(applied && bRose, `"Brand A" applied to the second project: its primary matches (${bRose})`)
  const history = await action('history_get', { projectId: b.id })
  check(history.undo === 'Apply theme Brand A', `one undo step, "${history.undo}"`)
  check((await themeOf(a.id)).colors.primary === 'rose', 'the first project is unchanged')

  // Undo restores the old theme.
  await page.getByRole('button', { name: 'Undo' }).click()
  const restored = await until(async () => JSON.stringify(await themeOf(b.id)) === JSON.stringify(before))
  const back = await until(async () => {
    const bg = await shade(page, 'primary-500')
    return bg === green && bg
  })
  check(restored && back, `undo restores the old theme (${back})`)

  // Rename, duplicate and delete.
  await rowMenu(page, brand.id, 'Rename')
  const renameField = page.getByLabel('Rename theme')
  check(await staysFocused(page, renameField), 'Rename from the … menu stays open and focused')
  await renameField.fill('Brand B')
  await renameField.press('Enter')
  check(await until(async () => (await library()).find(t => t.id === brand.id)?.name === 'Brand B'), 'renames the theme to "Brand B"')
  await row(page, brand.id).filter({ hasText: 'Brand B' }).waitFor()

  await rowMenu(page, brand.id, 'Duplicate')
  const copy = await until(async () => (await library()).find(t => t.name === 'Brand B copy'))
  if (copy) trackTheme(copy.id)
  check(copy && await until(() => row(page, copy.id).isVisible()), 'duplicates it as "Brand B copy"')

  await rowMenu(page, copy.id, 'Delete')
  await page.locator('[data-theme-delete-confirm]').click()
  check(await until(async () => !(await library()).some(t => t.id === copy.id)) && await until(async () => !(await row(page, copy.id).count())), 'deletes the copy after the confirm')
  await rowMenu(page, brand.id, 'Delete')
  await page.getByRole('button', { name: 'Cancel' }).click()
  check((await library()).some(t => t.id === brand.id), 'Cancel keeps the theme')
  await rowMenu(page, brand.id, 'Delete')
  await page.locator('[data-theme-delete-confirm]').click()
  check(await until(async () => !(await library()).some(t => t.id === brand.id)), 'deletes "Brand B"')

  // The Assets row opens the Design view.
  await toView(page, 'Canvas')
  await page.getByRole('tab', { name: 'Assets' }).click()
  await page.locator('[data-assets-design-system]').waitFor()
  await page.waitForTimeout(500)
  await shot(page, 'design/assets')
  await page.locator('[data-assets-design-system]').click()
  check(await until(() => page.locator('[data-design-area]').isVisible()), 'Assets › Design system opens the Design view')

  // Other library themes may come and go meanwhile (the library is shared); only this script's names count.
  const left = (await library()).filter(t => /^Brand [AB]( copy)?$/.test(t.name))
  check(left.length === 0, `no library themes left behind (${left.map(t => t.name).join(', ')})`)
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
