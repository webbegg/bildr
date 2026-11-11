/**
 * Checks and a screenshot tour of the P1 colour and binding work (run by
 * all.mjs): the binding dot's menu (#10) on a style row, Detach to raw
 * value, a style property created from the dot in the component view; the
 * colour picker's Custom tab writing a raw hex and "Create colour from
 * this" (#12), with the custom colour listed in the Design view (removing
 * a used one is refused, and says so); and the Selection colours section
 * swapping a colour across the subtree (#13) as one undo step
 * (RELIABILITY-009); in a component variant, a swap over two nodes is one
 * undo step and Paste style removes the primary's tokens the copy lacks
 * (S8, RELIABILITY-002). Shots go to e2e/.shots/colors-p1/.
 */
import { action, BASE, check, findNode, openEditor, project, run, shot, toView, until } from './lib.mjs'

const snap = async (page, name) => {
  await page.waitForTimeout(300)
  await shot(page, `colors-p1/${name}`)
}

await run('colors-p1', async ({ context, page, errors }) => {
  // Paste style reads the system clipboard (a newer clip from another tab wins).
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  const p = await project('colors p1')
  const { pages } = await action('project_get', { projectId: p.id })
  const pageId = pages[0].id
  const column = await action('node_insert', { projectId: p.id, pageId, type: 'Column', style: { bg: 'primary', borderColor: 'primary', border: '1' } })
  const title = await action('node_insert', { projectId: p.id, pageId, parentId: column.nodeId, type: 'Text', props: { text: 'Title' }, style: { color: 'primary' } })
  const body = await action('node_insert', { projectId: p.id, pageId, parentId: column.nodeId, type: 'Text', props: { text: 'Body' }, style: { color: 'muted' } })
  const card = await action('node_insert', { projectId: p.id, pageId, type: 'Column', style: { bg: 'muted' } })
  await action('node_insert', { projectId: p.id, pageId, parentId: card.nodeId, type: 'Text', props: { text: 'Card' } })

  /** A node of the page as stored. */
  const stored = async (id) => {
    const doc = await action('project_get', { projectId: p.id })
    return { node: findNode(doc.pages[0].root, n => n.id === id), doc }
  }

  page.on('dialog', dialog => dialog.accept('Brand Orange'))
  await openEditor(page, p.id)
  await page.getByRole('tab', { name: 'Layers' }).click()
  const select = async (id) => {
    await page.locator(`[data-layer-id="${id}"]`).first().click()
    await page.locator('[data-inspector-head]').filter({ hasText: id }).waitFor()
    await page.waitForTimeout(400)
  }
  const fill = () => page.locator('[data-style-row="bg"]').first()

  // #10: the dot before the Fill label opens Pick token / Detach to raw value.
  await select(column.nodeId)
  await fill().hover()
  await fill().locator('[data-binding-dot="bg"]').click()
  await page.locator('[role=menuitem]').filter({ hasText: 'Pick token' }).waitFor()
  check(await page.locator('[role=menuitem]').filter({ hasText: 'Detach to raw value' }).count() === 1, 'the Fill dot menu offers Pick token and Detach to raw value')
  check(await page.locator('[role=menuitem]').filter({ hasText: 'Create property' }).count() === 0, 'on a page the dot offers no property binding')
  await snap(page, 'dot-menu')
  await page.locator('[role=menuitem]').filter({ hasText: 'Detach to raw value' }).click()
  const detached = await until(async () => {
    const { node } = await stored(column.nodeId)
    return /^#[0-9a-f]{6}$/.test(node.style.bg) && node.style.bg
  })
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
  const custom = await until(async () => (await stored(column.nodeId)).node.style.bg === '#ff6600')
  check(custom, 'a hex typed in the Custom tab is written to the node')
  await snap(page, 'picker-custom')

  // #12: "Create colour from this" adds a theme colour and uses it by name.
  await picker.getByRole('button', { name: 'Create colour from this' }).click()
  const created = await until(async () => {
    const { node, doc } = await stored(column.nodeId)
    return doc.theme.custom?.['brand-orange'] === '#ff6600' && node.style.bg === 'brand-orange'
  })
  check(created, 'Create colour from this adds "brand-orange" to the theme and binds the Fill to it')
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
  const swapped = await until(async () => {
    const { node, doc } = await stored(column.nodeId)
    const text = findNode(doc.pages[0].root, n => n.id === title.nodeId)
    const other = findNode(doc.pages[0].root, n => n.id === body.nodeId)
    return node.style.borderColor === 'secondary' && text.style.color === 'secondary' && other.style.color === 'muted'
  })
  check(swapped, 'swapping primary → secondary changes the border and the title, and leaves muted')
  // RELIABILITY-009: the swap is one undo step: one undo brings back primary on both keys.
  check((await action('history_get', { projectId: p.id })).undo === 'Update style', 'the swap is one "Update style" undo step')
  await action('history_undo', { projectId: p.id })
  const restored = await stored(column.nodeId)
  const restoredTitle = findNode(restored.doc.pages[0].root, n => n.id === title.nodeId)
  check(restored.node.style.borderColor === 'primary' && restoredTitle.style.color === 'primary', 'one undo reverts the whole swap (border and title)')
  await action('history_redo', { projectId: p.id })
  check(!!await until(async () => (await stored(column.nodeId)).node.style.borderColor === 'secondary'), 'redo applies the swap again')
  const outside = (await stored(card.nodeId)).node
  check(outside.style.bg === 'muted', 'nodes outside the selection keep their colours')

  // #12: the Design view lists the custom colour; removing it while used is refused, with the reason.
  await toView(page, 'Design')
  const row = page.locator('[data-custom-color-row="brand-orange"]')
  await row.waitFor()
  check(await row.isVisible() && (await row.innerText()).toLowerCase().includes('brand-orange'), 'the Design view lists the custom colour')
  await row.hover()
  await row.locator('[data-row-remove]').click()
  const refused = await until(async () => (await page.locator('[role=alert], li[data-state]').filter({ hasText: 'still used' }).count()) > 0)
  check(refused, 'removing a used custom colour shows the server\'s refusal')
  check((await action('theme_get', { projectId: p.id })).theme.custom?.['brand-orange'] === '#ff6600', 'the used colour stays in the theme')
  await snap(page, 'design-custom')
  await toView(page, 'Canvas')

  // #10: in the component view the dot creates a style property.
  const { componentId } = await action('component_create', { projectId: p.id, pageId, nodeId: card.nodeId, name: 'Card' })
  await page.waitForTimeout(600)
  const doc = await action('project_get', { projectId: p.id })
  const instance = findNode(doc.pages[0].root, n => n.type === 'Instance')
  const defRoot = doc.components.find(c => c.id === componentId).root
  await page.reload()
  await page.locator('[data-view-menu]').waitFor()
  await page.getByRole('tab', { name: 'Layers' }).click()
  await select(instance.id)
  await page.locator('[data-component-instance]').getByRole('button', { name: 'Edit' }).click()
  await page.locator('[data-component-view]').waitFor()
  await select(defRoot.id)
  await fill().hover()
  await fill().locator('[data-binding-dot="bg"]').click()
  await page.locator('[role=menuitem]').filter({ hasText: 'Create property' }).click()
  const bound = await until(async () => {
    const def = (await action('project_get', { projectId: p.id })).components.find(c => c.id === componentId)
    return def.properties.find(prop => prop.bindings.some(b => b.nodeId === defRoot.id && b.prop === 'bg' && b.target === 'style'))
  })
  check(!!bound, `Create property adds a style-bound property (${bound?.name})`)
  const dot = fill().locator('[data-binding-dot="bg"]')
  check(await until(async () => (await dot.getAttribute('data-bound')) === bound?.name), 'the bound row\'s dot is filled and names the property')
  await snap(page, 'component-bound')

  // RELIABILITY-T8-001: a base binding is inherited at Tablet; the menu still binds md:direction, with no plain Unbind.
  const dirRow = () => page.locator('[data-style-row="direction"]').first()
  const dirDot = () => dirRow().locator('[data-binding-dot="direction"]')
  const defOf = async () => (await action('project_get', { projectId: p.id })).components.find(c => c.id === componentId)
  const bindsAt = (def, key) => def.properties.find(prop => prop.bindings.some(b => b.nodeId === defRoot.id && b.prop === key && b.target === 'style'))
  await dirRow().hover()
  await dirDot().click()
  await page.locator('[role=menuitem]').filter({ hasText: 'Create property' }).click()
  const baseDir = await until(async () => bindsAt(await defOf(), 'direction'))
  check(!!baseDir, `Create property on Mobile binds the base key direction (${baseDir?.name})`)
  await page.getByRole('button', { name: 'Tablet', exact: true }).click()
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
  const tabletDir = await until(async () => {
    const def = await defOf()
    return !!(bindsAt(def, 'md:direction') && bindsAt(def, 'direction'))
  })
  check(tabletDir, 'Create property on Tablet adds an md:direction binding and keeps the base one')
  check(await until(async () => (await dirDot().getAttribute('data-bound-inherited')) === null), 'the Tablet row is then bound at its own key')

  // S8: in a variant, a colour swap over two nodes is one undo step, and Paste style removes primary tokens the copy lacks.
  const box = await action('node_insert', { projectId: p.id, pageId, type: 'Column', style: { bg: 'muted' }, children: [
    { type: 'Text', props: { text: 'Swatch one' }, style: { color: 'primary', p: '4' } },
    { type: 'Text', props: { text: 'Swatch two' }, style: { color: 'primary' } }
  ] })
  const { componentId: swatchId } = await action('component_create', { projectId: p.id, pageId, nodeId: box.nodeId, name: 'Swatch' })
  const { variantId: flatId } = await action('component_variant_add', { projectId: p.id, componentId: swatchId, name: 'Flat' })
  const swatchDoc = await action('project_get', { projectId: p.id })
  const swatch = swatchDoc.components.find(c => c.id === swatchId)
  const [oneId, twoId] = swatch.root.children.map(c => c.id)
  const swatchInstance = findNode(swatchDoc.pages[0].root, n => n.type === 'Instance' && n.props.component === swatchId)
  const flat = async () => (await action('project_get', { projectId: p.id })).components.find(c => c.id === swatchId).variants.find(v => v.id === flatId)
  await openEditor(page, p.id)
  await page.getByRole('tab', { name: 'Layers' }).click()
  await select(swatchInstance.id)
  await page.locator('[data-component-instance]').getByRole('button', { name: 'Edit' }).click()
  await page.locator('[data-component-view]').waitFor()
  await select(swatch.root.id)
  await page.getByRole('button', { name: 'Show and edit Flat' }).click()
  await until(async () => (await page.getByRole('button', { name: 'Show and edit Flat' }).getAttribute('aria-pressed')) === 'true')
  await page.waitForTimeout(400)

  const variantColors = page.locator('[data-selection-colors]')
  await variantColors.locator('[data-selection-color="primary"] [data-style-key]').click()
  await page.locator('[data-color-picker]').getByRole('button', { name: 'secondary', exact: true }).click()
  const variantSwapped = await until(async () => {
    const v = await flat()
    return v.overrides[oneId]?.style?.color === 'secondary' && v.overrides[twoId]?.style?.color === 'secondary'
  })
  check(variantSwapped, 'a colour swap in the variant overrides both texts')
  await page.keyboard.press('Escape')
  check((await action('history_get', { projectId: p.id })).undo === 'Override variant', 'the variant swap is one "Override variant" undo step')
  await action('history_undo', { projectId: p.id })
  check(!!await until(async () => Object.keys((await flat()).overrides).length === 0), 'one undo reverts the variant swap on both texts')

  // Copy Swatch two (color only) and Paste style onto Swatch one: its primary p is removed in the variant.
  await page.waitForTimeout(400)
  await select(twoId)
  await page.keyboard.press('Control+c')
  await page.locator(`[data-layer-id="${oneId}"]`).first().click({ button: 'right' })
  await page.locator('[data-node-menu-search]').waitFor()
  await page.keyboard.type('paste style')
  await page.keyboard.press('Enter')
  const removedP = await until(async () => {
    const v = await flat()
    return JSON.stringify(v.overrides[oneId]) === JSON.stringify({ unset: ['p'] })
  })
  check(removedP, `Paste style in the variant removes the primary's p (${JSON.stringify((await flat()).overrides)})`)
  const defOne = (await action('project_get', { projectId: p.id })).components.find(c => c.id === swatchId).root.children[0]
  check(defOne.style.p === '4', 'the primary keeps its p')
  check(await until(async () => (await page.locator('[data-override="style:p"]').count()) === 1), 'the overrides section lists the removed p')
  await page.locator('[data-variant-overrides]').scrollIntoViewIfNeeded()
  await snap(page, 'variant-removed')
  check((await action('history_get', { projectId: p.id })).undo === 'Override variant', 'the variant paste style is one "Override variant" undo step')
  await action('history_undo', { projectId: p.id })
  check(!!await until(async () => Object.keys((await flat()).overrides).length === 0), 'one undo brings the primary p back')

  check(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/422 \(The theme colour "brand-orange" is still used/] })
