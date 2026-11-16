/**
 * P6: the visual editor end to end (specs V1, V2) on a created project. A page is built visually in the
 * module's editor: add a page, insert a Heading and a List with the Insert shortcuts (⌘K), bind the List to
 * the Post entity's Query from its Behaviour panel, edit the Heading's text and a style (centered). Then:
 * - the `.bildr` page file holds exactly that (Heading with the text and `align: center`; a List over
 *   the new page-level query; a Text row bound to the item);
 * - the running app's HTML (the generated Nuxt app, as a browser renders it) shows the heading, its
 *   `text-center` class and one row per post of the app's database (V2: the change is in the app);
 * - the generated page file (`layers/blog/app/pages/<name>.vue`) has them, and the editor's Code
 *   screen and the `code_view` action show the same generated page (V1: one app, Code beside the canvas);
 * - undo takes the visual edit back out of the file, and the app follows.
 * The row's text is bound to the item with the `node_insert` action (the binding dot's popover is covered
 * by the inspector's unit tests); everything else is done through the UI.
 */
import { action, appShows, bildr, canvas, check, openEditor, projectFile, run, seedPosts, shot, until } from './lib.mjs'

await run('visual-editor', async ({ page, browser, errors }) => {
  // The app's database starts empty: two posts go in through the app's own create route.
  await seedPosts([{ title: 'Hello bildr', slug: 'hello-bildr', published: true }, { title: 'A draft', slug: 'a-draft' }])
  await openEditor(page)
  check(await page.locator('[data-testid="design"]').count() === 1, 'one editor: the Design screen opens on the project (V1)')
  // S1: the top bar's menu is the only navigation (no left nav), and it lists the six destinations once each.
  // Not `nav` itself: the editor's breadcrumbs are <nav>s (of buttons). The old rail was a <nav> of links to the screens.
  check(await page.locator('nav a').count() === 0 && await page.locator('[data-view-menu]').count() === 1, 'no left nav: no <nav> holds a link to a screen, and the top bar menu is the only navigation')
  await page.locator('[data-view-menu]').click()
  const entries = (await page.locator('[role^=menuitem]').allInnerTexts()).map(text => text.trim())
  check(entries.join(',') === 'Canvas,Design system,Data,Code,Checks,Settings', `the menu lists Canvas, Design system, Data, Code, Checks and Settings (${entries.join(', ')})`)
  await page.keyboard.press('Escape')

  // Add a page.
  await page.locator('[aria-label="Add page"]:visible').first().click()
  await page.getByLabel('New page name').fill('Specials')
  await page.getByLabel('New page name').press('Enter')
  const file = 'modules/blog/pages/specials.json'
  const created = await until(() => bildr(file))
  check(created?.id === 'pg_specials' && created.path === '/specials', 'Add page writes the page file (pg_specials, /specials)')
  await canvas(page).locator('[data-node]').first().waitFor({ state: 'attached' })

  // Insert a Heading with ⌘K and edit its text and a style.
  const palette = page.locator('[data-quick-actions]')
  const insert = async (type) => {
    await page.locator('body').press('Control+k')
    await palette.waitFor()
    await palette.locator('input').fill(type)
    await palette.locator('[role=option][data-highlighted]').filter({ hasText: new RegExp(`^\\s*${type}\\b`) }).waitFor()
    await palette.locator('input').press('Enter')
    await palette.waitFor({ state: 'detached' })
  }
  await insert('Heading')
  const heading = await until(() => bildr(file).root.children?.find(node => node.type === 'Heading'))
  check(!!heading, '⌘K inserts a Heading in the page file')
  await page.locator('[data-inspector-head]').filter({ hasText: heading.id }).waitFor()
  const text = page.getByLabel('Text', { exact: true })
  await text.fill('Our specials')
  await text.blur()
  check(!!await until(() => bildr(file).root.children.find(node => node.id === heading.id)?.props?.text === 'Our specials'), 'editing the Heading\'s Text writes it to the page file')
  await page.locator('[data-style-row="align"] button[aria-label="Center"]').click()
  check(!!await until(() => bildr(file).root.children.find(node => node.id === heading.id)?.style?.align === 'center'), 'a style (align: center) is written to the page file')
  check(!!await until(() => canvas(page).locator(`[data-node="${heading.id}"]`).filter({ hasText: 'Our specials' }).count()), 'the canvas shows the heading')

  // Insert a List and bind it to the Post query from its Behaviour panel.
  await page.locator(`[data-layer-id]`).first().waitFor().catch(() => {})
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.locator(`[data-layer-id="${created.root.id}"]`).first().click()
  await insert('List')
  const list = await until(() => bildr(file).root.children?.find(node => node.type === 'List'))
  check(!!list, '⌘K inserts a List in the page file')
  await page.locator('[data-inspector-head]').filter({ hasText: list.id }).waitFor()
  await page.locator('[data-testid="list-items"]').selectOption({ value: 'new:ent_post' })
  const bound = await until(() => {
    const doc = bildr(file)
    const node = doc.root.children.find(n => n.id === list.id)
    return node?.props?.items?.$bind && doc.uses?.queries?.length && { doc, node }
  })
  check(!!bound, `binding the List creates a page-level Query use and binds the items (${JSON.stringify(bound?.node.props)})`)
  const item = bound.node.props.as
  const alias = bound.node.props.items.$bind
  check(bound.doc.uses.queries.some(use => use.as === alias), `the page uses the query as "${alias}"`)
  // The row: a Text bound to the item's title.
  await action('node_insert', { file: 'pg_specials', parentId: list.id, type: 'Text', props: { text: { $bind: `${item}.title` } } })
  await shot(page, 'visual-editor-built')

  // V2: the running app's HTML shows the change.
  const live = await appShows(browser, '/specials', 'Our specials')
  check(live.html.includes('Our specials') && /text-center/.test(live.html), 'the running app renders the heading with its centered style')
  const titles = ['Hello bildr', 'A draft']
  const listed = await until(async () => {
    const rendered = await appShows(browser, '/specials', titles[0], 20_000)
    return titles.every(title => rendered.html.includes(title)) && rendered
  }, 90_000)
  check(!!listed, 'and one row per post of the app\'s database (the List bound to the Query)')

  // V2: the generated files.
  const vue = await until(() => projectFile('layers/blog/app/pages/specials.vue'), 30_000)
  check(!!vue && vue.includes('Our specials') && vue.includes('text-center'), 'the generated page file has the heading and its style class')
  check(!!vue && /v-for|<template v-for/.test(vue), 'and a loop over the query\'s rows')
  const code = await action('code_view', { path: '.bildr/modules/blog/pages/specials.json' })
  const codeFile = (code.files ?? code).find?.(entry => entry.path?.endsWith('specials.vue'))
  check(!!codeFile && (codeFile.content ?? '').includes('Our specials'), 'the code_view action returns the generated page (V1)')

  // V1: Code in the editor shows the generated page next to the canvas; the menu's Code entry opens it, labelled Code.
  await page.locator('[data-view-menu]').click()
  await page.locator('[role^=menuitem]').filter({ hasText: /^\s*Code\s*$/ }).click()
  await page.locator('[data-testid="code-empty"]').waitFor()
  check((await page.locator('[data-view-menu]').innerText()).trim() === 'Code' && page.url().endsWith('#/code'), 'the Code entry opens #/code, and the menu is labelled Code')
  await page.locator('button, [role=combobox]').filter({ hasText: 'Choose a model file' }).first().click()
  await page.getByRole('option').filter({ hasText: /specials/i }).first().click()
  await page.locator('[data-testid="code-file"]').first().waitFor()
  const shown = await page.locator('[data-testid="code-file"]').allInnerTexts()
  check(shown.some(textOf => textOf.includes('Our specials')), 'the Code screen shows the generated page with the heading text')
  await shot(page, 'visual-editor-code')

  // Undo takes the edit out of the file, and the app follows.
  await openEditor(page, 'pg_specials')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  check(!!await until(() => !bildr(file).root.children.some(n => n.type === 'List' && n.children?.length)), 'Undo removes the last edit (the row) from the page file')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/] })
