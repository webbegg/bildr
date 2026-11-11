/**
 * Checks of canvas direct manipulation (#23, S6; run by all.mjs): a resize
 * handle drag commits a snapped W token in one undo step with a live
 * "w-N · Npx" label, Esc cancels a drag (no write, the selection stays),
 * hovering the panel's Padding field paints the padding overlay, a gap
 * handle drag writes a snapped gap token, a selected node dragged onto a
 * sibling reorders it in one node_move (one undo), and a locked node has no
 * handles and doesn't drag. Shots go to e2e/.shots/canvas-p2/.
 */
import { action, canvas, check, findNode, openEditor, project, run, shot, until } from './lib.mjs'

const SPACING = ['0', '0.5', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24', '32']
const WIDTHS = ['0', '4', '8', '12', '16', '20', '24', '32', '40', '48', '56', '64', '72', '80', '96']

await run('canvas-p2', async ({ page, errors }) => {
  const p = await project('canvas p2')
  const { pages } = await action('project_get', { projectId: p.id })
  const pageId = pages[0].id
  const column = await action('node_insert', { projectId: p.id, pageId, type: 'Column', style: { p: '4', gap: '2' } })
  const texts = []
  for (const label of ['Alpha text', 'Bravo text', 'Charlie text']) {
    texts.push((await action('node_insert', { projectId: p.id, pageId, parentId: column.nodeId, type: 'Text', props: { text: label } })).nodeId)
  }
  const [alpha, bravo, charlie] = texts
  const getRoot = async () => (await action('project_get', { projectId: p.id })).pages[0].root
  const nodeOf = async id => findNode(await getRoot(), n => n.id === id)
  const order = async () => (await nodeOf(column.nodeId)).children.map(n => n.id)

  await openEditor(page, p.id)
  await page.getByRole('tab', { name: 'Layers' }).click()
  const row = id => page.locator(`[data-layer-id="${id}"]`).first()
  const isSelected = async id => await row(id).getAttribute('aria-selected') === 'true'
  const select = async (id) => {
    await row(id).click()
    await until(() => isSelected(id))
    await page.waitForTimeout(200)
  }
  const frame = canvas(page)
  const center = async (locator) => {
    const box = await locator.boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  // The style writes and moves the page sends, to count undo steps.
  const calls = []
  page.on('request', (request) => {
    const name = request.url().split('/api/actions/')[1]
    if (['node_update_style', 'node_move', 'node_move_many', 'component_variant_set_override'].includes(name)) calls.push(name)
  })
  const callsOf = name => calls.filter(c => c === name).length

  // S6a: the 8 handles show on a single unlocked selection; the right edge drags W to a snapped token with a live label.
  await select(alpha)
  const handles = frame.locator('[data-resize-handle]')
  check(!!await until(async () => await handles.count() === 8), `a selected text has 8 resize handles (${await handles.count()})`)
  const east = await center(frame.locator('[data-resize-handle="e"]'))
  const historyBefore = (await action('history_get', { projectId: p.id })).undo
  await page.mouse.move(east.x, east.y)
  await page.mouse.down()
  await page.mouse.move(east.x + 60, east.y, { steps: 8 })
  const label = await until(async () => {
    const el = frame.locator('[data-drag-label]')
    return await el.count() && await el.innerText()
  })
  check(/^w-\d+ · \d+(\.\d+)?px$/.test(label || ''), `the drag shows the token and px live (${label})`)
  await shot(page, 'canvas-p2/resize-drag')
  check(callsOf('node_update_style') === 0, 'nothing is written while dragging (preview only)')
  await page.mouse.up()
  const width = await until(async () => (await nodeOf(alpha))?.style.w)
  check(WIDTHS.includes(width), `the release commits a snapped W token (w-${width})`)
  check(label === undefined || label.startsWith(`w-${width} `), `the committed token is the one the label showed (${label})`)
  await page.waitForTimeout(300)
  check(callsOf('node_update_style') === 1, `the resize is one style write (${callsOf('node_update_style')})`)
  check(await isSelected(alpha), 'the click that ends the drag selects nothing else')
  const historyAfter = (await action('history_get', { projectId: p.id })).undo
  check(historyAfter !== historyBefore, `the resize is an undo step (${historyAfter})`)
  await action('history_undo', { projectId: p.id })
  check(!!await until(async () => (await nodeOf(alpha))?.style.w === undefined), 'one undo removes the W token')

  // Esc cancels a drag: no write, the preview goes and the selection stays.
  await select(alpha)
  await until(async () => await handles.count() === 8)
  const south = await center(frame.locator('[data-resize-handle="s"]'))
  const writes = calls.length
  const alphaHeight = () => frame.locator(`[data-bildr-id="${alpha}"]`).evaluate(el => el.offsetHeight)
  const heightBefore = await alphaHeight()
  await page.mouse.move(south.x, south.y)
  await page.mouse.down()
  await page.mouse.move(south.x, south.y + 50, { steps: 6 })
  await until(async () => await frame.locator('[data-drag-label]').count() === 1)
  check(!!await until(async () => await alphaHeight() > heightBefore), 'the drag previews the new height on the canvas')
  await page.keyboard.press('Escape')
  check(!!await until(async () => await frame.locator('[data-drag-label]').count() === 0), 'Esc drops the drag and its label')
  check(!!await until(async () => await alphaHeight() === heightBefore), 'and its preview')
  await page.mouse.move(south.x, south.y + 80, { steps: 3 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  check(calls.length === writes && (await nodeOf(alpha)).style.h === undefined, 'a cancelled drag writes nothing')
  check(await isSelected(alpha), 'Esc during a drag keeps the selection (it doesn\'t select the parent)')

  // S6b: hovering the panel's Padding field paints the padding overlay on the selection; leaving it clears it.
  await select(column.nodeId)
  await page.locator('[data-style-row="padding"]').first().hover()
  check(!!await until(async () => await frame.locator('[data-spacing-overlay="padding"] [data-padding-area]').count() === 4), 'hovering the Padding field shows the 4 padding areas')
  await shot(page, 'canvas-p2/padding-hover')
  await page.locator('[data-inspector-head]').hover()
  check(!!await until(async () => await frame.locator('[data-spacing-overlay]').count() === 0), 'leaving the field clears the overlay')
  await page.locator('[data-style-row="gap"]').first().hover()
  check(!!await until(async () => await frame.locator('[data-spacing-overlay="gap"] [data-gap-area]').count() === 2), 'hovering the Gap field shows the 2 gaps')
  await page.locator('[data-inspector-head]').hover()

  // S6b: over the selected auto layout, the gap handle drags `gap` to a snapped token.
  const columnBox = await frame.locator(`[data-bildr-id="${column.nodeId}"]`).boundingBox()
  await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 4)
  const gapHandle = frame.locator('[data-spacing-handle="gap"]').first()
  check(!!await until(async () => await gapHandle.count() > 0), 'hovering the selected Column shows its gap handles')
  check(await frame.locator('[data-spacing-handle="top"]').count() === 1, 'and a handle per padding side')
  await shot(page, 'canvas-p2/spacing-hover')
  const gapAt = await center(gapHandle)
  const before = calls.length
  await page.mouse.move(gapAt.x, gapAt.y)
  await page.mouse.down()
  await page.mouse.move(gapAt.x, gapAt.y + 20, { steps: 6 })
  const gapLabel = await until(async () => {
    const el = frame.locator('[data-drag-label]')
    return await el.count() && await el.innerText()
  })
  check(/^gap-[\d.]+ · [\d.]+px$/.test(gapLabel || ''), `the gap drag shows its token (${gapLabel})`)
  await page.mouse.up()
  const gap = await until(async () => {
    const value = (await nodeOf(column.nodeId)).style.gap
    return value !== '2' && value
  })
  check(SPACING.includes(gap) && Number(gap) > 2, `the gap drag commits a larger snapped gap token (gap-${gap})`)
  await page.waitForTimeout(300)
  check(calls.length === before + 1, `the gap drag is one write (${calls.slice(before).join(', ')})`)

  // S6c: dragging the selected Alpha onto the lower half of Charlie moves it after Charlie, in one node_move.
  await select(alpha)
  const from = await center(frame.locator(`[data-bildr-id="${alpha}"]`))
  const charlieBox = await frame.locator(`[data-bildr-id="${charlie}"]`).boundingBox()
  const moves = calls.length
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 2, from.y + 2, { steps: 2 })
  check(await frame.locator('[data-drop-indicator]').count() === 0, 'a press that moves less than 4px is no drag')
  await page.mouse.move(charlieBox.x + charlieBox.width / 2, charlieBox.y + charlieBox.height * 0.8, { steps: 10 })
  check(!!await until(async () => await frame.locator('[data-drop-indicator]').count() === 1), 'the drop indicator shows the slot under the pointer')
  await shot(page, 'canvas-p2/reorder-drag')
  await page.mouse.up()
  check(!!await until(async () => JSON.stringify(await order()) === JSON.stringify([bravo, charlie, alpha])), `the drop moves Alpha after Charlie (${(await order()).join(', ')})`)
  await page.waitForTimeout(300)
  check(calls.length === moves + 1 && calls.at(-1) === 'node_move', `the reorder is one node_move (${calls.slice(moves).join(', ')})`)
  check(await isSelected(alpha), 'the moved node stays selected')
  await action('history_undo', { projectId: p.id })
  check(!!await until(async () => JSON.stringify(await order()) === JSON.stringify([alpha, bravo, charlie])), 'one undo restores the order')

  // Esc cancels a reorder drag too.
  await select(alpha)
  const again = await center(frame.locator(`[data-bildr-id="${alpha}"]`))
  const charlieAgain = await frame.locator(`[data-bildr-id="${charlie}"]`).boundingBox()
  const beforeEsc = calls.length
  await page.mouse.move(again.x, again.y)
  await page.mouse.down()
  await page.mouse.move(charlieAgain.x + charlieAgain.width / 2, charlieAgain.y + charlieAgain.height * 0.8, { steps: 10 })
  await until(async () => await frame.locator('[data-drop-indicator]').count() === 1)
  await page.keyboard.press('Escape')
  check(!!await until(async () => await frame.locator('[data-drop-indicator]').count() === 0), 'Esc drops the reorder indicator')
  await page.mouse.up()
  await page.waitForTimeout(400)
  check(calls.length === beforeEsc && JSON.stringify(await order()) === JSON.stringify([alpha, bravo, charlie]), 'a cancelled reorder moves nothing')
  check(await isSelected(alpha), 'and keeps the selection')

  // A locked node selected from the layers has no handles and doesn't drag.
  await action('node_set_locked', { projectId: p.id, pageId, nodeId: bravo, locked: true })
  await row(bravo).locator('[data-layer-lock]').waitFor()
  await select(bravo)
  await page.waitForTimeout(300)
  check(await handles.count() === 0, `a locked node has no resize handles (${await handles.count()})`)
  const locked = await center(frame.locator(`[data-bildr-id="${bravo}"]`))
  const lockedCalls = calls.length
  await page.mouse.move(locked.x, locked.y)
  await page.mouse.down()
  await page.mouse.move(charlieAgain.x + charlieAgain.width / 2, charlieAgain.y + charlieAgain.height * 0.8, { steps: 10 })
  check(await frame.locator('[data-drop-indicator]').count() === 0, 'dragging a locked node shows no drop indicator')
  await page.mouse.up()
  await page.waitForTimeout(400)
  check(calls.length === lockedCalls && JSON.stringify(await order()) === JSON.stringify([alpha, bravo, charlie]), 'a locked node doesn\'t move')
  await shot(page, 'canvas-p2/locked')

  // Keyboard shortcuts still work after the drags: Esc selects the parent.
  await action('node_set_locked', { projectId: p.id, pageId, nodeId: bravo, locked: false })
  await select(alpha)
  await page.keyboard.press('Escape')
  check(!!await until(() => isSelected(column.nodeId)), 'Esc (no drag) still selects the parent')

  // Zoomed in on the Column (⇧2): the handles and the hatched overlays at screen size, for the shots.
  await page.keyboard.press('Shift+Digit2')
  await page.waitForTimeout(500)
  const zoomed = await frame.locator(`[data-bildr-id="${column.nodeId}"]`).boundingBox()
  await page.mouse.move(zoomed.x + zoomed.width / 2, zoomed.y + 6)
  check(!!await until(async () => await frame.locator('[data-spacing-handle]').count() >= 6), 'zoomed in, the Column shows 4 padding and 2 gap handles')
  await shot(page, 'canvas-p2/zoomed-overlays')
  await page.locator('[data-style-row="padding"]').first().hover()
  await page.waitForTimeout(200)
  await shot(page, 'canvas-p2/zoomed-padding-field')

  check(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
