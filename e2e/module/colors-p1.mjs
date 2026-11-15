/**
 * Checks and a screenshot tour of the P1 colour and binding work on the module editor (port of
 * e2e/colors-p1.mjs): the binding dot's menu (#10) on a style row, Detach to raw value, a style
 * property created from the dot in the component view; the colour picker's Custom tab writing a raw
 * hex and "Create colour from this" (#12), with the custom colour listed in the Design view (removing
 * a used one is refused, and says so); and the Selection colours section swapping a colour across the
 * subtree (#13) as one undo step (RELIABILITY-009); in a component variant, a swap over two nodes is
 * one undo step and Paste style removes the primary's tokens the copy lacks (S8, RELIABILITY-002).
 * Every edit is checked in the page, component or theme file on disk. Shots go to
 * e2e/module/.shots/colors-p1/.
 */
import { action, app, bildr, check, lastStep, nodeIn, openEditor, run, scene, seedFrames, shot, toView, until } from './lib.mjs'

const snap = async (page, name) => {
  await page.waitForTimeout(300)
  await shot(page, `colors-p1/${name}`)
}

/** Create property opens the properties modal on the new property (S2.2); Done closes it. */
const closeProperties = async (page) => {
  await page.locator('[data-properties-modal]').waitFor()
  await page.locator('[data-properties-done]').click()
  await page.locator('[data-properties-modal]').waitFor({ state: 'detached' })
}

await run('colors-p1', async ({ context, page, errors }) => {
  // Paste style reads the system clipboard (a newer clip from another tab wins).
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base })
  const s = await scene('colors-p1')
  // The Tablet binding checks need its frame (a project opens with its Primary only).
  await seedFrames(page)
  const column = await s.ins({ type: 'Column', style: { bg: 'primary', borderColor: 'primary', border: '1' } })
  const title = await s.ins({ parentId: column, type: 'Text', props: { text: 'Title' }, style: { color: 'primary' } })
  const body = await s.ins({ parentId: column, type: 'Text', props: { text: 'Body' }, style: { color: 'muted' } })
  const card = await s.ins({ type: 'Column', style: { bg: 'muted' } })
  await s.ins({ parentId: card, type: 'Text', props: { text: 'Card' } })

  // "Create colour from this" asks for the colour's name.
  page.on('dialog', dialog => dialog.accept('Brand Orange'))
  await openEditor(page, s.file)
  await page.getByRole('tab', { name: 'Layers' }).click()
  const select = async (id) => {
    await page.locator(`[data-layer-id="${id}"]`).first().click()
    await page.locator('[data-inspector-head]').filter({ hasText: id }).waitFor()
    await page.waitForTimeout(400)
  }
  const fill = () => page.locator('[data-style-row="bg"]').first()

  // #10: the dot before the Fill label opens Pick token / Detach to raw value.
  await select(column)
  await fill().hover()
  await fill().locator('[data-binding-dot="bg"]').click()
  await page.locator('[role=menuitem]').filter({ hasText: 'Pick token' }).waitFor()
  check(await page.locator('[role=menuitem]').filter({ hasText: 'Detach to raw value' }).count() === 1, 'the Fill dot menu offers Pick token and Detach to raw value')
  check(await page.locator('[role=menuitem]').filter({ hasText: 'Create property' }).count() === 0, 'on a page the dot offers no property binding')
  await snap(page, 'dot-menu')
  await page.locator('[role=menuitem]').filter({ hasText: 'Detach to raw value' }).click()
  const detached = await until(() => /^#[0-9a-f]{6}$/.test(s.node(column)?.style?.bg) && s.node(column).style.bg)
  check(!!detached, `Detach to raw value writes the token's hex (${detached})`)

  // #12: the Custom tab writes a raw hex.
  await fill().locator('[data-style-key="bg"]').click()
  const picker = page.locator('[data-color-picker]')
  await picker.waitFor()
  check(await picker.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed') === 'true', 'a hex value opens the picker on the Custom tab')
  await picker.getByRole('button', { name: 'Tokens' }).click()
  await picker.getByRole('button', { name: 'primary-600' }).waitFor()
  await snap(page, 'picker-tokens')
  await picker.getByRole('button', { name: 'Custom' }).click()
  const hex = picker.getByLabel('Hex')
  await hex.fill('FF6600')
  await hex.press('Enter')
  check(await until(() => s.node(column)?.style?.bg === '#ff6600'), 'a hex typed in the Custom tab is written to the node')
  await snap(page, 'picker-custom')

  // #12: "Create colour from this" adds a theme colour and uses it by name.
  await picker.getByRole('button', { name: 'Create colour from this' }).click()
  const created = await until(() => bildr('theme.json').custom?.['brand-orange'] === '#ff6600' && s.node(column).style.bg === 'brand-orange')
  check(created, 'Create colour from this adds "brand-orange" to theme.json and binds the Fill to it')
  await page.keyboard.press('Escape')

  // #13: Selection colours lists the subtree's colours with counts; a swap reaches every key.
  await page.waitForTimeout(400)
  const colors = page.locator('[data-selection-colors]')
  await colors.waitFor()
  const listed = await colors.locator('[data-selection-color]').evaluateAll(els => els.map(el => `${el.getAttribute('data-selection-color')}×${el.querySelector('[data-selection-color-count]')?.textContent?.trim()}`))
  check(listed.join(' ') === 'primary×2 brand-orange×1 muted×1', `the section lists the subtree's colours with counts (${listed.join(' ')})`)
  await snap(page, 'selection-colors')
  await colors.locator('[data-selection-color="primary"] [data-style-key]').click()
  await page.locator('[data-color-picker]').getByRole('button', { name: 'secondary', exact: true }).click()
  const swapped = await until(() => s.node(column).style.borderColor === 'secondary' && s.node(title).style.color === 'secondary' && s.node(body).style.color === 'muted')
  check(swapped, 'swapping primary → secondary changes the border and the title, and leaves muted')
  // RELIABILITY-009: the swap is one undo step: one undo brings back primary on both keys.
  check(await lastStep() === 'node_update_style', `the swap is one undo step (${await lastStep()})`)
  await action('history_undo')
  check(await until(() => s.node(column).style.borderColor === 'primary' && s.node(title).style.color === 'primary'), 'one undo reverts the whole swap (border and title)')
  await action('history_redo')
  check(!!await until(() => s.node(column).style.borderColor === 'secondary'), 'redo applies the swap again')
  check(s.node(card).style.bg === 'muted', 'nodes outside the selection keep their colours')

  // #12: the Design view lists the custom colour; removing it while used is refused, with the reason.
  await toView(page, 'Design')
  const row = page.locator('[data-custom-color-row="brand-orange"]')
  await row.waitFor()
  check(await row.isVisible() && (await row.innerText()).toLowerCase().includes('brand-orange'), 'the Design view lists the custom colour')
  await row.hover()
  await row.locator('[data-row-remove]').click()
  const refused = await until(async () => (await page.locator('[role=alert], li[data-state]').filter({ hasText: 'still used' }).count()) > 0)
  check(refused, 'removing a used custom colour shows the refusal')
  check(bildr('theme.json').custom?.['brand-orange'] === '#ff6600', 'the used colour stays in theme.json')
  await snap(page, 'design-custom')
  await toView(page, 'Canvas')

  // #10: in the component view the dot creates a style property.
  const made = await action('component_create', { file: s.file, nodeId: card, name: 'Card' })
  await page.waitForTimeout(600)
  const componentFile = made.filePath
  const defRoot = bildr(componentFile).root
  await openEditor(page, s.file)
  await page.getByRole('tab', { name: 'Layers' }).click()
  await select(made.nodeId)
  await page.locator('[data-component-instance]').getByRole('button', { name: 'Edit' }).click()
  await page.locator('[data-component-view]').waitFor()
  await select(defRoot.id)
  await fill().hover()
  await fill().locator('[data-binding-dot="bg"]').click()
  await page.locator('[role=menuitem]').filter({ hasText: 'Create property' }).click()
  await closeProperties(page)
  const bound = await until(() => bildr(componentFile).properties.find(prop => prop.bindings.some(b => b.nodeId === defRoot.id && b.prop === 'bg' && b.target === 'style')))
  check(!!bound, `Create property adds a style-bound property (${bound?.name})`)
  const dot = fill().locator('[data-binding-dot="bg"]')
  check(await until(async () => (await dot.getAttribute('data-bound')) === bound?.name), 'the bound row\'s dot is filled and names the property')
  await snap(page, 'component-bound')

  // RELIABILITY-T8-001: a base binding is inherited at Tablet; the menu still binds md:direction, with no plain Unbind.
  const dirRow = () => page.locator('[data-style-row="direction"]').first()
  const dirDot = () => dirRow().locator('[data-binding-dot="direction"]')
  const bindsAt = key => bildr(componentFile).properties.find(prop => prop.bindings.some(b => b.nodeId === defRoot.id && b.prop === key && b.target === 'style'))
  await dirRow().hover()
  await dirDot().click()
  await page.locator('[role=menuitem]').filter({ hasText: 'Create property' }).click()
  await closeProperties(page)
  const baseDir = await until(() => bindsAt('direction'))
  check(!!baseDir, `Create property on Mobile binds the base key direction (${baseDir?.name})`)
  await page.locator('[data-frame="tablet"] [data-frame-label]').click()
  await until(async () => (await page.locator('iframe[title="Canvas"]').getAttribute('data-device')) === 'tablet')
  await page.waitForTimeout(400)
  check(await until(async () => (await dirDot().getAttribute('data-bound-inherited')) === 'true'), 'on Tablet the direction dot shows the base binding as inherited')
  await dirRow().hover()
  await dirDot().click()
  await page.locator('[role=menuitem]').filter({ hasText: 'Create property' }).waitFor()
  const menuTexts = await page.locator('[role=menuitem]').evaluateAll(els => els.map(el => el.textContent.trim()))
  check(menuTexts.some(t => t.startsWith('Create property')), `the inherited row's menu offers Create property (${menuTexts.join(' | ')})`)
  check(!menuTexts.includes('Unbind property'), 'the inherited row\'s menu offers no plain "Unbind property"')
  check(menuTexts.includes('Unbind property on all breakpoints'), 'the inherited unbind is labelled "Unbind property on all breakpoints"')
  await snap(page, 'inherited-menu')
  await page.locator('[role=menuitem]').filter({ hasText: 'Create property' }).click()
  await closeProperties(page)
  check(await until(() => !!(bindsAt('md:direction') && bindsAt('direction'))), 'Create property on Tablet adds an md:direction binding and keeps the base one')
  check(await until(async () => (await dirDot().getAttribute('data-bound-inherited')) === null), 'the Tablet row is then bound at its own key')

  // S8: in a variant, a colour swap over two nodes is one undo step, and Paste style removes primary tokens the copy lacks.
  const box = await s.ins({ type: 'Column', style: { bg: 'muted' }, children: [
    { type: 'Text', props: { text: 'Swatch one' }, style: { color: 'primary', p: '4' } },
    { type: 'Text', props: { text: 'Swatch two' }, style: { color: 'primary' } }
  ] })
  const swatchMade = await action('component_create', { file: s.file, nodeId: box, name: 'Swatch' })
  const swatchId = swatchMade.componentId
  const { variantId: flatId } = await action('component_variant_add', { component: swatchId, name: 'Flat' })
  const swatch = bildr(swatchMade.filePath)
  const [oneId, twoId] = swatch.root.children.map(c => c.id)
  const flat = () => bildr(swatchMade.filePath).variants.find(v => v.id === flatId)
  await openEditor(page, s.file)
  await page.getByRole('tab', { name: 'Layers' }).click()
  await select(swatchMade.nodeId)
  await page.locator('[data-component-instance]').getByRole('button', { name: 'Edit' }).click()
  await page.locator('[data-component-view]').waitFor()
  await select(swatch.root.id)
  await page.getByRole('button', { name: 'Show and edit Flat' }).click()
  await until(async () => (await page.getByRole('button', { name: 'Show and edit Flat' }).getAttribute('aria-pressed')) === 'true')
  await page.waitForTimeout(400)

  const variantColors = page.locator('[data-selection-colors]')
  await variantColors.locator('[data-selection-color="primary"] [data-style-key]').click()
  await page.locator('[data-color-picker]').getByRole('button', { name: 'secondary', exact: true }).click()
  const variantSwapped = await until(() => flat().overrides?.[oneId]?.style?.color === 'secondary' && flat().overrides?.[twoId]?.style?.color === 'secondary')
  check(variantSwapped, 'a colour swap in the variant overrides both texts')
  await page.keyboard.press('Escape')
  check(await lastStep() === 'component_variant_set_override', `the variant swap is one undo step (${await lastStep()})`)
  await action('history_undo')
  check(!!await until(() => Object.keys(flat().overrides ?? {}).length === 0), 'one undo reverts the variant swap on both texts')

  // Copy Swatch two (color only) and Paste style onto Swatch one: its primary p is removed in the variant.
  await page.waitForTimeout(400)
  await select(twoId)
  await page.keyboard.press('Control+c')
  await page.locator(`[data-layer-id="${oneId}"]`).first().click({ button: 'right' })
  await page.locator('[data-node-menu-search]').waitFor()
  await page.keyboard.type('paste style')
  await page.keyboard.press('Enter')
  const removedP = await until(() => JSON.stringify(flat().overrides?.[oneId]) === JSON.stringify({ unset: ['p'] }))
  check(removedP, `Paste style in the variant removes the primary's p (${JSON.stringify(flat().overrides)})`)
  check(nodeIn(swatchMade.filePath, oneId).style.p === '4', 'the primary keeps its p')
  check(await until(async () => (await page.locator('[data-override="style:p"]').count()) === 1), 'the overrides section lists the removed p')
  check((await page.locator('[data-override="style:p"][data-override-removed]').innerText()).includes('Removed'), 'and shows it as Removed')
  await page.locator('[data-variant-overrides]').scrollIntoViewIfNeeded()
  await snap(page, 'variant-removed')
  check(await lastStep() === 'component_variant_set_override', `the variant paste style is one undo step (${await lastStep()})`)
  await action('history_undo')
  check(!!await until(() => Object.keys(flat().overrides ?? {}).length === 0), 'one undo brings the primary p back')

  check(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/422 \(/, /status of 422/] })
