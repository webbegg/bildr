/**
 * The design system: the theme colour and spacing density through actions
 * and through Assets › Styles, a responsive style set on Tablet (written as
 * `md:`), then Publish and `/p/<slug>`, which renders the text with the
 * theme colour.
 */
import { action, BASE, canvas, check, openEditor, project, run, shot, until } from './lib.mjs'

/** The computed style property of the first element matching `selector` in a frame or page. */
const computed = (scope, selector, prop) => scope.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop)

const themeOf = async projectId => (await action('theme_get', { projectId })).theme

await run('design', async ({ page, context, errors }) => {
  const p = await project('design')
  const pageId = p.pages[0].id
  const box = await action('node_insert', { projectId: p.id, pageId, type: 'Container', style: { bg: 'primary', p: '4' } })
  const text = await action('node_insert', { projectId: p.id, pageId, parentId: box.nodeId, type: 'Text', props: { text: 'Designed by e2e' } })
  const boxSel = `[data-bildr-id="${box.nodeId}"]`

  // Through actions.
  await action('theme_update', { projectId: p.id, colors: { primary: 'rose' }, spacing: 'compact' })
  let theme = await themeOf(p.id)
  check(theme.colors.primary === 'rose' && theme.spacing === 'compact', 'theme_update sets primary and density')

  await openEditor(page, p.id)
  const frame = canvas(page)
  const rose = await computed(frame, boxSel, 'backgroundColor')
  const compactPadding = await computed(frame, boxSel, 'paddingTop')
  check(compactPadding === '12.8px', `compact density: p-4 = ${compactPadding} (12.8px)`)

  // Through the UI: Assets › Styles.
  await page.getByRole('tab', { name: 'Assets' }).click()
  await page.locator('[data-theme-color="primary"]').click()
  await page.getByRole('option', { name: 'emerald', exact: true }).click()
  theme = await until(async () => {
    const t = await themeOf(p.id)
    return t.colors.primary === 'emerald' && t
  })
  const emerald = await until(async () => {
    const bg = await computed(frame, boxSel, 'backgroundColor')
    return bg !== rose && bg
  })
  check(theme && emerald, `picking emerald updates the theme and recolours bg-primary (${rose} → ${emerald})`)

  await page.getByRole('button', { name: 'comfortable', exact: true }).click()
  const comfortable = await until(async () => {
    const t = await themeOf(p.id)
    const padding = await computed(frame, boxSel, 'paddingTop')
    return t.spacing === 'comfortable' && padding === '19.2px' && padding
  })
  check(comfortable, `Spacing density comfortable: p-4 = ${comfortable} (19.2px)`)

  // A responsive style on Tablet.
  await page.getByRole('button', { name: 'Tablet', exact: true }).click()
  await until(async () => (await page.locator('iframe[title="Canvas"]').getAttribute('data-device')) === 'tablet')
  await canvas(page).locator(`[data-bildr-id="${text.nodeId}"]`).click()
  await page.locator('[data-inspector-head]').filter({ hasText: text.nodeId }).waitFor()
  await page.locator('[data-style-row="align"] button[aria-label="Center"]').click()
  const style = await until(async () => {
    const doc = await action('project_get', { projectId: p.id })
    const node = doc.pages[0].root.children[0].children[0]
    return node.style['md:align'] === 'center' && node.style
  })
  check(style && style.align === undefined, `Tablet writes md:align only (${JSON.stringify(style)})`)

  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await until(() => action('project_published_info', { projectId: p.id }))
  await shot(page, 'design-editor')

  // The published app.
  const live = await context.newPage()
  await live.goto(`${BASE}/p/${p.slug}`)
  const published = live.locator(`[data-bildr-id="${text.nodeId}"]`)
  await published.filter({ hasText: 'Designed by e2e' }).waitFor()
  check(true, '/p/<slug> renders the text')
  const liveBg = await computed(live, boxSel, 'backgroundColor')
  check(liveBg === emerald, `the published bg-primary uses the theme colour (${liveBg})`)
  const align = await published.evaluate(el => ({ cls: el.className, align: getComputedStyle(el).textAlign }))
  check(align.cls.includes('md:text-center') && align.align === 'center', `the published text carries md:text-center (${align.align})`)
  await shot(live, 'design-published')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
