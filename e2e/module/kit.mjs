/**
 * The editor widget kit on the module editor (port of e2e/kit.mjs, S33), one check per screen: its
 * fields are the kit's 30px soft field (a computed background, neither white nor transparent), its
 * dialogs are dark, and renaming from a page or collection `…` menu keeps the field open. Renames
 * are checked in `.bildr/` too.
 *
 * Dropped:
 * - the projects page (search, New project dialog, its starting-device control): no project list;
 * - Settings › Variables (add variable field) and the Danger zone dialog (delete project): the module
 *   has one project and no stored variables (Settings shows the name and a read-only env status);
 * - the connection-modal's "Import from URL" mapping table and the published app's chrome check:
 *   the import dialog is the connection's collection dialog (checked below), and there is no publish.
 */
import { action, bildr, check, newPage, openData, openEditor, run, shot, toView, until } from './lib.mjs'

/** Height and background of a field (the control itself, or the one inside the matched element). */
function look(locator) {
  return locator.first().evaluate((el) => {
    const field = el.matches('input, textarea, button') ? el : el.querySelector('input, textarea, button') ?? el
    const style = getComputedStyle(field)
    return { height: style.height, bg: style.backgroundColor }
  })
}

const transparent = bg => bg === 'transparent' || /^rgba\(\d+, \d+, \d+, 0\)$/.test(bg)
const white = bg => bg === 'rgb(255, 255, 255)'

async function soft(locator, screen) {
  await locator.first().waitFor()
  const { height, bg } = await look(locator)
  return check(height === '30px' && !transparent(bg) && !white(bg), `${screen}: a 30px soft field (${height}, ${bg})`)
}

/** The average RGB of the open dialog's background: the kit's dialogs are dark on any page. */
async function darkDialog(page, screen) {
  const dialog = page.getByRole('dialog').last()
  await dialog.waitFor()
  const luminance = await dialog.evaluate((el) => {
    const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number)
    return (r + g + b) / 3
  })
  return check(luminance < 80, `${screen}: the dialog is dark (luminance ${luminance})`)
}

/** Opens a row's `…` menu, picks Rename, and checks the field is still open and focused a moment later. */
async function renameStaysOpen(page, row, menuLabel, fieldLabel, screen) {
  await row.hover()
  await row.getByLabel(menuLabel).click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Rename' }).click()
  const field = page.getByLabel(fieldLabel)
  await field.waitFor()
  await page.waitForTimeout(500) // the bug: the closing menu took the focus back and the blur closed the field
  const open = await field.isVisible() && await field.evaluate(el => el === document.activeElement)
  check(open, `${screen}: Rename from the … menu stays open and focused`)
  await field.press('Escape')
}

await run('kit', async ({ page, errors }) => {
  const about = await newPage('kit-about')

  // The Design view's theme editor, then the canvas view: the page rename, ⌘K and the shortcuts sheet.
  await openEditor(page, about.pageId)
  await toView(page, 'Design')
  await soft(page.locator('[data-theme-color="primary"]'), 'theme editor')
  await toView(page, 'Canvas')

  await page.getByRole('tab', { name: 'Pages' }).click()
  await renameStaysOpen(page, page.locator(`[data-page-id="${about.pageId}"]`), 'Page actions', 'Rename page', 'pages')
  check(bildr(about.filePath)?.name === about.name, 'cancelling the rename leaves the page file as it was')

  await page.locator('body').press('Control+k')
  await page.locator('[data-quick-actions]').waitFor()
  await darkDialog(page, '⌘K')
  await page.locator('[data-quick-actions] input').fill('Keyboard shortcuts')
  await page.locator('[data-quick-actions] [role=option][data-highlighted]').filter({ hasText: 'Keyboard shortcuts' }).waitFor()
  await page.locator('[data-quick-actions] input').press('Enter')
  await page.locator('[data-shortcuts-sheet]').waitFor()
  await darkDialog(page, 'shortcuts sheet')
  await page.keyboard.press('Escape')
  await page.locator('[data-shortcuts-sheet]').waitFor({ state: 'detached' })

  // The Data screen: inline add, collection rename, the filter menu, the connection's collection dialog.
  await openData(page)
  await page.getByLabel('Add collection').click()
  await soft(page.getByLabel('New collection name'), 'new collection (inline add)')
  await page.getByLabel('New collection name').press('Escape')
  await renameStaysOpen(page, page.locator('[data-collection="posts"]').locator('..'), 'Collection actions', 'Rename collection', 'collections')

  await page.locator('[data-collection="posts"]').click()
  await page.locator('[data-records-filter]').click()
  await soft(page.locator('[data-filter-value]'), 'table filter menu')
  await page.keyboard.press('Escape')

  await page.getByLabel('Add a collection to quotes').click()
  await darkDialog(page, 'connection modal')
  await soft(page.locator('[data-connection-source] [data-endpoint-path="list"]'), 'connection modal')
  await shot(page, 'kit-import')
  await page.keyboard.press('Escape')
  await page.locator('[data-connection-source]').waitFor({ state: 'detached' })

  // Settings: general.
  await openEditor(page, about.pageId)
  await toView(page, 'Settings')
  await soft(page.locator('[data-settings-name]'), 'Settings')
  const name = page.locator('[data-settings-name]')
  const before = await name.inputValue()
  await name.fill(`${before} kit`)
  await name.press('Enter')
  check(await until(() => bildr('bildr.json')?.name === `${before} kit`), 'Settings renames the project in .bildr/bildr.json')
  await name.fill(before)
  await name.press('Enter')
  check(await until(() => bildr('bildr.json')?.name === before), 'and renames it back')
  await action('page_delete', { page: about.pageId })

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
