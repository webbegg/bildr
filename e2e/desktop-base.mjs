/**
 * Desktop-first projects (S37; run by all.mjs): a project made from the
 * projects page is desktop-first and opens with the Desktop frame only, the
 * Primary (`Primary · 1024+`); the frame bar's "+" adds Tablet, which edits
 * `max-lg:` keys: text alignment set there is stored as `max-lg:align`
 * (checked with project_get), shows on the canvas's Tablet frame and not on
 * Desktop, and the published app centres the text at 800 px but not at
 * 1280 px. Shots go to e2e/.shots/desktop-base/.
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
  check(JSON.stringify(await rows()) === '["desktop"]', `the Layers root rows are Desktop only (${await rows()})`)
  check(await rangeOf('desktop') === 'Primary · 1024+', `the Desktop row reads "Primary · 1024+" (${await rangeOf('desktop')})`)
  await shot(page, 'desktop-base/desktop-only')

  // "+" adds Tablet, which becomes the edited frame, 768 wide.
  await page.locator('[data-frame="desktop"] [data-frame-add] button').click()
  for (const option of ['Tablet 768', 'Large phone 640', 'Mobile 390']) check(await menuItem(option).count() === 1, `"+" offers ${option}`)
  await menuItem('Tablet 768').click()
  check(!!await until(async () => JSON.stringify(await frames()) === '["desktop","tablet"]'), `"+" adds the Tablet frame (${await frames()})`)
  check(!!await until(async () => JSON.stringify(await rows()) === '["desktop","tablet"]'), `Tablet joins the Layers rows (${await rows()})`)
  check(await rangeOf('tablet') === '1023—768', `the Tablet row reads "1023—768" (${await rangeOf('tablet')})`)
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

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
