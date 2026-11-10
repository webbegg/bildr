/**
 * Remote paging (S35.4) against the Rick and Morty API: Test on /character
 * proposes a Next link paging (info.next) with the total (info.count), Save
 * keeps it and the table loads "50 of 826 items", Load more gives 100, and
 * the Endpoints panel's Paging rows (total path, Test, type, Detect) save.
 */
import { action, check, openEditor, project, run, shot, toView, until } from './lib.mjs'

const API = 'https://rickandmortyapi.com/api'
const NEXT = { type: 'next', nextPath: 'info.next', totalPath: 'info.count' }

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The API rate-limits by address and answers 429 for a while after bursts.
 * Runs `step` until `done`; when the records error or a test result shows
 * the 429 it waits and runs `retry` (Refresh, or the step again), at most 4
 * times.
 */
async function served(page, label, step, done, retry = step) {
  const limited = () => page.locator('[data-records-error], [data-paging-result], [data-api-error]').filter({ hasText: 'HTTP 429' }).count()
  await step()
  for (let attempt = 1; ; attempt++) {
    const outcome = await until(async () => ((await done()) ? 'done' : (await limited()) ? 'limited' : null), 30_000)
    if (outcome !== 'limited' || attempt === 4) return outcome === 'done'
    console.log(`NOTE ${label}: the API answered 429, retrying`)
    await page.waitForTimeout(5000)
    await retry()
  }
}

await run('paging', async ({ page, errors }) => {
  const p = await project('paging')
  await openEditor(page, p.id)
  await toView(page, 'Data')

  await page.getByLabel('Add synced data').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'New connection' }).click()
  const nameField = page.getByLabel('New connection name')
  await nameField.fill('Rick')
  await nameField.press('Enter')
  await until(async () => (await action('project_get', { projectId: p.id })).connections?.[0])
  const baseUrl = page.getByLabel('Base URL')
  await baseUrl.fill(API)
  await baseUrl.press('Enter')
  await until(async () => (await action('project_get', { projectId: p.id })).connections[0].baseUrl === API)

  // Test proposes the paging.
  await page.getByLabel('Add a collection to Rick').click()
  await page.locator('[data-connection-source] [data-endpoint-path="list"]').fill('/character')
  const detected = page.locator('[data-connection-source] [data-paging-detected]')
  const testList = () => page.locator('[data-connection-source] [data-endpoint-test="list"]').click()
  await served(page, 'Test', testList, () => detected.isVisible())
  const proposal = (await detected.innerText()).trim()
  check(proposal === 'Paging detected: Next link (info.next) · total at info.count', `Test proposes "${proposal}"`)
  const row = page.locator('[data-connection-source] [data-form-row="Paging"]')
  check(/Page 2: 20 items/.test(await row.innerText()), `Test reads page 2 ("${(await row.innerText()).replace(/\s+/g, ' ').trim()}")`)
  check(await page.locator('[data-connection-source] [data-paging-use]').getAttribute('aria-checked') === 'true', 'the paging switch is on by default')
  await shot(page, 'paging-detected')

  // Edit: another type and back keeps the paths.
  await page.locator('[data-connection-source] [data-paging-edit]').click()
  const editType = page.locator('[data-paging-editor] [data-paging-type]')
  await editType.click()
  await page.getByRole('option', { name: 'Page number', exact: true }).click()
  await detected.filter({ hasText: 'Paging: Page number (page) · total at info.count' }).waitFor()
  check(true, `Edit switches the type ("${(await detected.innerText()).trim()}")`)
  await editType.click()
  await page.getByRole('option', { name: 'Next link', exact: true }).click()
  await detected.filter({ hasText: 'Paging: Next link (info.next) · total at info.count' }).waitFor()
  check(true, 'switching back to Next link keeps info.next and info.count')

  // Save keeps the paging; the table loads 50 of 826.
  const count = page.locator('[data-records-count]')
  const countIs = (text, rows) => async () => (await count.innerText()).trim() === text && (rows === undefined || (await page.locator('[data-record]').count()) === rows)
  const refresh = async () => {
    await page.locator('[data-records-more]').click()
    await page.locator('[role^=menuitem]').filter({ hasText: 'Refresh' }).click()
  }
  const first = await served(page, 'Save', () => page.locator('[data-api-save]').click(), countIs('50 of 826 items', 50), refresh)
  const characters = (await action('project_get', { projectId: p.id })).collections.find(c => c.source.type === 'connection')
  check(same(characters?.source.endpoints.list.paging, NEXT), `Save collection keeps the paging (${JSON.stringify(characters?.source.endpoints.list.paging)})`)
  check(first, `the table shows "${(await count.innerText()).trim()}" with ${await page.locator('[data-record]').count()} rows`)
  check(await page.locator('[data-records-loaded-hint]').isVisible(), 'a hint says search, filters and sort use the loaded items')
  await shot(page, 'paging-table')

  const more = await served(page, 'Load more', () => page.locator('[data-records-load-more]').click(), countIs('100 of 826 items', 100))
  check(more, `Load more shows "${(await count.innerText()).trim()}" with ${await page.locator('[data-record]').count()} rows`)

  // The Paging rows in the Endpoints panel.
  const saved = async () => (await action('project_get', { projectId: p.id })).collections.find(c => c.id === characters.id).source.endpoints.list.paging
  const total = page.locator('[data-paging-field="totalPath"]')
  const unknown = await served(page, 'Total path', async () => {
    await total.fill('')
    await total.press('Enter')
  }, countIs('100 loaded · more available'), refresh)
  check(same(await saved(), { type: 'next', nextPath: 'info.next' }), `clearing Total path saves (${JSON.stringify(await saved())})`)
  check(unknown, `without a total the count reads "${(await count.innerText()).trim()}"`)

  const result = page.locator('[data-paging-result]')
  const tested = await served(page, 'Test page 2', () => page.locator('[data-paging-test]').click(), async () => (await result.count()) && (await result.innerText()).trim() === 'Page 2: 20 items')
  check(tested, `Test reads "${(await result.innerText()).trim()}"`)

  await served(page, 'None', async () => {
    await page.locator('[data-paging-type]').click()
    await page.getByRole('option', { name: 'None', exact: true }).click()
  }, countIs('20 items'), refresh)
  check((await saved()) === undefined && (await page.locator('[data-paging-field]').count()) === 0, 'the type select saves None and hides the fields')

  const redetected = await served(page, 'Detect', () => page.locator('[data-paging-detect]').click(), async () => same(await saved(), NEXT) && (await result.innerText()).includes('Next link (info.next)') && await countIs('50 of 826 items')())
  check(same(await saved(), NEXT), `Detect saves the proposal again (${JSON.stringify(await saved())})`)
  check(redetected, `Detect reads "${(await result.innerText()).trim()}" and the table restarts at "${(await count.innerText()).trim()}"`)
  await shot(page, 'paging-panel')

  check(errors.length === 0, `no console errors besides the API's 429s${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/HTTP 429/] })
