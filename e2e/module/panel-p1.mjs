/**
 * A screenshot tour and checks of the P1 panel model on the module editor (port of e2e/panel-p1.mjs):
 * empty sections collapse to their title and "+" (#9), auto sizes show the measured px greyed (#11),
 * the panel order follows the node (#16) and the choice menus have two-line items (#17). Shots go to
 * e2e/module/.shots/panel-p1/. (Nothing here edits, so there is no file to check.)
 */
import { check, openEditor, run, scene, shot, until } from './lib.mjs'

// After the menus' open animation.
const snap = async (page, name) => {
  await page.waitForTimeout(300)
  await shot(page, `panel-p1/${name}`)
}

await run('panel-p1', async ({ page, errors }) => {
  const s = await scene('panel-p1')
  const column = await s.ins({ type: 'Column' })
  await s.ins({ parentId: column, type: 'Text', props: { text: 'Hello panel' } })
  const button = await s.ins({ parentId: column, type: 'Button', props: { text: 'Go' } })

  await openEditor(page, s.file)
  await page.getByRole('tab', { name: 'Layers' }).click()
  const select = async (id) => {
    await page.locator(`[data-layer-id="${id}"]`).first().click()
    await page.locator('[data-inspector-head]').filter({ hasText: id }).waitFor()
    await page.waitForTimeout(400)
  }
  const section = name => page.locator(`[data-style-section="${name}"]`)

  // #9 and #11 on a container: Typography collapses; W/H show the measured px.
  await select(column)
  check(await section('Typography').getAttribute('data-collapsed') === 'true', 'a Column\'s Typography collapses to its title and "+"')
  check(await section('Layout').getAttribute('data-collapsed') === null, 'a Column\'s Layout shows its rows')
  const width = page.locator('[data-style-row="w"] input')
  const measured = await until(async () => /^\d+$/.test(await width.getAttribute('placeholder') ?? '') && await width.getAttribute('placeholder'))
  check(!!measured, `the auto Width shows the measured px greyed (${measured})`)
  await snap(page, 'column')

  await section('Typography').locator('[data-section-action="add"]').click()
  await page.locator('[role=menuitem]').filter({ hasText: 'Text color' }).waitFor()
  check(await page.locator('[role=menuitem]').filter({ hasText: 'Children inherit it' }).count() > 0, 'the Typography "+" items have a second line')
  await snap(page, 'column-typography-menu')
  await page.keyboard.press('Escape')

  // #16: an actionable node leads with Behaviour; #17: the Type options (the hosted "Action": the module's Button `type`) explain themselves.
  await select(button)
  const groups = await page.locator('[data-prop-group]').evaluateAll(els => els.map(el => el.getAttribute('data-prop-group')))
  check(groups[0] === 'Behaviour', `a Button's prop groups start with Behaviour (${groups.join(', ')})`)
  await page.getByRole('combobox', { name: 'Type' }).click()
  const submit = page.getByRole('option').filter({ hasText: 'Sends the enclosing Form' })
  await submit.waitFor()
  const submitLines = await submit.evaluate(el => el.innerText.split('\n').map(line => line.trim()).filter(Boolean))
  check(submitLines.length === 2 && submitLines[1].startsWith('Sends the enclosing Form'), `the Type options are two-line items (${submitLines.join(' / ')})`)
  await snap(page, 'button-action')
  await page.keyboard.press('Escape')

  // #16: the page root (picked from the breadcrumb) leads with Page, then Layout.
  await page.locator('[data-inspector-breadcrumb] [data-crumb-id]').first().click()
  await page.locator('[data-style-section="Page"]').waitFor()
  await page.waitForTimeout(400)
  const sections = await page.locator('[data-style-section]').evaluateAll(els => els.map(el => el.getAttribute('data-style-section')))
  // The module's page root also has a `tag` prop (Advanced), which the hosted root lacks: it sits between Page and Layout.
  check(sections[0] === 'Page' && sections.indexOf('Layout') > 0 && sections.indexOf('Layout') < sections.indexOf('Size'), `the page root shows Page first, then Layout before the other style sections (${sections.join(', ')})`)
  await page.getByLabel('Page layout').click()
  const alone = page.getByRole('option').filter({ hasText: 'The page renders on its own' })
  await alone.waitFor()
  const aloneLines = await alone.evaluate(el => el.innerText.split('\n').map(line => line.trim()).filter(Boolean))
  check(aloneLines.length === 2 && aloneLines[1].startsWith('The page renders on its own'), `the layout choices are two-line items (${aloneLines.join(' / ')})`)
  await snap(page, 'page-root-layout')
  await page.keyboard.press('Escape')

  check(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
