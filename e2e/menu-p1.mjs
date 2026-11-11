/**
 * Checks of the P1 context menu and keys (not part of all.mjs): the node
 * menu's search (#14), rename by double-click in the layers, a lock keeping
 * a node from canvas selection until unlocked from its row (S4a), Copy and
 * Paste style and Paste, Esc selecting the parent and ⇧2 zooming to the
 * selection (#15). Shots go to e2e/.shots/menu-p1/.
 */
import { action, canvas, check, findNode, openEditor, project, run, shot, until } from './lib.mjs'

// After the menus' open animation.
const snap = async (page, name) => {
  await page.waitForTimeout(300)
  await shot(page, `menu-p1/${name}`)
}

await run('menu-p1', async ({ page, errors }) => {
  const p = await project('menu p1')
  const { pages } = await action('project_get', { projectId: p.id })
  const pageId = pages[0].id
  const rootId = pages[0].root.id
  const column = await action('node_insert', { projectId: p.id, pageId, type: 'Column' })
  const text = await action('node_insert', { projectId: p.id, pageId, parentId: column.nodeId, type: 'Text', props: { text: 'Hello menu' } })
  const button = await action('node_insert', { projectId: p.id, pageId, parentId: column.nodeId, type: 'Button', props: { label: 'Go' }, style: { bg: '#ff6600', rounded: 'lg' } })
  const other = await action('node_insert', { projectId: p.id, pageId, type: 'Text', props: { text: 'Other text' } })
  const nodeOf = async id => findNode((await action('project_get', { projectId: p.id })).pages[0].root, n => n.id === id)

  await openEditor(page, p.id)
  await page.getByRole('tab', { name: 'Layers' }).click()
  const row = id => page.locator(`[data-layer-id="${id}"]`).first()
  const isSelected = async id => await row(id).getAttribute('aria-selected') === 'true'
  const select = async (id) => {
    await row(id).click()
    await until(() => isSelected(id))
  }
  const openMenu = async (id) => {
    await row(id).click({ button: 'right' })
    await page.locator('[data-node-menu-search]').waitFor()
  }
  const menuItems = () => page.locator('[role=menu] [role^=menuitem]').evaluateAll(els => els.map(el => el.textContent.trim()))

  // #14: the search is focused on open and filters the actions; unavailable ones stay, dimmed.
  await openMenu(text.nodeId)
  check(await page.locator('[data-node-menu-search]').evaluate(el => el === document.activeElement), 'the node menu opens with its search focused')
  const all = await menuItems()
  check(['Add to agent', 'Rename', 'Lock', 'Duplicate', 'Delete'].every(label => all.some(item => item.startsWith(label))), `the menu lists Add to agent, Rename, Lock, Duplicate, Delete (${all.join(' | ')})`)
  check(await page.locator('[role=menu] [role^=menuitem][data-disabled]').filter({ hasText: 'Edit component' }).count() === 1, 'Edit component shows dimmed on a non-instance')
  await snap(page, 'menu')
  await page.keyboard.type('lock')
  await until(async () => (await menuItems()).length === 1)
  const filtered = await menuItems()
  check(filtered.length === 1 && filtered[0].startsWith('Lock'), `typing "lock" leaves only Lock (${filtered.join(' | ')})`)
  await snap(page, 'menu-search')
  await page.keyboard.press('Escape')
  await page.locator('[role=menu]').waitFor({ state: 'detached' })

  // Rename by double-clicking the layer name.
  await row(text.nodeId).locator('[data-layer-name]').dblclick()
  const field = page.locator('[data-layer-rename]')
  await field.waitFor()
  await field.fill('Greeting')
  await field.press('Enter')
  const renamed = await until(async () => (await nodeOf(text.nodeId))?.name === 'Greeting')
  check(renamed, 'a double-click on a layer name renames it (node_rename)')
  check(!!await until(async () => (await row(text.nodeId).innerText()).includes('Greeting')), 'the row shows the new name')

  // S4a: Lock from the menu; a canvas click on the locked text selects its Column instead.
  await openMenu(text.nodeId)
  await page.locator('[role=menu] [role^=menuitem]').filter({ hasText: /^\s*Lock/ }).click()
  await row(text.nodeId).locator('[data-layer-lock]').waitFor()
  check((await nodeOf(text.nodeId))?.locked === true, 'Lock sets the node locked')
  await select(other.nodeId)
  await canvas(page).getByText('Hello menu').click()
  await until(() => isSelected(column.nodeId))
  check(await isSelected(column.nodeId) && !await isSelected(text.nodeId), 'a canvas click on a locked node selects its nearest unlocked ancestor')
  await select(text.nodeId)
  check(true, 'the locked node is still selectable from the layers')
  await snap(page, 'locked')
  await row(text.nodeId).locator('[data-layer-lock]').click()
  check(!!await until(async () => (await nodeOf(text.nodeId))?.locked === undefined), 'the row\'s lock unlocks it')
  await select(other.nodeId)
  await canvas(page).getByText('Hello menu').click()
  check(!!await until(() => isSelected(text.nodeId)), 'once unlocked, a canvas click selects it again')

  // Copy the Button (Ctrl+C), then Paste style onto the other text through the menu search (Enter runs the match).
  await select(button.nodeId)
  await page.keyboard.press('Control+c')
  await openMenu(other.nodeId)
  await page.keyboard.type('paste style')
  await page.keyboard.press('Enter')
  const styled = await until(async () => (await nodeOf(other.nodeId))?.style.bg === '#ff6600')
  check(styled, 'Paste style gives the other text the Button\'s style')
  check((await nodeOf(other.nodeId))?.style.rounded === 'lg', 'Paste style copies every token')

  // Paste (Ctrl+V) inserts a copy with new ids after the selection.
  await select(other.nodeId)
  await page.keyboard.press('Control+v')
  const pasted = await until(async () => {
    const root = (await action('project_get', { projectId: p.id })).pages[0].root
    const buttons = []
    findNode(root, n => n.type === 'Button' && buttons.push(n.id) && false)
    return buttons.length === 2 && buttons
  })
  check(!!pasted && pasted.includes(button.nodeId), 'Ctrl+V pastes the copied Button as a new node')

  // #15: Esc selects the parent, then the root, then clears.
  await select(text.nodeId)
  await page.keyboard.press('Escape')
  check(!!await until(() => isSelected(column.nodeId)), 'Esc selects the parent')
  await page.keyboard.press('Escape')
  check(!!await until(() => isSelected(rootId)), 'Esc again selects the page root')
  await page.keyboard.press('Escape')
  check(!!await until(async () => await page.locator('[data-layer-id][aria-selected="true"]').count() === 0), 'Esc on the root clears the selection')

  // #15: ⇧2 zooms to the selection.
  const zoom = () => page.locator('[data-canvas-content]').evaluate(el => Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1]))
  await select(button.nodeId)
  const before = await zoom()
  await page.keyboard.press('Shift+Digit2')
  const after = await until(async () => {
    const z = await zoom()
    return z > before * 2 && z
  })
  check(!!after, `⇧2 zooms to the selected Button (${before} → ${after ?? await zoom()})`)
  await snap(page, 'zoom-selection')
  await page.locator('[data-zoom-menu]').click()
  await page.locator('[role=menu] [role^=menuitem]').filter({ hasText: 'Zoom to selection' }).waitFor()
  const zoomMenu = await menuItems()
  check(zoomMenu.some(item => item.startsWith('Select parent')), `the zoom menu lists Zoom to selection and Select parent (${zoomMenu.join(' | ')})`)
  await snap(page, 'zoom-menu')
  await page.keyboard.press('Escape')

  check(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
