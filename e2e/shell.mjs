/**
 * The editor shell: the projects page (dark chrome, search, New project, open,
 * delete from a card's menu with the typed slug), then the editor: add a page,
 * insert a Text with ⌘K and the Insert panel, edit its text, the inspector
 * header, undo, the device switch (⌥2 and the Tablet button) and Publish.
 */
import { action, BASE, canvas, check, findNode, openEditor, project, run, shot, track, until } from './lib.mjs'

const texts = doc => doc.pages.flatMap((p) => {
  const found = []
  const walk = (node) => {
    if (node.type === 'Text') found.push(node)
    node.children?.forEach(walk)
  }
  walk(p.root)
  return found
})

await run('shell', async ({ page, errors }) => {
  const p = await project('shell')

  // Projects page.
  await page.goto(`${BASE}/`)
  await page.locator(`[data-project-card="${p.slug}"]`).waitFor()
  const dark = await page.evaluate(() => {
    const bg = getComputedStyle(document.querySelector('header').parentElement).backgroundColor
    const [r, g, b] = bg.match(/\d+/g).map(Number)
    return { editorClass: document.documentElement.classList.contains('bildr-editor'), luminance: (r + g + b) / 3 }
  })
  check(dark.editorClass && dark.luminance < 60, `projects page is dark (bildr-editor ${dark.editorClass}, luminance ${dark.luminance})`)

  await page.locator('[data-projects-search]').fill(p.name)
  const filtered = await until(async () => {
    const cards = await page.locator('[data-project-card]').evaluateAll(els => els.map(el => el.dataset.projectCard))
    return cards.length === 1 && cards[0] === p.slug && cards
  })
  check(filtered, 'search filters the cards to the matching project')

  await page.locator('[data-new-project]').click()
  const name = `e2e shell new ${Date.now()}`
  await page.getByLabel('Project name').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.waitForURL(/\/editor\/[\w-]+$/)
  const newId = page.url().split('/').pop()
  const created = await action('project_get', { projectId: newId })
  track(created.id, created.slug)
  check(created.name === name, 'New project creates the project and opens its editor')
  await page.locator('[data-view-menu]').waitFor()

  await page.goto(`${BASE}/`)
  const card = page.locator(`[data-project-card="${created.slug}"]`)
  await card.locator('[data-project-menu]').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Delete project…' }).click()
  const submit = page.locator('[data-delete-project-submit]')
  check(await submit.isDisabled(), 'the delete button waits for the typed slug')
  await page.locator('[data-delete-project-slug]').fill(created.slug)
  await submit.click()
  await card.waitFor({ state: 'detached' })
  const left = await action('project_list')
  check(!left.some(x => x.id === created.id), 'card menu delete removes the project')

  await page.getByRole('link', { name: `Open ${p.name}` }).click()
  await page.waitForURL(`${BASE}/editor/${p.id}`)
  await canvas(page).locator('[data-bildr-id]').first().waitFor()
  check(true, 'opening a card loads the editor and its canvas')

  // Editor.
  await openEditor(page, p.id)
  await page.locator('[aria-label="Add page"]:visible').first().click()
  await page.getByLabel('New page name').fill('About')
  await page.getByLabel('New page name').press('Enter')
  const withPage = await until(async () => {
    const doc = await action('project_get', { projectId: p.id })
    return doc.pages.some(x => x.name === 'About') && doc
  })
  check(withPage, 'Add page creates the "About" page')

  await page.locator('body').press('Control+k')
  const palette = page.locator('[data-quick-actions]')
  await palette.waitFor()
  await palette.locator('input').fill('Text')
  // Enter runs the highlighted command, so wait until the search has highlighted Text.
  await palette.locator('[role=option][data-highlighted]').filter({ hasText: /^\s*Text\b/ }).waitFor()
  await palette.locator('input').press('Enter')
  await palette.waitFor({ state: 'detached' })
  let doc = await until(async () => {
    const d = await action('project_get', { projectId: p.id })
    return texts(d).length === 1 && d
  })
  check(doc, '⌘K inserts a Text')

  await page.locator('[data-insert-button]').click()
  await page.locator('[data-palette-type="Text"]').click()
  doc = await until(async () => {
    const d = await action('project_get', { projectId: p.id })
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
  const shown = await until(() => canvas(page).locator(`[data-bildr-id="${text.id}"]`).filter({ hasText: 'Hello from e2e' }).count())
  doc = await action('project_get', { projectId: p.id })
  check(shown && texts(doc).at(-1).props.text === 'Hello from e2e', 'editing Text updates the document and the canvas')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  const undone = await until(async () => {
    const d = await action('project_get', { projectId: p.id })
    const node = d.pages.map(x => findNode(x.root, n => n.id === text.id)).find(Boolean)
    return node && node.props.text !== 'Hello from e2e'
  })
  check(undone, 'Undo reverts the text edit')

  // Device switch: ⌥2 from the editor, then the floating bar's buttons.
  await page.locator('[data-view-menu]').focus()
  await page.keyboard.press('Alt+Digit2')
  const tabletByKey = await until(async () => (await page.locator('[data-device-switch="tablet"]').getAttribute('aria-pressed')) === 'true')
  const frame = await page.locator('iframe[title="Canvas"]').getAttribute('data-device')
  check(tabletByKey && frame === 'tablet', `⌥2 switches to Tablet (Canvas frame: ${frame})`)
  await page.locator('[data-device-switch="desktop"]').click()
  await until(async () => (await page.locator('iframe[title="Canvas"]').getAttribute('data-device')) === 'desktop')
  await page.getByRole('button', { name: 'Tablet', exact: true }).click()
  const tabletByButton = await until(async () => (await page.locator('iframe[title="Canvas"]').getAttribute('data-device')) === 'tablet')
  check(tabletByButton, 'the Tablet button switches the edited frame back to Tablet')

  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const info = await until(() => action('project_published_info', { projectId: p.id }))
  check(info?.version >= 1, `Publish publishes the project (v${info?.version})`)
  await shot(page, 'shell-editor')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
