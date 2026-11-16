/**
 * The Design view on the module editor (port of e2e/design-system.mjs): open it from the view menu,
 * ⌘K and Assets; a primary change and a colour-picker drag restyle the live style guide; a bundled
 * theme preset is applied from the library (one undo step, undone); the Assets row opens the Design
 * view. Each edit is checked in `.bildr/theme.json`. Shots go to e2e/module/.shots/design/.
 *
 * Dropped (the feature doc: the theme-library save is gone with the hosted multi-project app; the
 * module's library is the bundled presets, `theme_presets_list` / `theme_apply`):
 * - save the current theme as "Brand A", and the saved-theme row;
 * - apply it to a second project (one project per editor; the preset apply replaces it);
 * - rename, duplicate and delete from the row menu (presets are read-only).
 */
import { action, bildr, check, lastStep, newPage, openEditor, run, shot, toView, until } from './lib.mjs'

const guide = page => page.frameLocator('iframe[title="Token preview"]')
const shade = (page, name) => guide(page).locator(`[data-token-shade="${name}"]`).evaluate(el => getComputedStyle(el).backgroundColor)
const themeOf = () => bildr('theme.json')
const row = (page, id) => page.locator(`[data-theme-row="${id}"]`)

await run('design-system', async ({ page, errors }) => {
  const p = await newPage('design-system')

  // Open it from the view menu.
  await openEditor(page, p.pageId)
  await toView(page, 'Design system')
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
  await page.locator('[data-canvas-stage]').waitFor()
  await page.waitForTimeout(500)
  await page.locator('body').press('Control+k')
  await page.locator('[data-quick-actions] input').fill('Design system')
  await page.locator('[data-quick-actions] [role=option][data-highlighted]').filter({ hasText: 'Design system' }).waitFor()
  await page.locator('[data-quick-actions] input').press('Enter')
  check(await until(() => page.locator('[data-view-menu]').filter({ hasText: 'Design' }).isVisible()), '⌘K "Design system" opens the Design view')
  await guide(page).locator('[data-style-guide]').waitFor()

  // A primary change restyles the style guide.
  const before = themeOf().colors.primary
  const first = await shade(page, 'primary-500')
  await page.locator('[data-theme-color="primary"]').click()
  await page.getByRole('option', { name: 'rose', exact: true }).click()
  const rose = await until(async () => {
    const bg = await shade(page, 'primary-500')
    return bg !== first && bg
  })
  check(rose && themeOf().colors.primary === 'rose', `primary ${before} → rose updates theme.json and the style guide (${first} → ${rose})`)

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
    check(dragged && themeOf().colors.primary === 'rose', `the drag previews in the style guide before it commits (${dragged})`)
    await page.mouse.up()
    await page.keyboard.press('Escape')
    const hex = await until(() => themeOf().colors.primary.startsWith('#') && themeOf().colors.primary)
    check(hex, `closing the picker commits the colour to theme.json (${hex})`)
    await page.locator('[data-theme-color="primary"]').click()
    await page.getByRole('option', { name: 'rose', exact: true }).click()
    await until(() => themeOf().colors.primary === 'rose')
  }

  // A bundled preset from the library (the module's version of "apply a saved theme").
  const { presets } = await action('theme_presets_list')
  const preset = presets.find(entry => JSON.stringify(entry.theme.colors) !== JSON.stringify(themeOf().colors)) ?? presets[0]
  check(!!preset && await until(() => row(page, preset.id).isVisible()), `the library lists the bundled presets (${presets.map(entry => entry.name).join(', ')})`)
  const wasTheme = themeOf()
  await row(page, preset.id).hover()
  await row(page, preset.id).getByLabel('Theme actions').click()
  await page.locator('[role^=menuitem]').first().waitFor()
  await page.waitForTimeout(500)
  await shot(page, 'design/library-menu')
  await page.locator('[role^=menuitem]').filter({ hasText: 'Apply' }).click()
  const applied = await until(() => themeOf().colors.primary === preset.theme.colors.primary && themeOf())
  check(applied, `Apply "${preset.name}" writes its colours to theme.json (primary ${themeOf().colors.primary})`)
  check(await until(() => row(page, preset.id).locator('[data-theme-current]').isVisible()), 'the row shows it matches the project theme')
  check(await lastStep() === 'theme_apply', `one undo step, "${await lastStep()}"`)

  // Undo restores the old theme.
  await page.getByRole('button', { name: 'Undo' }).click()
  const restored = await until(() => JSON.stringify(themeOf()) === JSON.stringify(wasTheme))
  check(restored, 'undo restores the old theme in theme.json')

  // The Assets row opens the Design view.
  await toView(page, 'Canvas')
  await page.getByRole('tab', { name: 'Assets' }).click()
  await page.locator('[data-assets-design-system]').waitFor()
  await page.waitForTimeout(500)
  await shot(page, 'design/assets')
  await page.locator('[data-assets-design-system]').click()
  check(await until(() => page.locator('[data-design-area]').isVisible()), 'Assets › Design system opens the Design view')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
