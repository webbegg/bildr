/**
 * Desktop-first projects on the module editor (port of e2e/desktop-base.mjs, S37). This script boots its
 * own project with `breakpointBase: desktop` in `.bildr/bildr.json` (the harness's `desktop` option):
 * it opens with the Desktop frame only, the Primary (`Primary · 1024+`), and with that single frame
 * Layers shows no device row, the page row on top; the frame bar's "+" adds Tablet (the Desktop and
 * Tablet rows appear in Layers), which edits `max-lg:` keys: text alignment set there is stored as
 * `max-lg:align` in the page file, shows on the canvas's Tablet frame and not on Desktop, and the
 * running app centres the text at 800 px but not at 1280 px. A mobile prefix is refused with the desktop
 * ones named. Hiding Tablet from its Layers row removes the device rows again. The canvas's floating bar
 * has no device buttons (Move, Hand │ theme, Zoom): devices are chosen on the frames. Shots go to
 * e2e/module/.shots/desktop-base/.
 *
 * Dropped:
 * - the projects page, "New project" and its Starting device control (Desktop by default, Mobile making a
 *   mobile-first project) and deleting that project: no project list; the mobile-first case is every other
 *   script's (the blog is mobile-first, see breakpoints-p2);
 * - Publish and `/p/<slug>` at 800 and 1280 px: the running app (`nuxt dev`) is checked at those widths.
 */
import { action, bildr, canvas, check, newPage, openApp, openEditor, run, shot, until } from './lib.mjs'

await run('desktop-base', async ({ page, browser, errors }) => {
  const created = await newPage('desktop-base')
  const rootId = created.nodeId
  const text = (await action('node_insert', { file: created.pageId, type: 'Text', props: { text: 'Desktop first text' } })).nodeId
  const nodeStyle = async () => bildr(created.filePath).root.children.find(n => n.id === text)?.style ?? {}
  check(bildr('bildr.json').breakpointBase === 'desktop', 'the project is desktop-first (bildr.json breakpointBase)')

  await openEditor(page, created.pageId)
  await canvas(page).locator(`[data-node="${text}"]`).waitFor()

  const frames = () => page.locator('[data-frame]').evaluateAll(els => els.map(el => el.getAttribute('data-frame')))
  const rows = () => page.locator('[data-frame-row]').evaluateAll(els => els.map(el => el.getAttribute('data-frame-row')))
  const rangeOf = id => page.locator(`[data-frame-row="${id}"] [data-frame-row-range]`).innerText()
  const topRow = () => page.locator('[data-layers] [role="treeitem"]').first().evaluate(el => ({ id: el.getAttribute('data-layer-id'), level: el.getAttribute('aria-level'), pad: el.style.paddingLeft }))
  const editing = id => page.locator('iframe[title="Canvas"]').getAttribute('data-device').then(v => v === id)
  const bar = page.locator('[data-floating-bar]')
  const menuItem = label => page.locator('[role^=menuitem]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })

  // Only the Desktop frame, marked Primary, and it is the edited one.
  check(JSON.stringify(await frames()) === '["desktop"]', `the canvas shows the Desktop frame only (${await frames()})`)
  const label = await page.locator('[data-frame="desktop"] [data-frame-label]').getAttribute('aria-label')
  check(label === 'Desktop 1280 (Primary)', `the Desktop frame bar is the Primary (${label})`)
  // Devices are chosen on the canvas frames: the floating bar has no device buttons.
  const barButtons = await bar.locator('button').evaluateAll(els => els.map(el => el.getAttribute('aria-label')))
  check(await bar.locator('[data-device-switch]').count() === 0 && !barButtons.some(l => /^(Desktop|Tablet|Large phone|Mobile)$/.test(l ?? '')), `the floating bar has no device buttons (${barButtons})`)
  check(await bar.locator('[data-tool]').count() === 2 && await bar.locator('[data-preview-theme]').count() === 1 && await bar.locator('[data-zoom-menu]').count() === 1, 'the floating bar keeps Move, Hand, the theme toggle and zoom')
  check(await bar.locator('span[aria-hidden="true"].w-px').count() === 1, 'one divider, between the tools and the theme and zoom')
  check(await editing('desktop'), 'the editor starts on Desktop, the Primary')
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.locator(`[data-layer-id="${text}"]`).waitFor()
  check(JSON.stringify(await rows()) === '[]', `with one frame Layers shows no device row (${await rows()})`)
  const single = await topRow()
  check(single.id === rootId && single.level === '1' && single.pad === '4px', `the page row is the top of the Layers tree, unindented (${JSON.stringify(single)})`)
  check(await page.locator('[data-layers]').getByText('Desktop', { exact: true }).count() === 0, 'no "Desktop" row in Layers')
  // The tree still works: a row click selects the node on Desktop.
  await page.locator(`[data-layer-id="${text}"]`).click()
  check(!!await until(async () => await page.locator(`[data-layer-id="${text}"]`).getAttribute('aria-selected') === 'true'), 'a layer row click selects it with one frame')
  check(await editing('desktop'), 'and the tree edits Desktop, the only frame')
  await shot(page, 'desktop-base/desktop-only')

  // "+" adds Tablet, which becomes the edited frame, 768 wide.
  await page.locator('[data-frame="desktop"] [data-frame-add] button').click()
  for (const option of ['Tablet 768', 'Large phone 640', 'Mobile 390']) check(await menuItem(option).count() === 1, `"+" offers ${option}`)
  await menuItem('Tablet 768').click()
  check(!!await until(async () => JSON.stringify(await frames()) === '["desktop","tablet"]'), `"+" adds the Tablet frame (${await frames()})`)
  check(!!await until(async () => JSON.stringify(await rows()) === '["desktop","tablet"]'), `Tablet joins the Layers rows (${await rows()})`)
  check(await rangeOf('desktop') === 'Primary · 1024+', `the Desktop row reads "Primary · 1024+" (${await rangeOf('desktop')})`)
  check(await rangeOf('tablet') === '1023—768', `the Tablet row reads "1023—768" (${await rangeOf('tablet')})`)
  const multi = await page.locator(`[data-frame-row="tablet"] + [role="group"] [data-layer-id="${rootId}"]`).evaluate(el => el.getAttribute('aria-level')).catch(() => null)
  check(multi === '2', `the page tree sits one level in under the edited Tablet row (${multi})`)
  await shot(page, 'desktop-base/layers-multi')
  check(!!await until(() => editing('tablet')), 'the added Tablet frame is the edited one')
  const tablet = page.frameLocator('iframe[data-device="tablet"]')
  const desktop = page.frameLocator('iframe[data-device="desktop"]')
  check(await tablet.locator('body').evaluate(() => window.innerWidth) === 768, 'the Tablet canvas is 768 wide')
  await tablet.locator(`[data-node="${text}"]`).waitFor()

  // Text alignment edited at Tablet writes max-lg:align.
  await tablet.locator(`[data-node="${text}"]`).click()
  await page.locator('[data-inspector-head]').filter({ hasText: text }).waitFor()
  const editingCaption = await page.locator('[data-editing-breakpoint]').first().getAttribute('data-editing-breakpoint')
  check(editingCaption === 'max-lg', `the panel edits the max-lg breakpoint at Tablet (${editingCaption})`)
  await page.locator('[data-style-row="align"] button[aria-label="Center"]').click()
  const style = await until(async () => {
    const s = await nodeStyle()
    return s['max-lg:align'] === 'center' && s
  })
  check(style && style.align === undefined && !Object.keys(style).some(k => /^(sm|md|lg):/.test(k)), `Tablet writes max-lg:align only, in the page file (${JSON.stringify(style)})`)

  // The canvas: the Tablet frame centres the text, the Desktop frame does not.
  const alignIn = frame => frame.locator(`[data-node="${text}"]`).evaluate(el => ({ cls: el.className, align: getComputedStyle(el).textAlign }))
  const onTablet = await until(async () => {
    const a = await alignIn(tablet)
    return a.align === 'center' && a
  })
  check(onTablet && onTablet.cls.includes('max-lg:text-center'), `the canvas Tablet frame centres the text (${JSON.stringify(onTablet)})`)
  const onDesktop = await alignIn(desktop)
  check(onDesktop.align !== 'center', `the canvas Desktop frame does not (${onDesktop.align})`)
  await shot(page, 'desktop-base/tablet-override')

  // A mobile prefix is refused over the actions, naming the right ones.
  const refused = await action('node_update_style', { file: created.pageId, nodeId: text, style: { 'md:align': 'right' } }).then(() => null, e => e.message)
  check(/max-lg:, max-md: or max-sm:/.test(refused ?? ''), `a mobile prefix is refused with the desktop prefixes named (${refused})`)

  // The running app at 800 px (below 1024) and 1280 px.
  const alignAt = async (width) => {
    const context = await browser.newContext({ viewport: { width, height: 800 } })
    const live = await openApp(context, created.path)
    const el = live.locator('p', { hasText: 'Desktop first text' }).first()
    await el.waitFor({ timeout: 30_000 })
    const align = await el.evaluate(node => getComputedStyle(node).textAlign)
    await context.close()
    return align
  }
  const at800 = await until(async () => (await alignAt(800)) === 'center' && 'center', 60_000)
  check(at800 === 'center', `the running app centres the text at 800 px (${at800})`)
  const at1280 = await alignAt(1280)
  check(at1280 !== 'center', `the running app keeps the Desktop alignment at 1280 px (${at1280})`)

  // Hiding Tablet from its Layers row: back to one frame, no device rows.
  await page.bringToFront()
  await page.locator('[data-frame-row="tablet"]').hover()
  await page.locator('[data-frame-row="tablet"] [data-frame-row-hide]').click()
  check(!!await until(async () => JSON.stringify(await rows()) === '[]'), `hiding Tablet removes the device rows (${await rows()})`)
  const again = await topRow()
  check(again.id === rootId && again.level === '1', `the page row is on top again (${JSON.stringify(again)})`)
  check(!!await until(() => editing('desktop')), 'and Desktop is edited')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { desktop: true })
