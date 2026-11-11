/**
 * A screenshot tour and checks of the P1 panel model (not part of all.mjs):
 * empty sections collapse to their title and "+" (#9), auto sizes show the
 * measured px greyed (#11), the panel order follows the node (#16) and the
 * choice menus have two-line items (#17). Shots go to e2e/.shots/panel-p1/.
 */
import { action, check, openEditor, project, run, shot, until } from './lib.mjs'

// After the menus' open animation.
const snap = async (page, name) => {
  await page.waitForTimeout(300)
  await shot(page, `panel-p1/${name}`)
}

await run('panel-p1', async ({ page, errors }) => {
  const p = await project('panel p1')
  const { pages } = await action('project_get', { projectId: p.id })
  const pageId = pages[0].id
  const column = await action('node_insert', { projectId: p.id, pageId, type: 'Column' })
  await action('node_insert', { projectId: p.id, pageId, parentId: column.nodeId, type: 'Text', props: { text: 'Hello panel' } })
  const button = await action('node_insert', { projectId: p.id, pageId, parentId: column.nodeId, type: 'Button', props: { label: 'Go' } })

  await openEditor(page, p.id)
  await page.getByRole('tab', { name: 'Layers' }).click()
  const select = async (id) => {
    await page.locator(`[data-layer-id="${id}"]`).first().click()
    await page.locator('[data-inspector-head]').filter({ hasText: id }).waitFor()
    await page.waitForTimeout(400)
  }
  const section = name => page.locator(`[data-style-section="${name}"]`)

  // #9 and #11 on a container: Typography collapses; W/H show the measured px.
  await select(column.nodeId)
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

  // #16: an actionable node leads with Behaviour; #17: the Action options explain themselves.
  await select(button.nodeId)
  const groups = await page.locator('[data-prop-group]').evaluateAll(els => els.map(el => el.getAttribute('data-prop-group')))
  check(groups[0] === 'Behaviour', `a Button's prop groups start with Behaviour (${groups.join(', ')})`)
  await page.getByRole('combobox', { name: 'Action' }).click()
  await page.getByRole('option').filter({ hasText: 'Sends the enclosing Form' }).waitFor()
  check(true, 'the Action options are two-line items')
  await snap(page, 'button-action')
  await page.keyboard.press('Escape')

  // #16: the page root (picked from the breadcrumb) leads with Page, then Layout.
  await page.locator('[data-inspector-breadcrumb] [data-crumb-id]').first().click()
  await page.locator('[data-style-section="Page"]').waitFor()
  await page.waitForTimeout(400)
  const sections = await page.locator('[data-style-section]').evaluateAll(els => els.map(el => el.getAttribute('data-style-section')))
  check(sections[0] === 'Page' && sections[1] === 'Layout', `the page root shows Page, then Layout (${sections.join(', ')})`)
  await page.getByLabel('Page layout').click()
  await page.getByRole('option').filter({ hasText: 'The page renders on its own' }).waitFor()
  check(true, 'the layout choices are two-line items')
  await snap(page, 'page-root-layout')
  await page.keyboard.press('Escape')

  check(!errors.length, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
