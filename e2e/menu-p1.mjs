/**
 * Checks of the P1 context menu and keys (run by all.mjs): the node menu's
 * search (#14), rename by double-click in the layers, a lock keeping a node
 * from canvas selection until unlocked from its row (S4a), Copy and Paste
 * style and Paste, Esc selecting the parent and ⇧2 zooming to the selection
 * (#15). Also the review fixes: a paste keeps exactly the copied props and
 * style (RELIABILITY-001), ⌘⌥V works with focus in the canvas (-006), the
 * canvas arrows and insert tools leave locked nodes alone (-007), Ctrl+C is
 * the browser's outside the canvas and the layers and over selected text
 * (-005), a multi-selection copies and pastes in one undo step (-004), a
 * newer clip in the system clipboard wins (-003), and the canvas leaves
 * Ctrl+L to the browser with nothing selected (-013). The context may read
 * and write the clipboard. Shots go to e2e/.shots/menu-p1/.
 */
import { action, BASE, canvas, check, findNode, openEditor, project, run, shot, until } from './lib.mjs'

// After the menus' open animation.
const snap = async (page, name) => {
  await page.waitForTimeout(300)
  await shot(page, `menu-p1/${name}`)
}

await run('menu-p1', async ({ context, page, errors }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  const p = await project('menu p1')
  const { pages } = await action('project_get', { projectId: p.id })
  const pageId = pages[0].id
  const rootId = pages[0].root.id
  const column = await action('node_insert', { projectId: p.id, pageId, type: 'Column' })
  const text = await action('node_insert', { projectId: p.id, pageId, parentId: column.nodeId, type: 'Text', props: { text: 'Hello menu' } })
  const button = await action('node_insert', { projectId: p.id, pageId, parentId: column.nodeId, type: 'Button', props: { label: 'Go' }, style: { bg: '#ff6600', rounded: 'lg' } })
  const other = await action('node_insert', { projectId: p.id, pageId, type: 'Text', props: { text: 'Other text' } })
  const third = await action('node_insert', { projectId: p.id, pageId, type: 'Text', props: { text: 'Third text' } })
  // A Card without its default gap, holding a Text without its default text prop.
  const card = await action('node_insert', { projectId: p.id, pageId, type: 'Card', style: { p: '6' }, children: [{ type: 'Text', style: { color: '#ff6600' } }] })
  await action('node_update_style', { projectId: p.id, pageId, nodeId: card.nodeId, style: { gap: null } })
  const getRoot = async () => (await action('project_get', { projectId: p.id })).pages[0].root
  const nodeOf = async id => findNode(await getRoot(), n => n.id === id)
  await action('node_update_props', { projectId: p.id, pageId, nodeId: (await nodeOf(card.nodeId)).children[0].id, props: { text: null } })

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
  check(await isSelected(text.nodeId), 'the locked node is still selectable from the layers')
  await snap(page, 'locked')
  await row(text.nodeId).locator('[data-layer-lock]').click()
  check(!!await until(async () => (await nodeOf(text.nodeId))?.locked === undefined), 'the row\'s lock unlocks it')
  await select(other.nodeId)
  await canvas(page).getByText('Hello menu').click()
  check(!!await until(() => isSelected(text.nodeId)), 'once unlocked, a canvas click selects it again')

  // RELIABILITY-005: with focus outside the canvas and the layers, or over selected text, Ctrl+C is the browser's (nothing is copied yet).
  const pasteDisabled = async () => {
    await openMenu(other.nodeId)
    const disabled = await page.locator('[role=menu] [role^=menuitem]').filter({ hasText: /^\s*Paste\s*$/ }).first().getAttribute('data-disabled') !== null
    await page.keyboard.press('Escape')
    await page.locator('[role=menu]').waitFor({ state: 'detached' })
    return disabled
  }
  await select(button.nodeId)
  await page.locator('[data-inspector-head]').click()
  check(await page.evaluate(() => !document.activeElement?.closest('[data-layers]')), 'a click in the inspector moves the focus out of the layers')
  await page.keyboard.press('Control+c')
  check(await pasteDisabled(), 'Ctrl+C with focus in the inspector copies no node')
  await select(button.nodeId)
  await page.evaluate(() => getSelection().selectAllChildren(document.querySelector('[data-inspector-head]')))
  await page.keyboard.press('Control+c')
  await page.evaluate(() => getSelection().removeAllRanges())
  check(await pasteDisabled(), 'Ctrl+C over selected text copies no node, with focus in the layers')

  // Copy the Button (Ctrl+C, focus in the layers: the positive control), then Paste style onto the other text through the menu search (Enter runs the match).
  await select(button.nodeId)
  await page.keyboard.press('Control+c')
  check(!await pasteDisabled(), 'Ctrl+C with focus in the layers and no text selected copies the node')
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

  // RELIABILITY-001: the pasted Card and its Text keep exactly the copied props and style (no default gap or text comes back).
  const shape = node => ({ type: node.type, props: node.props, style: node.style, children: node.children.map(shape) })
  await select(card.nodeId)
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  const cardCopy = await until(async () => {
    const cards = (await getRoot()).children.filter(n => n.type === 'Card')
    return cards.length === 2 && cards.find(n => n.id !== card.nodeId)
  })
  const source = await nodeOf(card.nodeId)
  const sorted = value => JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v))
  check(!!cardCopy && sorted(shape(cardCopy)) === sorted(shape(source)), `the pasted Card matches its source exactly (${JSON.stringify(cardCopy && shape(cardCopy))})`)
  check(!!cardCopy && !('gap' in cardCopy.style) && !('text' in cardCopy.children[0].props), 'the paste brings back neither the removed gap nor the removed text prop')

  // RELIABILITY-004: Copy takes the whole multi-selection, Paste inserts all of it in one undo step.
  const rootTextsOf = async label => (await getRoot()).children.filter(n => n.type === 'Text' && n.props.text === label).length
  await select(other.nodeId)
  await row(third.nodeId).click({ modifiers: ['Shift'] })
  await until(() => isSelected(third.nodeId))
  check(await isSelected(other.nodeId) && await isSelected(third.nodeId), 'Shift+click selects both texts')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  check(!!await until(async () => await rootTextsOf('Other text') === 2 && await rootTextsOf('Third text') === 2), 'Ctrl+V pastes both copied texts')
  check((await action('history_get', { projectId: p.id })).undo === 'Insert 2', 'the paste of two nodes is one "Insert 2" undo step')
  await action('history_undo', { projectId: p.id })
  check(!!await until(async () => await rootTextsOf('Other text') === 1 && await rootTextsOf('Third text') === 1), 'one undo removes both pasted texts')

  // RELIABILITY-003: a clip in the system clipboard copied after the in-memory one (another tab's) wins; an older one doesn't.
  const writeClip = (text, copiedAt) => page.evaluate(([label, at]) => navigator.clipboard.writeText(JSON.stringify({
    kind: 'bildr/node', sourceIds: ['elsewhere'], copiedAt: at === 'later' ? Date.now() + 60_000 : at, nodes: [{ type: 'Heading', props: { text: label }, style: {}, children: [] }]
  })), [text, copiedAt])
  const headings = async label => (await getRoot()).children.filter(n => n.type === 'Heading' && n.props.text === label).length
  await select(other.nodeId)
  await writeClip('From another tab', 'later')
  await page.keyboard.press('Control+v')
  check(!!await until(async () => await headings('From another tab') === 1), 'Ctrl+V pastes the newer clip from the system clipboard')
  await select(other.nodeId)
  await writeClip('Older clip', 1)
  await page.keyboard.press('Control+v')
  check(!!await until(async () => await rootTextsOf('Other text') === 2), 'with an older system clip, Ctrl+V pastes the in-memory one (the two texts)')
  check(await headings('Older clip') === 0, 'the older system clip is not pasted')
  await action('history_undo', { projectId: p.id })
  await action('history_undo', { projectId: p.id })
  check(!!await until(async () => await headings('From another tab') === 0 && await rootTextsOf('Other text') === 1), 'undo removes both pastes')

  // RELIABILITY-006: ⌘⌥V (Ctrl+Alt+V) pastes the style with focus in the canvas, after a canvas click.
  await select(button.nodeId)
  await page.keyboard.press('Control+c')
  await canvas(page).getByText('Third text').click()
  await until(() => isSelected(third.nodeId))
  await page.keyboard.press('Control+Alt+KeyV')
  check(!!await until(async () => (await nodeOf(third.nodeId))?.style.bg === '#ff6600'), 'Ctrl+Alt+V from the canvas pastes the Button\'s style')

  // RELIABILITY-007: a locked node selected from the layers doesn't move with the arrows from the canvas, but does from its layers menu.
  const indexIn = async (parentId, id) => (await nodeOf(parentId)).children.findIndex(n => n.id === id)
  const focusCanvas = () => page.evaluate(() => document.querySelector('iframe[title="Canvas"]').contentWindow.focus())
  await select(button.nodeId)
  await focusCanvas()
  await page.keyboard.press('ArrowUp')
  check(!!await until(async () => await indexIn(column.nodeId, button.nodeId) === 0), 'ArrowUp from the canvas moves an unlocked node (control)')
  await page.keyboard.press('ArrowDown')
  await until(async () => await indexIn(column.nodeId, button.nodeId) === 1)
  await action('node_set_locked', { projectId: p.id, pageId, nodeId: text.nodeId, locked: true })
  await row(text.nodeId).locator('[data-layer-lock]').waitFor()
  await select(text.nodeId)
  await focusCanvas()
  // The canvas sends its keys in order, so once the Escape after it has selected the Column the ArrowDown has been handled.
  const moves = []
  const onRequest = request => request.url().endsWith('/api/actions/node_move_many') && moves.push(request)
  page.on('request', onRequest)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  check(!!await until(() => isSelected(column.nodeId)), 'the Escape sent after the ArrowDown selects the Column (control)')
  page.off('request', onRequest)
  check(!moves.length && await indexIn(column.nodeId, text.nodeId) === 0, 'ArrowDown from the canvas leaves a locked node in place (no move sent)')
  await openMenu(text.nodeId)
  await page.locator('[role=menu] [role^=menuitem]').filter({ hasText: 'Move down' }).click()
  check(!!await until(async () => await indexIn(column.nodeId, text.nodeId) === 1), 'Move down from its layers menu still moves the locked node')
  await openMenu(text.nodeId)
  await page.locator('[role=menu] [role^=menuitem]').filter({ hasText: 'Move up' }).click()
  await until(async () => await indexIn(column.nodeId, text.nodeId) === 0)

  // RELIABILITY-007: the Text tool clicked inside a locked Column inserts into its nearest unlocked ancestor (the page root).
  await action('node_set_locked', { projectId: p.id, pageId, nodeId: column.nodeId, locked: true })
  await row(column.nodeId).locator('[data-layer-lock]').waitFor()
  const rootTexts = async () => (await getRoot()).children.filter(n => n.type === 'Text').length
  const textsBefore = await rootTexts()
  await select(other.nodeId)
  await page.keyboard.press('t')
  await canvas(page).getByRole('button', { name: 'Go' }).first().click()
  check(!!await until(async () => await rootTexts() === textsBefore + 1), 'the Text tool on a locked Column inserts at the page root')
  check((await nodeOf(column.nodeId)).children.length === 2, 'nothing lands inside the locked Column')
  await page.keyboard.press('Escape')
  await action('node_set_locked', { projectId: p.id, pageId, nodeIds: [column.nodeId, text.nodeId], locked: false })
  await until(async () => await row(column.nodeId).locator('[data-layer-lock]').count() === 0)

  // #15: Esc selects the parent, then the root, then clears.
  await select(text.nodeId)
  await page.keyboard.press('Escape')
  check(!!await until(() => isSelected(column.nodeId)), 'Esc selects the parent')
  await page.keyboard.press('Escape')
  check(!!await until(() => isSelected(rootId)), 'Esc again selects the page root')
  await page.keyboard.press('Escape')
  check(!!await until(async () => await page.locator('[data-layer-id][aria-selected="true"]').count() === 0), 'Esc on the root clears the selection')

  // RELIABILITY-013: with nothing selected, the canvas leaves Ctrl+L to the browser; with a selection it takes it (Lock).
  const frame = await (await page.locator('iframe[title="Canvas"]').elementHandle()).contentFrame()
  await frame.evaluate(() => {
    window.__keys = []
    window.addEventListener('keydown', event => window.__keys.push({ key: event.key, prevented: event.defaultPrevented }))
  })
  const lastKey = () => frame.evaluate(() => window.__keys.at(-1))
  await focusCanvas()
  await page.keyboard.press('Control+l')
  check((await lastKey())?.prevented === false, 'Ctrl+L in the canvas with nothing selected is not taken')
  await select(other.nodeId)
  await focusCanvas()
  await page.keyboard.press('Control+l')
  check((await lastKey())?.prevented === true, 'Ctrl+L in the canvas with a selection is taken')
  check(!!await until(async () => (await nodeOf(other.nodeId))?.locked === true), 'and locks the selected node')
  await page.keyboard.press('Control+l')
  await until(async () => (await nodeOf(other.nodeId))?.locked === undefined)

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
