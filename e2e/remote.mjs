/**
 * Remote data: a public and a secret variable in Settings › Variables, a
 * connection to jsonplaceholder (which fakes writes) with a `{{ env.NAME }}`
 * header, its `/posts` collection made with Test, the Create, Update and
 * Delete endpoints, then quick-add, inline edit and delete in the table.
 * The new connection's name stays open (log L75), and the secret value never
 * appears in any JSON or HTML response the browser receives.
 */
import { action, actionResponse, check, openEditor, project, run, shot, toView, until } from './lib.mjs'

const API = 'https://jsonplaceholder.typicode.com'

await run('remote', async ({ page, context, errors }) => {
  const p = await project('remote')
  const secret = `e2e-secret-${Math.random().toString(36).slice(2)}`

  // Every JSON or HTML body the browser receives, checked for the secret at the end.
  const bodies = []
  context.on('response', (response) => {
    const type = response.headers()['content-type'] ?? ''
    if (/json|html/.test(type)) bodies.push(response.text().then(text => ({ url: response.url(), text }), () => null))
  })
  page.on('dialog', dialog => dialog.accept())

  await openEditor(page, p.id)

  // Variables.
  await toView(page, 'Settings')
  for (const [name, value, isSecret] of [['GREETING', 'hello-public', false], ['API_TOKEN', secret, true]]) {
    await page.locator('[data-env-add]').click()
    await page.locator('[data-env-new-name]').fill(name)
    await page.locator('[data-env-new-value]').fill(value)
    if (isSecret) await page.locator('[data-env-new-secret]').click()
    await page.locator('[data-env-new-save]').click()
    await page.locator(`[data-env-row="${name}"]`).waitFor()
  }
  const env = await action('env_list', { projectId: p.id })
  const byName = Object.fromEntries((env.variables ?? env).map(v => [v.name, v]))
  check(byName.GREETING?.value === 'hello-public' && !byName.GREETING.secret, 'Settings adds the public GREETING')
  check(byName.API_TOKEN?.secret && byName.API_TOKEN.value === undefined, 'Settings adds the secret API_TOKEN (write-only)')
  check(await page.locator('[data-env-row="API_TOKEN"] [data-env-masked]').count() === 1, 'the secret shows masked')

  // A connection; its new name field stays open (L75).
  await toView(page, 'Data')
  await page.getByLabel('Add synced data').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'New connection' }).click()
  const nameField = page.getByLabel('New connection name')
  await nameField.waitFor()
  await page.waitForTimeout(800) // the L75 bug closed the field ~500 ms after it opened
  const stays = await nameField.isVisible() && await nameField.evaluate(el => el === document.activeElement)
  check(stays, 'the new connection name stays open and focused')
  await nameField.fill('Placeholder')
  await nameField.press('Enter')
  const connection = await until(async () => (await action('project_get', { projectId: p.id })).connections?.[0])
  check(connection?.name === 'Placeholder', 'New connection creates "Placeholder"')

  const baseUrl = page.getByLabel('Base URL')
  await baseUrl.fill(API)
  await baseUrl.press('Enter')
  await page.getByLabel('Add headers property').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Custom header' }).click()
  await page.getByLabel('Header name').fill('X-Api-Key')
  const value = page.locator('[data-header-value]')
  await value.fill('{{ env.API_TOKEN }}')
  await value.blur()
  const saved = await until(async () => {
    const c = (await action('project_get', { projectId: p.id })).connections[0]
    return c.baseUrl === API && c.headers[0]?.value === '{{ env.API_TOKEN }}' && c
  })
  check(saved?.headers[0]?.name === 'X-Api-Key', 'the connection saves the base URL and the {{ env.API_TOKEN }} header')

  // A /posts collection, tested in the dialog.
  await page.getByLabel('Add a collection to Placeholder').click()
  await page.locator('[data-connection-source] [data-endpoint-path="list"]').fill('/posts')
  await page.locator('[data-connection-source] [data-endpoint-test="list"]').click()
  const status = page.locator('[data-endpoint-status]')
  await status.filter({ hasText: '200' }).waitFor({ timeout: 20_000 })
  check(true, `Test answers ${(await status.innerText()).replace(/\s+/g, ' ').trim()}`)
  await page.locator('[data-api-save]').click()
  const posts = await until(async () => (await action('project_get', { projectId: p.id })).collections.find(c => c.source.type === 'connection'))
  check(posts?.name === 'Posts', `Save collection creates "Posts" (${posts?.fields.map(f => f.key)})`)

  for (const op of ['Create', 'Update', 'Delete']) {
    await page.getByLabel('Add endpoints property').click()
    await page.locator('[role^=menuitem]').filter({ hasText: op }).click()
    await page.locator(`[data-endpoint="${op.toLowerCase()}"]`).waitFor()
  }
  const endpoints = (await action('project_get', { projectId: p.id })).collections.find(c => c.id === posts.id).source.endpoints
  check(['create', 'update', 'delete'].every(op => endpoints[op]), `the Create, Update and Delete endpoints are added (${Object.entries(endpoints).map(([op, e]) => `${op} ${e.method} ${e.path}`).join(', ')})`)

  // The table: quick-add, inline edit, delete (jsonplaceholder fakes the writes).
  await page.locator('[data-record]').first().waitFor({ timeout: 20_000 })
  check(await page.locator('[data-record]').count() > 0, `the table lists the remote posts (${await page.locator('[data-record]').count()})`)

  const titleCol = posts.fields.findIndex(f => f.key === 'title')
  const quickAdd = page.getByLabel(`New item ${posts.fields[titleCol].label}`)
  const created = actionResponse(page, 'record_create')
  await quickAdd.fill('Posted by e2e')
  await quickAdd.press('Enter')
  const createdStatus = (await created)?.status()
  check(createdStatus === 200, `quick-add creates through the Create endpoint (${createdStatus})`)
  // The create reloads the list; wait for the reload before editing a cell.
  await until(async () => (await quickAdd.inputValue()) === '' && (await page.locator('[data-record]').count()) > 0, 20_000)

  const updated = actionResponse(page, 'record_update')
  await page.locator(`[data-cell="0-${titleCol}"]`).click({ timeout: 20_000 })
  await page.locator('[data-cell-input]').fill('Edited by e2e')
  await page.locator('[data-cell-input]').press('Enter')
  const updatedStatus = (await updated)?.status()
  check(updatedStatus === 200, `inline edit updates through the Update endpoint (${updatedStatus})`)

  const deleted = actionResponse(page, 'record_delete')
  await page.getByLabel('Select item 1', { exact: true }).click({ timeout: 20_000 })
  await page.keyboard.press('Delete')
  const deletedStatus = (await deleted)?.status()
  check(deletedStatus === 200, `delete removes through the Delete endpoint (${deletedStatus})`)
  await shot(page, 'remote-table')

  // The secret never reaches the browser.
  const seen = (await Promise.all(bodies)).filter(Boolean)
  const leaks = seen.filter(body => body.text.includes(secret)).map(body => body.url)
  check(seen.length > 10 && leaks.length === 0, `the secret is in none of ${seen.length} JSON/HTML responses${leaks.length ? `: ${leaks.join(', ')}` : ''}`)

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
