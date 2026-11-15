/**
 * The design system on the module editor (port of e2e/design.mjs): the theme colour and spacing
 * density through actions and through the Design view, and a responsive style set on Tablet (written
 * as `md:`). Each edit is checked in `.bildr/theme.json` or the page file, and the colours are checked
 * on the canvas and in the running app next to the editor.
 *
 * Dropped:
 * - Publish and `/p/<slug>`: the running app (`nuxt dev`) replaces the published copy; the same
 *   checks (theme colour, `md:text-center`) run against it.
 */
import { action, appShows, bildr, canvas, check, openEditor, renderApp, run, scene, seedFrames, shot, toView, until } from './lib.mjs'

/** The computed style property of the first element matching `selector` in a frame or page. */
const computed = (scope, selector, prop) => scope.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop)

const themeOf = () => bildr('theme.json')

await run('design', async ({ page, browser, errors }) => {
  const s = await scene('design')
  // The Tablet edit needs its frame (a project opens with its Primary only).
  await seedFrames(page)
  const boxId = await s.ins({ type: 'Container', style: { bg: 'primary', p: '4' } })
  const textId = await s.ins({ parentId: boxId, type: 'Text', props: { text: 'Designed by e2e' } })
  const boxSel = `[data-node="${boxId}"]`

  // Through actions.
  await action('theme_update', { colors: { primary: 'rose' }, spacing: 'compact' })
  let theme = themeOf()
  check(theme.colors.primary === 'rose' && theme.spacing === 'compact', 'theme_update sets primary and density in theme.json')

  await openEditor(page, s.file)
  const frame = canvas(page)
  const rose = await computed(frame, boxSel, 'backgroundColor')
  const compactPadding = await computed(frame, boxSel, 'paddingTop')
  check(compactPadding === '12.8px', `compact density: p-4 = ${compactPadding} (12.8px)`)

  // Through the UI: the Design view (the canvas stays mounted behind it).
  await toView(page, 'Design')
  await page.locator('[data-theme-color="primary"]').click()
  await page.getByRole('option', { name: 'emerald', exact: true }).click()
  theme = await until(() => themeOf().colors.primary === 'emerald' && themeOf())
  const emerald = await until(async () => {
    const bg = await computed(frame, boxSel, 'backgroundColor')
    return bg !== rose && bg
  })
  check(theme && emerald, `picking emerald updates theme.json and recolours bg-primary (${rose} → ${emerald})`)

  await page.getByLabel('Spacing density').click()
  await page.getByRole('option', { name: 'Comfortable · 4.8px', exact: true }).click()
  const comfortable = await until(async () => {
    const padding = await computed(frame, boxSel, 'paddingTop')
    return themeOf().spacing === 'comfortable' && padding === '19.2px' && padding
  })
  check(comfortable, `Spacing density comfortable: p-4 = ${comfortable} (19.2px)`)

  // A responsive style on Tablet (the blog is mobile-first, so Tablet is `md:`).
  await toView(page, 'Canvas')
  await page.locator('[data-frame="tablet"] [data-frame-label]').click()
  await until(async () => (await page.locator('iframe[title="Canvas"]').getAttribute('data-device')) === 'tablet')
  await canvas(page).locator(`[data-node="${textId}"]`).click()
  await page.locator('[data-inspector-head]').filter({ hasText: textId }).waitFor()
  await page.locator('[data-style-row="align"] button[aria-label="Center"]').click()
  const style = await until(() => {
    const node = s.node(textId)
    return node?.style?.['md:align'] === 'center' && node.style
  })
  check(style && style.align === undefined, `Tablet writes md:align only (${JSON.stringify(style)})`)
  await shot(page, 'design-editor')

  // The running app next to the editor (what Publish and /p/<slug> showed in the hosted editor).
  const live = await appShows(browser, s.path, 'Designed by e2e')
  check(live.html.includes('Designed by e2e'), 'the running app renders the text at the page\'s path')
  check(live.html.includes('md:text-center'), 'the generated page carries md:text-center')
  const generatedBg = (await renderApp(browser, s.path)).html.match(/bg-primary/) !== null
  check(generatedBg, 'the running app uses bg-primary (the theme colour)')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
