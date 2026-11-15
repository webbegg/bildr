/**
 * Checks the unit tests could not make (U6/U8, Log L12), in a real Chromium:
 * 1. drag-to-reorder hit-testing, including over the dragged node's own handles (a press-and-drag that stays
 *    over the node's own box and handles shows no drop slot and writes nothing; a drag onto a sibling does);
 * 2. no text selection while dragging (the iframe's and the editor's `getSelection()` stay empty, and the
 *    drag does not select the page's text);
 * 3. fit and zoom after a hidden-stage refit (the canvas area is hidden by the Design view while the window
 *    is resized; coming back, the zoom fits the new size and the frame is inside the stage);
 * 4. Space-pan, then blur (the hand is released when the window loses focus: the next drag selects or
 *    reorders instead of panning).
 */
import { action, canvas, check, openEditor, run, scene, shot, toView, until } from './lib.mjs'

await run('real-browser', async ({ page, errors }) => {
  const s = await scene('real-browser')
  const column = await s.ins({ type: 'Column', style: { p: '4', gap: '2' } })
  const ids = []
  for (const label of ['Alpha text', 'Bravo text', 'Charlie text']) ids.push(await s.ins({ parentId: column, type: 'Text', props: { text: label } }))
  const [a, b, c] = ids
  const order = () => s.node(column).children.map(n => n.id)

  await openEditor(page, s.file)
  await page.getByRole('tab', { name: 'Layers' }).click()
  const frame = canvas(page)
  const row = id => page.locator(`[data-layer-id="${id}"]`).first()
  const select = async (id) => {
    await row(id).click()
    await until(async () => await row(id).getAttribute('aria-selected') === 'true')
    await page.waitForTimeout(250)
  }
  const center = async (locator) => {
    const box = await locator.boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const writes = []
  page.on('request', (request) => {
    const name = request.url().split('/api/actions/')[1]
    if (name && /^node_/.test(name)) writes.push(name)
  })
  const settleFrames = () => frame.locator('body').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  // 1. Hit-testing over the node's own handles: Bravo is selected, so its 8 handles sit on its edges.
  await select(b)
  check(!!await until(async () => await frame.locator('[data-resize-handle]').count() === 8), 'the selected node has its 8 handles')
  const bravoBox = await frame.locator(`[data-node="${b}"]`).boundingBox()
  const from = { x: bravoBox.x + bravoBox.width / 2, y: bravoBox.y + bravoBox.height / 2 }
  const before = writes.length
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Over its own bottom handle, then its own top handle, then back inside it: never another node's slot.
  const bottom = await center(frame.locator('[data-resize-handle="s"]'))
  const top = await center(frame.locator('[data-resize-handle="n"]'))
  let indicator = 0
  for (const point of [{ x: from.x + 6, y: from.y + 6 }, { x: bottom.x, y: bottom.y - 1 }, { x: top.x, y: top.y + 1 }, from]) {
    await page.mouse.move(point.x, point.y, { steps: 4 })
    await settleFrames()
    indicator += await frame.locator('[data-drop-indicator]').count()
  }
  const during = await page.evaluate(() => getSelection()?.toString() ?? '')
  const inside = await frame.locator('body').evaluate(() => getSelection()?.toString() ?? '')
  await page.mouse.up()
  await page.waitForTimeout(400)
  check(indicator === 0, `dragging over a node's own handles shows no drop slot (${indicator} indicators)`)
  check(writes.length === before && JSON.stringify(order()) === JSON.stringify([a, b, c]), `and releasing there writes nothing (${writes.length - before} writes)`)
  check(await frame.locator('#bildr-canvas-cursor').evaluate(el => el.textContent.includes('grabbing')).catch(() => false) === false, 'the drag cursor is gone after the release')

  // 2. No text selection while dragging a node onto a sibling (positive control: the move happens).
  const charlieBox = await frame.locator(`[data-node="${c}"]`).boundingBox()
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(charlieBox.x + charlieBox.width / 2, charlieBox.y + charlieBox.height * 0.8, { steps: 12 })
  await until(async () => await frame.locator('[data-drop-indicator]').count() === 1)
  const duringDrop = await frame.locator('body').evaluate(() => getSelection()?.toString() ?? '')
  const editorSelection = await page.evaluate(() => getSelection()?.toString() ?? '')
  const userSelect = await frame.locator('body').evaluate(() => getComputedStyle(document.body).userSelect)
  await shot(page, 'real-browser/reorder')
  await page.mouse.up()
  check(during === '' && inside === '' && duringDrop === '' && editorSelection === '', `no text is selected while dragging (editor "${editorSelection}", canvas "${duringDrop}")`)
  check(userSelect === 'none' || duringDrop === '', `the canvas does not select text during the drag (user-select: ${userSelect})`)
  check(!!await until(() => JSON.stringify(order()) === JSON.stringify([a, c, b])), `the drag onto Charlie moved Bravo after it (${order().join(', ')})`)
  await action('history_undo')
  await until(() => JSON.stringify(order()) === JSON.stringify([a, b, c]))

  // 3. Fit and zoom after a hidden-stage refit: the Design view hides the canvas area; the window is resized meanwhile.
  const zoomOf = () => page.locator('[data-canvas-content]').evaluate(el => Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1]))
  // (No manual zoom first: the view keeps fitting the frames until the user zooms or pans, as it does when a project opens.)
  const wide = await zoomOf()
  await toView(page, 'Design')
  await page.setViewportSize({ width: 1000, height: 640 })
  await page.waitForTimeout(500)
  await toView(page, 'Canvas')
  await page.waitForTimeout(800)
  const narrow = await zoomOf()
  const stage = await page.locator('[data-canvas-stage]').boundingBox()
  const device = await page.locator('iframe[title="Canvas"]').boundingBox()
  check(Number.isFinite(narrow) && narrow > 0, `after the hidden refit the zoom is a number (${narrow})`)
  check(narrow < wide, `and it fits the smaller window (${wide.toFixed(2)} → ${narrow.toFixed(2)})`)
  check(device.x >= stage.x - 1 && device.x + device.width <= stage.x + stage.width + 1 && device.y >= stage.y - 1 && device.y + device.height <= stage.y + stage.height + 1, `the frame is inside the stage (${JSON.stringify({ stage: [stage.x, stage.y, stage.width, stage.height].map(Math.round), device: [device.x, device.y, device.width, device.height].map(Math.round) })})`)
  await shot(page, 'real-browser/refit')
  await page.setViewportSize({ width: 1400, height: 850 })
  await page.waitForTimeout(500)

  // 4. Space-pan, then blur: the hand is released by the blur.
  const content = page.locator('[data-canvas-content]')
  const offset = () => content.evaluate(el => el.style.transform)
  const area = await page.locator('[data-canvas-stage]').boundingBox()
  const at = { x: area.x + area.width - 60, y: area.y + 120 }
  await page.mouse.move(at.x, at.y)
  const panStart = await offset()
  await page.keyboard.down('Space')
  await page.mouse.down()
  await page.mouse.move(at.x - 60, at.y + 40, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  const panned = await offset()
  check(panStart !== panned, 'Space + drag pans the canvas')
  // Space is still down when the window loses focus (a key-up the page never sees).
  await page.keyboard.down('Space')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await frame.locator('body').evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForTimeout(300)
  const held = await page.locator('[data-canvas-stage]').evaluate(el => getComputedStyle(el).cursor)
  check(held !== 'grab' && held !== 'grabbing', `after a blur the hand is released (cursor ${held})`)
  const afterBlur = await offset()
  await select(a)
  const alphaAt = await center(frame.locator(`[data-node="${a}"]`))
  await page.mouse.move(alphaAt.x, alphaAt.y)
  await page.mouse.down()
  await page.mouse.move(alphaAt.x + 30, alphaAt.y + 30, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  check(await offset() === afterBlur, 'and the next drag no longer pans the canvas (the key-up was never seen)')
  await page.keyboard.up('Space')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
