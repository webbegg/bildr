/**
 * A screenshot tour of the editor chrome for visual polish passes (not part
 * of all.mjs): the projects page, the canvas with the inspector, Settings and
 * Variables, the Data table and Fields tab, a connection, its endpoints with
 * paging, the theme editor and ⌘K. Shots go to e2e/.shots/polish/<PHASE>-*.png
 * (PHASE defaults to "after"). It also checks the T62 fixes: the density
 * labels and the endpoint path fit.
 */
import { action, BASE, check, openEditor, project, run, shot, toView } from './lib.mjs'

const PHASE = process.env.PHASE || 'after'
const snap = (page, name) => shot(page, `polish/${PHASE}-${name}`)

/** Whether an element's text is cut off (it scrolls inside its box). */
const clipped = locator => locator.evaluate(el => el.scrollWidth > el.clientWidth + 1)

await run('polish', async ({ page, errors }) => {
  const p = await project('polish')
  const { pages } = await action('project_get', { projectId: p.id })
  await action('node_insert', { projectId: p.id, pageId: pages[0].id, type: 'Heading', props: { text: 'Welcome' } })
  await action('collection_create', { projectId: p.id, name: 'Menu', fields: [{ key: 'name', type: 'text' }, { key: 'price', type: 'number' }, { key: 'vegan', type: 'boolean' }] })
  for (const [name, price, vegan] of [['Latte', 3.5, true], ['Mocha', 4, false]]) {
    await action('record_create', { projectId: p.id, collection: 'menu', values: { name, price, vegan } })
  }
  const { connectionId } = await action('connection_create', { projectId: p.id, name: 'Rick', baseUrl: 'https://rickandmortyapi.com/api' })
  await action('collection_create', {
    projectId: p.id,
    name: 'Characters',
    fields: [{ key: 'name', type: 'text', path: 'name' }],
    source: { type: 'connection', connectionId, endpoints: { list: { method: 'GET', path: '/character', itemsPath: 'results', paging: { type: 'next', nextPath: 'info.next', totalPath: 'info.count' } }, get: { method: 'GET', path: '/character/{id}' } } }
  })
  await action('env_set', { projectId: p.id, name: 'GREETING', value: 'hello' })

  await page.goto(`${BASE}/`)
  await page.locator('[data-projects-search]').waitFor()
  await snap(page, 'projects')

  await openEditor(page, p.id)
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.locator('[data-layer-id]').filter({ hasText: 'Heading' }).last().click()
  await page.waitForTimeout(400)
  await snap(page, 'canvas-inspector')

  await toView(page, 'Design')
  await page.locator('[data-theme-color="primary"]').waitFor()
  await snap(page, 'theme')
  const density = page.getByLabel('Spacing density')
  await density.click()
  for (const option of await page.getByRole('option').all()) {
    const label = (await option.innerText()).trim()
    await option.click()
    await density.filter({ hasText: label }).waitFor()
    const spans = await density.locator('span').all()
    const cut = await Promise.all(spans.map(clipped))
    check(!cut.some(Boolean), `Spacing density "${label}" fits`)
    await density.click()
  }
  await page.getByRole('option', { name: /^Default/ }).click()
  await snap(page, 'theme-density')
  await toView(page, 'Canvas')

  await page.locator('body').press('Control+k')
  await page.locator('[data-quick-actions]').waitFor()
  await snap(page, 'cmdk')
  await page.keyboard.press('Escape')

  await toView(page, 'Settings')
  await page.locator('[data-settings-name]').waitFor()
  await snap(page, 'settings')
  await page.locator('[data-env-row="GREETING"]').scrollIntoViewIfNeeded()
  await snap(page, 'variables')

  await toView(page, 'Data')
  await page.locator('[data-collection="menu"]').click()
  await page.locator('[data-record]').first().waitFor()
  await snap(page, 'data-table')
  await page.getByRole('tab', { name: 'Fields' }).click()
  await page.waitForTimeout(300)
  await snap(page, 'data-fields')
  await page.getByRole('tab', { name: 'Collections' }).click()

  await page.locator(`[data-connection="${connectionId}"] [data-connection-name]`).click()
  await page.getByLabel('Base URL').waitFor()
  await snap(page, 'connection')

  await page.locator('[data-collection="characters"]').click()
  const path = page.locator('[data-endpoint-path="list"]')
  await path.waitFor()
  await page.waitForTimeout(1500)
  await snap(page, 'endpoints')
  const fits = await path.evaluate((el) => {
    const input = el.matches('input') ? el : el.querySelector('input')
    return input.scrollWidth <= input.clientWidth + 1 && input.clientWidth >= 90
  })
  check(fits, 'the List path "/character" fits its field')

  check(errors.filter(e => !/HTTP 429|rate limiting/.test(e)).length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/HTTP 429/, /rate limiting/] })
