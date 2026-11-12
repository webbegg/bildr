/**
 * Desktop-first projects (S37; run by all.mjs): a project made from the
 * projects page is desktop-first and opens with the Desktop frame only, the
 * Primary (`Primary · 1024+`), and with that single frame Layers shows no
 * device row, the page row on top; the frame bar's "+" adds Tablet (the
 * Desktop and Tablet rows appear in Layers), which edits
 * `max-lg:` keys: text alignment set there is stored as `max-lg:align`
 * (checked with project_get), shows on the canvas's Tablet frame and not on
 * Desktop, and the published app centres the text at 800 px but not at
 * 1280 px. Hiding Tablet from its Layers row removes the device rows again.
 * New project's Starting device (S38.1) is Desktop by default; choosing
 * Mobile makes a mobile-first project, with Mobile its Primary frame, which
 * the test then deletes. Shots go to e2e/.shots/desktop-base/.
 */
import { action, BASE, canvas, check, run, shot, track, until } from './lib.mjs'

await run('desktop-base', async ({ page, context, errors }) => {
  // A new project from the projects page.
  await page.goto(`${BASE}/`)
  await page.locator('[data-new-project]').click()
  const name = `e2e desktop base ${Date.now()}`
  await page.getByLabel('Project name').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.waitForURL(/\/editor\/[\w-]+$/)
  const projectId = page.url().split('/').pop()
  const created = await action('project_get', { projectId })
  track(created.id, created.slug)
  check(created.breakpointBase === 'desktop', `a new project is desktop-first (${created.breakpointBase})`)

  const pageId = created.pages[0].id
  const text = (await action('node_insert', { projectId, pageId, type: 'Text', props: { text: 'Desktop first text' } })).nodeId
  const styleOf = async () => (await action('project_get', { projectId })).pages[0].root.children.find(n => n.id === text)?.style ?? {}

  await page.locator('[data-view-menu]').waitFor()
  await canvas(page).locator(`[data-bildr-id="${text}"]`).waitFor()

  const frames = () => page.locator('[data-frame]').evaluateAll(els => els.map(el => el.getAttribute('data-frame')))
  const rows = () => page.locator('[data-frame-row]').evaluateAll(els => els.map(el => el.getAttribute('data-frame-row')))
  const rangeOf = id => page.locator(`[data-frame-row="${id}"] [data-frame-row-range]`).innerText()
  const rootId = created.pages[0].root.id
  const topRow = () => page.locator('[data-layers] [role="treeitem"]').first().evaluate(el => ({ id: el.getAttribute('data-layer-id'), level: el.getAttribute('aria-level'), pad: el.style.paddingLeft }))
  const switches = () => page.locator('[data-device-switch]').evaluateAll(els => els.map(el => el.getAttribute('data-device-switch')))
  const editing = id => page.locator(`[data-device-switch="${id}"]`).getAttribute('aria-pressed').then(v => v === 'true')
  const menuItem = label => page.locator('[role^=menuitem]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })

  // Only the Desktop frame, marked Primary, and it is the edited one.
  check(JSON.stringify(await frames()) === '["desktop"]', `the canvas shows the Desktop frame only (${await frames()})`)
  const label = await page.locator('[data-frame="desktop"] [data-frame-label]').getAttribute('aria-label')
  check(label === 'Desktop 1280 (Primary)', `the Desktop frame bar is the Primary (${label})`)
  check(JSON.stringify(await switches()) === '["desktop"]', `the floating bar switches Desktop only (${await switches()})`)
  check(await editing('desktop'), 'the editor starts on Desktop, the Primary')
  check(await page.locator('iframe[title="Canvas"]').getAttribute('data-device') === 'desktop', 'the active canvas is the Desktop frame')
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
  await shot(page, 'desktop-base/layers-single')

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
  await tablet.locator(`[data-bildr-id="${text}"]`).waitFor()

  // Text alignment edited at Tablet writes max-lg:align.
  await tablet.locator(`[data-bildr-id="${text}"]`).click()
  await page.locator('[data-inspector-head]').filter({ hasText: text }).waitFor()
  const editingCaption = await page.locator('[data-editing-breakpoint]').first().getAttribute('data-editing-breakpoint')
  check(editingCaption === 'max-lg', `the panel edits the max-lg breakpoint at Tablet (${editingCaption})`)
  await page.locator('[data-style-row="align"] button[aria-label="Center"]').click()
  const style = await until(async () => {
    const s = await styleOf()
    return s['max-lg:align'] === 'center' && s
  })
  check(style && style.align === undefined && !Object.keys(style).some(k => /^(sm|md|lg):/.test(k)), `Tablet writes max-lg:align only (${JSON.stringify(style)})`)

  // The canvas: the Tablet frame centres the text, the Desktop frame does not.
  const alignIn = frame => frame.locator(`[data-bildr-id="${text}"]`).evaluate(el => ({ cls: el.className, align: getComputedStyle(el).textAlign }))
  const onTablet = await until(async () => {
    const a = await alignIn(tablet)
    return a.align === 'center' && a
  })
  check(onTablet && onTablet.cls.includes('max-lg:text-center'), `the canvas Tablet frame centres the text (${JSON.stringify(onTablet)})`)
  const onDesktop = await alignIn(desktop)
  check(onDesktop.align !== 'center', `the canvas Desktop frame does not (${onDesktop.align})`)
  await shot(page, 'desktop-base/tablet-override')

  // A mobile prefix is refused over the actions, naming the right ones.
  const refused = await action('node_update_style', { projectId, pageId, nodeId: text, style: { 'md:align': 'right' } }).then(() => null, e => e.message)
  check(/use max-lg:, max-md: or max-sm:/.test(refused ?? ''), `a mobile prefix is refused with the desktop prefixes named (${refused})`)

  // The published app at 800 px (below 1024) and 1280 px.
  await action('project_publish', { projectId })
  const live = await context.newPage()
  const publishedAlign = async (width) => {
    await live.setViewportSize({ width, height: 800 })
    await live.goto(`${BASE}/p/${created.slug}`)
    const el = live.locator(`[data-bildr-id="${text}"]`)
    await el.filter({ hasText: 'Desktop first text' }).waitFor()
    return el.evaluate(node => getComputedStyle(node).textAlign)
  }
  const at800 = await publishedAlign(800)
  check(at800 === 'center', `the published app centres the text at 800 px (${at800})`)
  await shot(live, 'desktop-base/published-800')
  const at1280 = await publishedAlign(1280)
  check(at1280 !== 'center', `the published app keeps the Desktop alignment at 1280 px (${at1280})`)
  await shot(live, 'desktop-base/published-1280')
  await live.close()

  // Hiding Tablet from its Layers row: back to one frame, no device rows.
  await page.bringToFront()
  await page.locator('[data-frame-row="tablet"]').hover()
  await page.locator('[data-frame-row="tablet"] [data-frame-row-hide]').click()
  check(!!await until(async () => JSON.stringify(await rows()) === '[]'), `hiding Tablet removes the device rows (${await rows()})`)
  const again = await topRow()
  check(again.id === rootId && again.level === '1', `the page row is on top again (${JSON.stringify(again)})`)
  check(!!await until(() => editing('desktop')), 'and Desktop is edited')

  // Starting device Mobile on the projects page: a mobile-first project.
  await page.goto(`${BASE}/`)
  await page.locator('[data-new-project]').click()
  const baseChoice = page.locator('[data-new-project-base]')
  await baseChoice.waitFor()
  const pressed = () => baseChoice.locator('button[aria-pressed="true"]').getAttribute('aria-label')
  check(await pressed() === 'Desktop', `New project starts on Desktop (${await pressed()})`)
  const mobileName = `e2e mobile base ${Date.now()}`
  await page.getByLabel('Project name').fill(mobileName)
  await baseChoice.getByRole('button', { name: 'Mobile', exact: true }).click()
  check(!!await until(async () => await pressed() === 'Mobile'), 'Mobile can be chosen as the starting device')
  await shot(page, 'desktop-base/new-project-mobile')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.waitForURL(url => /\/editor\/[\w-]+$/.test(url.pathname) && !url.pathname.endsWith(projectId))
  const mobileId = page.url().split('/').pop()
  const mobile = await action('project_get', { projectId: mobileId })
  track(mobile.id, mobile.slug)
  check(mobile.name === mobileName && mobile.breakpointBase === 'mobile', `Starting device Mobile makes a mobile-first project (${mobile.breakpointBase})`)
  await page.locator('[data-view-menu]').waitFor()
  await page.locator('[data-frame="mobile"]').waitFor()
  const mobileLabel = await page.locator('[data-frame="mobile"] [data-frame-label]').getAttribute('aria-label')
  check(/^Mobile \d+ \(Primary\)$/.test(mobileLabel ?? ''), `the Mobile frame is the Primary (${mobileLabel})`)
  check(!!await until(() => editing('mobile')), 'the editor starts on Mobile, the Primary')
  check(!(await frames()).includes('large-phone'), `a mobile-first project keeps its default frames (${await frames()})`)
  await shot(page, 'desktop-base/mobile-project')
  await action('project_delete', { projectId: mobile.id, confirm: mobile.slug })
  const gone = await action('project_get', { projectId: mobile.id }).then(() => false, e => /404/.test(e.message))
  check(gone, 'the mobile-first project is deleted')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
