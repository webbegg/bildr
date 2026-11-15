/**
 * The module editor's shell (port of e2e/shell.mjs): the editor opens dark on a page, add a
 * page, insert a Text with ⌘K and the Insert panel, edit its text, the inspector header, undo
 * and the device switch (⌥2 and the frame labels). Every edit is checked in the page's
 * `.bildr` file on disk.
 *
 * Dropped (the feature doc lists them as gone with the hosted multi-project app):
 * - the projects page (dark chrome, search, New project, open a card, delete from a card menu):
 *   one project per editor, there is no project list;
 * - Publish and `project_published_info`: the app is the project's own `nuxt dev`/build.
 */
import { action, appShows, bildr, canvas, check, findNode, findNodes, newPage, openEditor, run, seedFrames, shot, until } from './lib.mjs'

const texts = doc => findNodes(doc.root, node => node.type === 'Text')

await run('shell', async ({ page, browser, errors }) => {
  const p = await newPage('shell')
  // The device switch needs Desktop and Tablet next to Mobile (a project opens with its Primary only).
  await seedFrames(page)

  await openEditor(page, p.pageId)
  const dark = await page.evaluate(() => {
    const bg = getComputedStyle(document.body.firstElementChild ?? document.body).backgroundColor
    const [r, g, b] = (bg.match(/\d+/g) ?? [255, 255, 255]).map(Number)
    return { editorClass: document.documentElement.classList.contains('bildr-editor'), luminance: (r + g + b) / 3 }
  })
  check(dark.editorClass, `the editor shell is the dark chrome (bildr-editor ${dark.editorClass})`)
  check(await page.locator('[data-project-name]').innerText() === 'Blog', 'the toolbar shows the project name')

  await page.locator('[aria-label="Add page"]:visible').first().click()
  await page.getByLabel('New page name').fill('About')
  await page.getByLabel('New page name').press('Enter')
  const about = await until(() => bildr('modules/blog/pages/about.json'))
  check(about?.id === 'pg_about' && about.path === '/about', `Add page creates the "About" page file (${about?.id} ${about?.path})`)
  await canvas(page).locator('[data-node]').first().waitFor({ state: 'attached' })

  await page.locator('body').press('Control+k')
  const palette = page.locator('[data-quick-actions]')
  await palette.waitFor()
  await palette.locator('input').fill('Text')
  // Enter runs the highlighted command, so wait until the search has highlighted Text.
  await palette.locator('[role=option][data-highlighted]').filter({ hasText: /^\s*Text\b/ }).waitFor()
  await palette.locator('input').press('Enter')
  await palette.waitFor({ state: 'detached' })
  let doc = await until(() => {
    const d = bildr('modules/blog/pages/about.json')
    return texts(d).length === 1 && d
  })
  check(doc, '⌘K inserts a Text (in the page file)')

  await page.locator('[data-insert-button]').click()
  await page.locator('[data-palette-type="Text"]').click()
  doc = await until(() => {
    const d = bildr('modules/blog/pages/about.json')
    return texts(d).length === 2 && d
  })
  check(doc, 'the Insert panel inserts a second Text')

  const text = texts(doc).at(-1)
  const head = page.locator('[data-inspector-head] p').first()
  await until(async () => (await head.textContent())?.includes(text.id))
  const headText = (await head.textContent()).replace(/\s+/g, ' ').trim()
  check(headText === `Text ${text.id}`, `the inspector header reads "Text ${text.id}" (got "${headText}")`)

  const field = page.getByLabel('Text', { exact: true })
  await field.fill('Hello from e2e')
  await field.blur()
  const shown = await until(() => canvas(page).locator(`[data-node="${text.id}"]`).filter({ hasText: 'Hello from e2e' }).count())
  doc = bildr('modules/blog/pages/about.json')
  check(shown && texts(doc).at(-1).props.text === 'Hello from e2e', 'editing Text updates the .bildr page file and the canvas')

  // The running app next to the editor shows the page (V2): it regenerates from the file.
  const live = await appShows(browser, '/about', 'Hello from e2e')
  check(live.html.includes('Hello from e2e'), 'the running app renders the edited text at /about')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  const undone = await until(() => {
    const node = findNode(bildr('modules/blog/pages/about.json').root, n => n.id === text.id)
    return node && node.props?.text !== 'Hello from e2e'
  })
  check(undone, 'Undo reverts the text edit in the file')

  // Device switch: ⌥2 from the editor, then the frames' labels (the floating bar has no device buttons).
  const activeFrame = () => page.locator('iframe[title="Canvas"]').getAttribute('data-device')
  await page.locator('[data-view-menu]').focus()
  await page.keyboard.press('Alt+Digit2')
  const tabletByKey = await until(async () => (await activeFrame()) === 'tablet')
  check(tabletByKey, `⌥2 switches to Tablet (Canvas frame: ${await activeFrame()})`)
  check(await page.locator('[data-floating-bar] [data-device-switch]').count() === 0, 'the floating bar has no device buttons')
  await page.locator('[data-frame="desktop"] [data-frame-label]').click()
  await until(async () => (await activeFrame()) === 'desktop')
  await page.locator('[data-frame="tablet"] [data-frame-label]').click()
  const tabletByLabel = await until(async () => (await activeFrame()) === 'tablet')
  check(tabletByLabel, 'the Tablet frame label switches the edited frame back to Tablet')
  await shot(page, 'shell-editor')

  check(await action('page_delete', { page: about.id }).then(() => true, () => false), 'the script\'s page is deleted again')
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
