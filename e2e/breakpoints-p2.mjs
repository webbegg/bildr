/**
 * Checks of breakpoints in the Layers tree and show/hide frames (#21, S7; run
 * by all.mjs): a mobile-first project opens with the Mobile frame only and
 * no device rows, and the frame bar's "+" adds Tablet and Desktop; then
 * the Layers root rows are the visible frames with their width
 * ranges and the Primary tag, the page tree under the edited one; clicking a
 * row edits that device; the frame bar's "+" adds Large phone (640, `sm`),
 * whose frame is 640 wide and whose canvas edits write `sm:` keys; ⌥ + digit
 * follows the visible frames; a frame hidden from its bar's right-click menu
 * stays hidden after a reload; the Primary can't be hidden.
 * Shots go to e2e/.shots/breakpoints-p2/.
 */
import { action, canvas, check, openEditor, project, run, shot, until } from './lib.mjs'

await run('breakpoints-p2', async ({ page }) => {
  const p = await project('breakpoints p2')
  const { pages } = await action('project_get', { projectId: p.id })
  const pageId = pages[0].id
  const text = (await action('node_insert', { projectId: p.id, pageId, type: 'Text', props: { text: 'Breakpoint text' } })).nodeId
  const styleOf = async () => {
    const root = (await action('project_get', { projectId: p.id })).pages[0].root
    return root.children.find(n => n.id === text)?.style ?? {}
  }

  await openEditor(page, p.id)
  await page.getByRole('tab', { name: 'Layers' }).click()
  const rows = () => page.locator('[data-frame-row]').evaluateAll(els => els.map(el => el.getAttribute('data-frame-row')))
  const row = id => page.locator(`[data-frame-row="${id}"]`)
  const rangeOf = id => row(id).locator('[data-frame-row-range]').innerText()
  const treeUnder = id => page.locator(`[data-frame-row="${id}"] + [role="group"] [data-layer-id="${text}"]`)
  const editing = id => page.locator('iframe[title="Canvas"]').getAttribute('data-device').then(v => v === id)
  const frames = () => page.locator('[data-frame]').evaluateAll(els => els.map(el => el.getAttribute('data-frame')))
  const menuItem = label => page.locator('[role^=menuitem]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })

  // Every project opens with its Primary only: Mobile, and no device rows in Layers.
  check(JSON.stringify(await frames()) === '["mobile"]', `a mobile-first project opens with the Mobile frame only (${await frames()})`)
  check(JSON.stringify(await rows()) === '[]', `with one frame Layers shows no device row (${await rows()})`)
  await page.locator('[data-frame="mobile"] [data-frame-add] button').click()
  for (const option of ['Desktop 1280', 'Tablet 768', 'Large phone 640']) check(await menuItem(option).count() === 1, `"+" offers ${option}`)
  await menuItem('Tablet 768').click()
  check(!!await until(async () => JSON.stringify(await frames()) === '["tablet","mobile"]'), `"+" adds the Tablet frame (${await frames()})`)
  await page.locator('[data-frame="tablet"] [data-frame-add] button').click()
  await menuItem('Desktop 1280').click()
  check(!!await until(async () => JSON.stringify(await frames()) === '["desktop","tablet","mobile"]'), `"+" adds the Desktop frame (${await frames()})`)
  await row('mobile').click()
  check(!!await until(() => editing('mobile')), 'clicking the Mobile row edits Mobile again')
  // Each added frame is panned into view; fit all three, as the editor fits the frames it opens with.
  await page.locator('[data-canvas-stage]').hover({ position: { x: 10, y: 10 } })
  await page.keyboard.press('Shift+Digit1')

  // S7a: the visible frames are root rows, in frame order, with their ranges and the Primary tag.
  check(JSON.stringify(await rows()) === '["desktop","tablet","mobile"]', `the Layers root rows are the shown frames (${await rows()})`)
  check(await rangeOf('desktop') === '1024+', `Desktop shows its range (${await rangeOf('desktop')})`)
  check(await rangeOf('tablet') === '1023—768', `Tablet shows "1023—768" (${await rangeOf('tablet')})`)
  check(await rangeOf('mobile') === 'Primary', `Mobile carries the Primary tag (${await rangeOf('mobile')})`)
  check(await row('mobile').getAttribute('aria-selected') === 'true', 'the edited device (Mobile) is the selected root row')
  check(await treeUnder('mobile').count() === 1, 'the page tree sits under the edited device')
  await shot(page, 'breakpoints-p2/layers-rows')

  // Clicking a row edits that device; the tree moves under it.
  await row('tablet').click()
  check(!!await until(() => editing('tablet')), 'clicking the Tablet row switches the edited device')
  check(await page.locator('iframe[title="Canvas"]').getAttribute('data-device') === 'tablet', 'the Tablet frame becomes the active canvas')
  check(!!await until(async () => await treeUnder('tablet').count() === 1 && await treeUnder('mobile').count() === 0), 'the page tree moves under Tablet')

  // S7b: "+" adds Large phone back; it becomes the edited frame, 640 wide.
  check(JSON.stringify(await frames()) === '["desktop","tablet","mobile"]', `the canvas shows the shown frames (${await frames()})`)
  await page.locator('[data-frame="desktop"] [data-frame-add] button').click()
  await menuItem('Large phone 640').click()
  check(!!await until(async () => JSON.stringify(await rows()) === '["desktop","tablet","large-phone","mobile"]'), `"+" adds Large phone as a root row (${await rows()})`)
  check(await rangeOf('large-phone') === '767—640', `Large phone shows "767—640" (${await rangeOf('large-phone')})`)
  check(JSON.stringify(await frames()) === '["desktop","tablet","large-phone","mobile"]', `the canvas shows its frame in order (${await frames()})`)
  check(!!await until(() => editing('large-phone')), 'the added frame is the edited one')
  const frame = canvas(page)
  check(await frame.locator('body').evaluate(() => window.innerWidth) === 640, 'the Large phone canvas is 640 wide')
  check(!!await until(async () => await frame.getByText('Breakpoint text').count() > 0), 'the added frame renders the page')
  await shot(page, 'breakpoints-p2/large-phone-added')

  // ⌥ + digit counts the visible frames.
  await page.locator('[data-canvas-stage]').hover({ position: { x: 10, y: 10 } })
  await page.keyboard.press('Alt+Digit4')
  check(!!await until(() => editing('mobile')), '⌥4 edits Mobile with four frames shown')
  await page.keyboard.press('Alt+Digit3')
  check(!!await until(() => editing('large-phone')), '⌥3 edits Large phone')

  // An edit at Large phone writes an sm: key (a resize handle drag on its canvas).
  await page.locator(`[data-layer-id="${text}"]`).first().click()
  const handles = frame.locator('[data-resize-handle]')
  check(!!await until(async () => await handles.count() === 8), 'the text is selected on the Large phone canvas')
  const box = await frame.locator('[data-resize-handle="e"]').boundingBox()
  const east = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(east.x, east.y)
  await page.mouse.down()
  await page.mouse.move(east.x + 60, east.y, { steps: 8 })
  await page.mouse.up()
  const style = await until(async () => {
    const s = await styleOf()
    return s['sm:w'] ? s : null
  })
  check(!!style, `the resize at Large phone writes sm:w (${JSON.stringify(style ?? await styleOf())})`)
  check(!!style && style.w === undefined && style['md:w'] === undefined, 'and no base or md key')

  // Hiding a frame from its bar's right-click menu; it stays hidden after a reload.
  await page.locator('[data-frame="tablet"] [data-frame-bar-row]').click({ button: 'right' })
  await menuItem('Hide Tablet').click()
  check(!!await until(async () => !(await frames()).includes('tablet')), 'Hide Tablet removes its frame')
  check(JSON.stringify(await rows()) === '["desktop","large-phone","mobile"]', `and its Layers row (${await rows()})`)
  await openEditor(page, p.id)
  await page.getByRole('tab', { name: 'Layers' }).click()
  check(!!await until(async () => JSON.stringify(await rows()) === '["desktop","large-phone","mobile"]'), `after a reload Tablet stays hidden and Large phone shown (${await rows()})`)
  check(JSON.stringify(await frames()) === '["desktop","large-phone","mobile"]', 'and so do the canvas frames')
  await page.locator('[data-canvas-stage]').hover({ position: { x: 10, y: 10 } })
  await page.keyboard.press('Alt+Digit2')
  check(!!await until(() => editing('large-phone')), '⌥2 now edits Large phone, the second visible frame')
  await shot(page, 'breakpoints-p2/tablet-hidden')

  // Hiding the edited frame from its Layers row goes back to the Primary.
  await row('large-phone').hover()
  await row('large-phone').locator('[data-frame-row-hide]').click()
  check(!!await until(async () => JSON.stringify(await rows()) === '["desktop","mobile"]'), 'the Layers row eye hides Large phone')
  check(!!await until(() => editing('mobile')), 'hiding the edited frame edits the Primary')

  // The Primary can't be hidden.
  check(await row('mobile').locator('[data-frame-row-hide]').count() === 0, 'the Primary row has no hide button')
  await page.locator('[data-frame="mobile"] [data-frame-bar-row]').click({ button: 'right' })
  const primaryItem = menuItem('The Primary frame stays visible')
  check(await primaryItem.count() === 1 && await primaryItem.getAttribute('data-disabled') !== null, 'the Primary frame menu offers no hide')
  check(await menuItem('Hide Mobile').count() === 0, 'there is no "Hide Mobile"')
  await shot(page, 'breakpoints-p2/primary-menu')
  await page.keyboard.press('Escape')
  check((await frames()).includes('mobile'), 'the Primary frame stays')
})
