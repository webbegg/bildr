/**
 * The editor widget kit (S33), one check per migrated screen: its fields are
 * the kit's 30px soft field (a computed background, neither white nor
 * transparent), its dialogs are dark, renaming from a page or collection `…`
 * menu keeps the field open, and the published app has no `bildr-editor`
 * chrome.
 */
import { action, BASE, check, openEditor, project, run, shot, toView, until } from './lib.mjs'

const API = 'https://jsonplaceholder.typicode.com'

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

await run('kit', async ({ page, context, errors }) => {
  const p = await project('kit')
  await action('page_add', { projectId: p.id, name: 'About' })
  await action('collection_create', { projectId: p.id, name: 'Menu', fields: [{ key: 'name', type: 'text' }] })
  await action('record_create', { projectId: p.id, collection: 'menu', values: { name: 'Latte' } })
  await action('connection_create', { projectId: p.id, name: 'Placeholder', baseUrl: API })

  // The projects page.
  await page.goto(`${BASE}/`)
  await soft(page.locator('[data-projects-search]'), 'projects search')
  await page.locator('[data-new-project]').click()
  await darkDialog(page, 'New project')
  await soft(page.getByLabel('Project name'), 'New project')
  // The starting device is a segmented control: the soft field is its track, not the buttons in it.
  const track = await page.locator('[data-new-project-base]').evaluate(el => ({ height: getComputedStyle(el).height, bg: getComputedStyle(el).backgroundColor }))
  check(track.height === '30px' && !transparent(track.bg) && !white(track.bg), `New project starting device: a 30px soft track (${track.height}, ${track.bg})`)
  await page.keyboard.press('Escape')

  // The Design view's theme editor, then the canvas view: the page rename, ⌘K and the shortcuts sheet.
  await openEditor(page, p.id)
  await toView(page, 'Design')
  await soft(page.locator('[data-theme-color="primary"]'), 'theme editor')
  await toView(page, 'Canvas')

  await page.getByRole('tab', { name: 'Pages' }).click()
  const about = (await action('project_get', { projectId: p.id })).pages[1]
  await renameStaysOpen(page, page.locator(`[data-page-id="${about.id}"]`), 'Page actions', 'Rename page', 'pages')

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

  // The Data view: inline add, collection rename, the filter menu, the connection and import modals.
  await toView(page, 'Data')
  await page.getByLabel('Add collection').click()
  await soft(page.getByLabel('New collection name'), 'new collection (inline add)')
  await page.getByLabel('New collection name').press('Escape')
  await renameStaysOpen(page, page.locator('[data-collection="menu"]').locator('..'), 'Collection actions', 'Rename collection', 'collections')

  await page.locator('[data-collection="menu"]').click()
  await page.locator('[data-records-filter]').click()
  await soft(page.locator('[data-filter-value]'), 'table filter menu')
  await page.keyboard.press('Escape')

  await page.getByLabel('Add a collection to Placeholder').click()
  await darkDialog(page, 'connection modal')
  await soft(page.locator('[data-connection-source] [data-endpoint-path="list"]'), 'connection modal')
  await page.keyboard.press('Escape')
  await page.locator('[data-connection-source]').waitFor({ state: 'detached' })

  await page.getByLabel('Add synced data').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Import from URL' }).click()
  await darkDialog(page, 'import modal')
  await soft(page.locator('[data-api-url]'), 'import modal')
  await page.locator('[data-api-url]').fill(`${API}/posts`)
  await page.locator('[data-api-fetch]').click()
  await page.locator('[data-mapping-row]').first().waitFor({ timeout: 20_000 })
  await soft(page.locator('[data-mapping-row] input[aria-label^="Key of"]'), 'mapping table')
  await shot(page, 'kit-import')
  await page.keyboard.press('Escape')

  // Settings: general, variables, the danger zone.
  await toView(page, 'Settings')
  await soft(page.locator('[data-settings-name]'), 'Settings')
  await page.locator('[data-env-add]').click()
  await soft(page.locator('[data-env-new-name]'), 'Variables')
  await page.locator('[data-delete-project]').click()
  await darkDialog(page, 'Danger zone')
  await soft(page.locator('[data-delete-project-slug]'), 'Danger zone')
  await shot(page, 'kit-danger')
  await page.keyboard.press('Escape')

  // The published app keeps the runtime's look.
  await action('project_publish', { projectId: p.id })
  const live = await context.newPage()
  await live.goto(`${BASE}/p/${p.slug}`)
  await live.locator('[data-bildr-id]').first().waitFor()
  const chrome = await until(() => live.evaluate(() => document.readyState === 'complete' && !document.documentElement.classList.contains('bildr-editor')))
  check(chrome, 'the published app has no bildr-editor class')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
