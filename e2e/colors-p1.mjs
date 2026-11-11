/**
 * Checks and a screenshot tour of the P1 colour and binding work (not part
 * of all.mjs): the binding dot's menu (#10) on a style row, Detach to raw
 * value, a style property created from the dot in the component view; the
 * colour picker's Custom tab writing a raw hex and "Create colour from
 * this" (#12), with the custom colour listed in the Design view (removing
 * a used one is refused, and says so); and the Selection colours section
 * swapping a colour across the subtree (#13). Shots go to e2e/.shots/colors-p1/.
 */
import { action, check, findNode, openEditor, project, run, shot, toView, until } from './lib.mjs'

const snap = async (page, name) => {
  await page.waitForTimeout(300)
  await shot(page, `colors-p1/${name}`)
}

await run('colors-p1', async ({ page, errors }) => {
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
  const outside = (await stored(card.nodeId)).node
  check(outside.style.bg === 'muted', 'nodes outside the selection keep their colours')

  // #12: the Design view lists the custom colour; removing it while used is refused, with the reason.
  await toView(page, 'Design')
  const row = page.locator('[data-custom-color-row="brand-orange"]')
  await row.waitFor()
  check(true, 'the Design view lists the custom colour')
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

  check(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/422 \(The theme colour "brand-orange" is still used/] })
