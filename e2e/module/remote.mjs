/**
 * Remote data on the module editor (port of e2e/remote.mjs): a REST connection made in the Data screen
 * (its name field stays open and focused, L75), its base URL and bearer secret (an env var name, never
 * a value), a `/posts` collection made with Test, the Create, Update and Delete endpoints, and the table
 * listing the remote rows through the running app. Every edit is checked in `.bildr/` (data source,
 * entity, repository). The API is a local stub (lib.mjs `stubRest`), so the suite needs no network.
 *
 * Dropped:
 * - Settings › Variables with a public GREETING and a secret API_TOKEN (`env_list`, masked values): the
 *   module keeps no values (`env_status` only names the variables and whether they are set; values live in
 *   `.env`), so there is nothing to type or mask; the Settings screen is checked for that read-only status;
 * - the `{{ env.NAME }}` custom header (the hosted connection's header list): a module data source has
 *   one `auth` (bearer or header, secret from an env var), which is what this script sets;
 * - quick-add, inline edit and delete in the table, and the check that the secret never reaches a
 *   response (records and secrets are not editor data: the table is read-only, and the secret has no value
 *   in the module to leak; the model file is checked for it instead).
 */
import { action, bildr, bildrFiles, call, check, openData, quiet, run, shot, stubRest, until } from './lib.mjs'

await run('remote', async ({ page, errors }) => {
  const stub = await stubRest()
  try {
    await openData(page)

    // A connection; its new name field stays open (L75).
    await page.getByLabel('Add connection').click()
    await page.locator('[role^=menuitem]').filter({ hasText: 'New connection' }).click()
    const nameField = page.getByLabel('New connection name')
    await nameField.waitFor()
    await page.waitForTimeout(800) // the L75 bug closed the field ~500 ms after it opened
    const stays = await nameField.isVisible() && await nameField.evaluate(el => el === document.activeElement)
    check(stays, 'the new connection name stays open and focused')
    await nameField.fill('placeholder')
    await nameField.press('Enter')
    const source = await until(() => bildr('datasources/placeholder.json'))
    check(source?.kind === 'rest', `New connection writes the data source file (${source?.id}, ${source?.kind})`)

    const baseUrl = page.getByLabel('Base URL')
    await baseUrl.fill(stub.url)
    await baseUrl.press('Enter')
    const saved = await until(() => bildr('datasources/placeholder.json')?.defaults?.baseUrl === stub.url && bildr('datasources/placeholder.json'))
    check(saved, 'the data source saves the base URL')

    // A bearer secret: only the env var's name goes in the model.
    await page.getByLabel('Auth type').click()
    await page.getByRole('option', { name: /bearer/i }).first().click()
    const auth = await until(() => bildr('datasources/placeholder.json')?.auth?.type === 'bearer' && bildr('datasources/placeholder.json').auth)
    check(auth, `the data source has bearer auth (${JSON.stringify(auth)})`)
    const secretName = auth?.secret ?? auth?.env
    check(!JSON.stringify(bildr('datasources/placeholder.json')).includes('e2e-secret'), `only the env var's name is in the model (${secretName})`)

    // A data source changes the app's config: nuxt restarts, and the editor's actions answer 503 until it is back.
    await quiet()
    await until(async () => (await call('health_get')).ok, 60_000)

    // A /posts collection, tested in the dialog (the connection's Add… opens New collection on REST API, which Continue takes on).
    await page.getByLabel('Add a collection to placeholder').click()
    await page.locator('[data-artifact-submit]').click()
    await page.locator('[data-connection-source] [data-endpoint-path="list"]').fill('/posts')
    await page.locator('[data-connection-source] [data-endpoint-test="list"]').click()
    const status = page.locator('[data-endpoint-status]')
    await status.filter({ hasText: '200' }).waitFor({ timeout: 20_000 })
    check(true, `Test answers ${(await status.innerText()).replace(/\s+/g, ' ').trim()}`)
    check(stub.calls.some(call => call.method === 'GET' && call.path === '/posts'), 'the Test reached the API')
    await shot(page, 'remote-test')
    // The blog already has a Post: the new collection gets its own name.
    await page.locator('[data-api-name]').fill('Remote post')
    await page.locator('[data-api-save]').click()
    const posts = await until(() => bildr('modules/blog/entities/remote-post.json'))
    check(posts?.name === 'RemotePost' || posts?.name === 'Remote post', `Save collection writes an entity ("${posts?.name}": ${posts?.fields?.map(f => f.name)})`)
    const repo = bildrFiles('modules/blog/repositories/').map(path => bildr(path)).find(r => JSON.stringify(r).includes(source.id))
    check(!!repo, `its repository reads the data source (${JSON.stringify(repo)?.slice(0, 160)})`)

    // The table lists the remote rows through the app's own route.
    // (the app regenerates and restarts for the new route first: refresh until it answers)
    await quiet()
    await until(async () => {
      await page.locator('[aria-label="Refresh"]').first().click().catch(() => {})
      return (await page.locator('[data-record]').count()) > 0
    }, 60_000)
    check(await page.locator('[data-record]').count() > 0, `the table lists the remote posts (${await page.locator('[data-record]').count()})`)
    await shot(page, 'remote-table')

    // Settings: the secret has no value in the module, only its status.
    const env = await action('env_status')
    const secretVar = env.variables.find(entry => entry.datasource === source.id && entry.secret)
    check(!!secretVar && secretVar.set === false && !('value' in secretVar), `env_status names the secret variable (${secretVar?.name}) as not set, with no value`)
  } finally {
    await stub.close()
  }
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
// A data source restarts the dev server: its event stream and requests in flight end.
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/, /status of 503/] })
