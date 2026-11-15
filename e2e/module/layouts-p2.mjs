/**
 * Components and layouts P2 on the module editor (port of e2e/layouts-p2.mjs, S3.1–S3.3): "Create layout
 * from selection" from the node menu (the name-first dialog; the selection becomes the layout around a
 * children slot and the page gets it, in one undo step); the children slot's placeholder in the layout
 * view and its inspector explanation; ⌘K New layout, Edit layout <name> and Set page layout ›; the Pages
 * layout badge; page counts in the page's layout picker; the Insert panel's component and layout tiles
 * with cached thumbnails (searchable, draggable, re-rendered on change); and agent navigation
 * (`editor_navigate` to a component, a variant or a layout, reported by `editor_context_get`). Edits are
 * checked in the page, layout and component files. Shots go to e2e/module/.shots/components-p2/.
 */
import { action, bildr, call, canvas, check, findNode, lastStep, openEditor, run, scene, shot, until } from './lib.mjs'

const snap = async (page, name) => {
  await page.waitForTimeout(350)
  await shot(page, `components-p2/${name}`)
}

await run('layouts-p2', async ({ page }) => {
  const home = await scene('layouts-p2')
  const nav = await home.ins({ type: 'Row', children: [{ type: 'Text', props: { text: 'Logo' } }] })
  await action('node_rename', { file: home.file, nodeId: nav, name: 'Nav' })
  await home.ins({ type: 'Heading', props: { text: 'Welcome home' } })
  const footer = await home.ins({ type: 'Container', children: [{ type: 'Text', props: { text: '© Footer' } }] })
  const about = await scene('layouts-p2-about')
  const card = await about.ins({ type: 'Card', children: [{ type: 'Heading', props: { text: 'Latte' } }] })
  const made = await action('component_create', { file: about.file, nodeId: card, name: 'Coffee card' })
  const componentId = made.componentId
  const { variantId } = await action('component_variant_add', { component: componentId, name: 'Hover' })

  await openEditor(page, home.file)
  const row = id => page.locator(`[data-layer-id="${id}"]`).first()
  const crumbs = () => page.locator('[data-breadcrumb] [data-crumb]').evaluateAll(els => els.map(el => el.textContent.trim()))
  const dialog = page.locator('[data-create-dialog]')
  const nameField = page.locator('[data-create-name]')
  const palette = page.locator('[data-quick-actions]')
  const quick = async (text, label = text) => {
    await page.locator('body').press('Control+k')
    await palette.waitFor()
    await palette.locator('input').fill(text)
    await palette.locator('[role=option][data-highlighted]').filter({ hasText: label }).waitFor()
    await palette.locator('input').press('Enter')
    await palette.waitFor({ state: 'detached' })
  }

  // Create layout from selection: the nav and the footer become the layout; the heading stays on the page.
  await page.getByRole('tab', { name: 'Layers' }).click()
  await row(nav).click()
  await row(footer).click({ modifiers: ['Shift'] })
  await until(async () => await row(footer).getAttribute('aria-selected') === 'true')
  await row(nav).click({ button: 'right' })
  await page.locator('[data-node-menu-search]').waitFor()
  const fromSelection = page.locator('[role=menu] [role^=menuitem]').filter({ hasText: 'Create layout from selection' })
  check(await fromSelection.getAttribute('data-disabled') === null, 'the node menu offers "Create layout from selection…" for top-level page layers')
  await fromSelection.click()
  await dialog.waitFor()
  check(await dialog.getAttribute('data-create-dialog') === 'layout', 'it opens the "New layout" dialog')
  check((await page.getByRole('dialog').innerText()).includes('The selected layers become the layout'), 'the dialog explains what happens to the selection')
  check(await until(async () => (await nameField.inputValue()) === 'Layout'), `the name is pre-filled "Layout" (${await nameField.inputValue()})`)
  await nameField.fill('Site layout')
  await nameField.press('Enter')
  const layout = await until(() => bildr('layouts/site-layout.json'), 10_000)
  check(!!layout, 'Create writes .bildr/layouts/site-layout.json from the selection')
  if (!layout) throw new Error('no layout was created')
  const homeDoc = home.doc()
  check(homeDoc.layout === layout.id, `the page gets the new layout (${homeDoc.layout})`)
  check(homeDoc.root.children.map(c => c.type).join(',') === 'Heading', `the page keeps its other content (${homeDoc.root.children.map(c => c.type).join(',')})`)
  check(layout.root.children.map(c => c.type).join(',') === 'Row,Container,Container', `the layout is nav, slot, footer (${layout.root.children.map(c => c.type).join(',')})`)
  check(await lastStep() === 'layout_create_from_selection', `it is one undo step (${await lastStep()})`)
  await page.locator('[data-layout-view]').waitFor()
  check(JSON.stringify(await crumbs()) === JSON.stringify([home.name, 'site-layout']) || (await crumbs()).at(-1)?.toLowerCase().includes('site'), `the new layout opens on top of the page (${(await crumbs()).join(' › ')})`)

  // The children slot's placeholder, and its explanation in the inspector.
  const placeholder = page.locator('[data-layout-placeholder]').first()
  check(!!await until(() => placeholder.isVisible()), 'the layout view draws the children slot placeholder')
  check((await placeholder.innerText()).includes('Page content — your page appears here'), `the placeholder says what it is (${(await placeholder.innerText()).trim()})`)
  const purple = await placeholder.evaluate(el => getComputedStyle(el).backgroundColor)
  check(/^rgb|^color/.test(purple) && purple !== 'rgba(0, 0, 0, 0)', `the placeholder is light purple (${purple})`)
  await snap(page, 'layout-placeholder')
  const slotNodeId = layout.slots.find(s => s.id === 'children').nodeId
  await page.getByRole('tab', { name: 'Layers' }).click()
  await row(slotNodeId).click()
  const explanation = page.locator('[data-layout-page-content]')
  check(!!await until(() => explanation.isVisible()), 'selecting the slot explains it in the inspector')
  check((await explanation.innerText()).includes('Each page using this layout shows its own content here'), 'the explanation says pages show their own content there')
  await snap(page, 'layout-placeholder-selected')
  await page.locator('[data-breadcrumb-done]').click()
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })

  // ⌘K: Set page layout › on About, then Edit layout <name>, then New layout.
  await page.getByRole('tab', { name: 'Pages' }).click()
  await page.locator(`[data-page-id="${about.pageId}"]`).first().click({ position: { x: 40, y: 10 } })
  // (the search narrows to the layout, so Enter runs that one: the first match is "None")
  await quick('Set page layout site', /Set page layout › .*site/i)
  check(!!await until(() => about.doc().layout === layout.id), '⌘K "Set page layout › site-layout" sets the page layout in the page file')
  await quick('Edit layout site', /Edit layout .*site/i)
  check(!!await until(async () => (await crumbs()).at(-1)?.includes('site-layout')), `⌘K "Edit layout site-layout" opens it (${(await crumbs()).join(' › ')})`)
  await page.locator('[data-breadcrumb-done]').click()
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })
  await quick('New layout')
  await dialog.waitFor()
  check(await dialog.getAttribute('data-create-dialog') === 'layout', '⌘K "New layout" opens the "New layout" dialog')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })

  // The Pages badge on both pages, and the picker's page counts.
  const badges = page.locator(`[data-page-layout-badge="${layout.id}"]`)
  check(!!await until(async () => await badges.count() === 2), `pages using the layout show a badge (${await badges.count()})`)
  check((await badges.first().innerText()).trim().toLowerCase().includes('site'), `the badge names the layout (${(await badges.first().innerText()).trim()})`)
  await snap(page, 'pages-badge')
  // The page settings (the root selected) hold the layout picker.
  await page.getByRole('tab', { name: 'Layers' }).click()
  await row(about.nodeId).click()
  await page.locator('[data-page-layout] button').first().click()
  const option = page.getByRole('option').filter({ hasText: 'site-layout' })
  await option.waitFor()
  check((await option.innerText()).includes('2 pages'), `the layout picker counts the pages (${(await option.innerText()).replace(/\s+/g, ' ')})`)
  await page.keyboard.press('Escape')

  // Insert: component and layout tiles with thumbnails, searchable; the thumbnails are cached and re-render on change.
  await page.locator('[data-insert-button]').click()
  const componentTile = page.locator(`[data-palette-component="${componentId}"]`)
  const layoutTile = page.locator(`[data-palette-layout="${layout.id}"]`)
  await componentTile.waitFor()
  check(await layoutTile.count() === 1, 'the Insert panel shows the layout as a tile')
  check(await componentTile.getAttribute('draggable') === 'true' && await layoutTile.getAttribute('draggable') === 'true', 'the tiles are draggable')
  const thumbHtml = tile => tile.locator('[data-insert-thumb="ready"] iframe').getAttribute('srcdoc').catch(() => '')
  check(!!await until(async () => (await thumbHtml(componentTile))?.includes('Latte'), 20_000), 'the component tile shows a render of the definition')
  check(!!await until(async () => (await thumbHtml(layoutTile))?.length > 0, 20_000), `the layout tile shows a render of the layout (${await layoutTile.locator('[data-insert-thumb]').getAttribute('data-insert-thumb')})`)
  check(await page.locator('[data-palette-type="Text"]').count() === 1, 'built-ins keep their icon rows')
  await snap(page, 'insert-tiles')
  await page.locator('[data-insert-panel] input').fill('coffee')
  check(!!await until(async () => await componentTile.count() === 1 && await layoutTile.count() === 0), 'the search filters the tiles')
  await page.keyboard.press('Escape')
  await page.locator('[data-insert-panel]').waitFor({ state: 'detached' })
  await page.locator('[data-insert-button]').click()
  await componentTile.waitFor()
  check(await componentTile.locator('[data-insert-thumb="ready"]').count() === 1, 'a reopened panel shows the cached thumbnail at once')
  const def = bildr(made.filePath)
  const heading = findNode(def.root, n => n.type === 'Heading')
  await action('node_update_props', { file: componentId, nodeId: heading.id, props: { text: 'Mocha' } })
  check(!!await until(async () => (await thumbHtml(componentTile))?.includes('Mocha'), 20_000), 'a change to the definition renders the thumbnail again')
  await page.keyboard.press('Escape')

  // Agent navigation: a component, one of its variants, and a layout.
  await action('editor_navigate', { file: componentId })
  check(!!await until(async () => (await crumbs()).at(-1) === 'CoffeeCard'), `editor_navigate { file: component } opens the component (${(await crumbs()).join(' › ')})`)
  await action('editor_navigate', { file: componentId, variant: variantId })
  const context = await until(async () => {
    const c = await action('editor_context_get')
    return c?.variant === variantId && c
  })
  check(!!context, `editor_navigate { variant } shows that variant (the editor reports it: ${JSON.stringify(await action('editor_context_get'))})`)
  check(context?.name === 'CoffeeCard' && context?.kind === 'component', `editor_context_get reports the component and variant (${JSON.stringify({ name: context?.name, kind: context?.kind, variant: context?.variant })})`)
  await action('editor_navigate', { file: layout.id })
  check(!!await until(async () => (await crumbs()).at(-1)?.includes('site-layout')), 'editor_navigate { file: layout } opens the layout')
  const layoutContext = await until(async () => {
    const c = await action('editor_context_get')
    return c?.file === layout.id && c
  })
  check(!!layoutContext && layoutContext.kind === 'layout', 'editor_context_get reports the layout')
  await action('editor_navigate', { file: home.file })
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })
  check(!!await until(() => canvas(page).getByText('Welcome home').isVisible()), 'editor_navigate { file: page } goes back to the page')
  void call
})
