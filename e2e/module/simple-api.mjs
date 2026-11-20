/**
 * An API made and used in the simple Data section (simple data, S4, S5, S6): from the APIs section's "+" a "Stub shop" API is made against a
 * local stub (lib.mjs `stubRest`: `/posts`, `/posts/:id`, `POST /posts`), its base URL checked as it is typed, its sign-in (a bearer token) shown
 * with the env var to set and "Not set", never a value. In its panel a query "list posts" is tried, "Use this answer" makes the model Post and
 * fills in what the query answers (a list at `items`), and Save writes it; a query "post by id" gets its `:id` parameter from the path; an
 * action "add post" gets its body model from a sample (a clash with Post asks, and keeps both), is tried only after the confirmation of a real
 * POST (cancelled first: the stub sees nothing) and the stub then holds the new post. A model a query uses can't be deleted (the module's
 * words), the settings are edited and saved, and after a reload everything is still there. Every step is checked in `.bildr/datasources/`.
 * The only JSON typed is the sample body an action is tried with: no model file is edited by hand, and no JSON tab is opened.
 * Shots go to e2e/module/.shots/.
 */
import { bildr, check, openSimpleData, quiet, run, settled, shot, stubRest, until } from './lib.mjs'

const FILE = 'datasources/stub-shop.json'
const ID = 'ds_stub_shop'

/** The words the simple section never uses: the workspace's and the code's. */
const JARGON = /\b(state|composable|collection|entity|artifact|datasource|data source)\b/i

/** Everything the user can read on the page: its text (dialogs included) and its labels, titles and placeholders. */
const said = page => page.evaluate(() => [
  document.body.innerText,
  ...[...document.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap(element => ['aria-label', 'title', 'placeholder'].map(name => element.getAttribute(name) ?? ''))
].join(' '))

const plain = async (page, what) => {
  const words = await said(page)
  check(!JARGON.test(words), `${what} is in plain words (${JARGON.exec(words)?.[0] ?? ''})`)
  check(!/\buse[A-Z][A-Za-z0-9]+/.test(words), `${what} names no generated composable`)
}

/** A change of an API regenerates the app's API layer and Nitro rebuilds, and the module answers 503 meanwhile: waits until it has settled. */
const calm = async () => {
  await quiet()
  await settled()
}

/** JSON with the keys in order, so two values that say the same compare equal whatever order the file wrote them in. */
const canon = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1)) : item)

/** Picks the option whose text starts with `label` in the kit select that carries `hook`. */
const pick = async (page, hook, label) => {
  await page.locator(`[${hook}]`).first().click()
  await page.getByRole('option', { name: label }).first().click()
}

await run('simple-api', async ({ page }) => {
  const stub = await stubRest({ count: 5 })
  try {
    await openSimpleData(page)

    // The "+" of the APIs section opens the dialog; the base URL is checked as it is typed, with the module's words.
    await page.locator('[data-simple-section="apis"] [data-simple-new-api]').click()
    await page.locator('[data-artifact-dialog="create"]').waitFor()
    await page.locator('[data-api-new-name]').fill('Stub shop')
    await page.locator('[data-api-new-url]').fill('stub')
    await page.locator('[data-api-new-url-error]').waitFor()
    check((await page.locator('[data-api-new-url-error]').innerText()).includes('is not an absolute URL'), 'a base URL that is not one is refused as it is typed, in the module\'s words')
    check(await page.locator('[data-artifact-submit]').isDisabled(), 'and Create is off')
    await page.locator('[data-api-new-url]').fill(stub.url)
    check(await page.locator('[data-api-new-url-error]').count() === 0 && await page.locator('[data-artifact-submit]').isEnabled(), 'a good base URL clears the refusal')
    const runtimes = (await page.locator('[data-api-new-runtime]').allInnerTexts()).join(' | ')
    check(runtimes.includes('On the server (can use a secret key)') && runtimes.includes('In the visitor\'s browser (no secret key)'), `it asks where it runs, in plain words (${runtimes.replace(/\s+/g, ' ')})`)
    await page.locator('[data-api-new-signin="bearer"]').click()
    await plain(page, 'the New API dialog')
    await shot(page, 'simple-api-new')
    await page.locator('[data-artifact-submit]').click()
    const made = await until(() => bildr(FILE))
    check(made?.id === ID && made.kind === 'api' && made.baseUrl === stub.url && made.runtime === 'server' && made.auth?.type === 'bearer', `Create writes the API: its base URL, run on the server, a bearer sign-in (${JSON.stringify(made)})`)
    check(made && !JSON.stringify(made).includes('secret-value') && Object.values(made.env ?? {}).every(name => /^[A-Z0-9_]+$/.test(name)), 'and the file holds only the names of its env vars')
    await page.locator(`[data-simple-api-panel="${ID}"]`).waitFor()
    check(await until(() => decodeURIComponent(page.url()).endsWith(`#/data?item=api:${ID}`)), 'the new API opens, and is in the URL')
    await calm()

    // The secret: the variable to set, and that it is not set. Never a value.
    const variable = (await page.locator('[data-api-secret-var]').innerText()).trim()
    check(variable === made.env[made.auth.secret] && variable.startsWith('NUXT_APIS_'), `the panel names the env var of the secret (${variable})`)
    check((await page.locator('[data-api-secret-status]').innerText()).trim() === 'Not set', 'and says it is not set')
    check(await page.locator('input[type="password"]').count() === 0, 'and has no field to type the secret in')
    await plain(page, 'the API\'s panel')
    await shot(page, 'simple-api-panel')

    // The settings: no sign-in, saved with Save; only what changed is written.
    await page.locator('[data-api-signin="none"]').click()
    check((await page.locator('[data-simple-api-unsaved]').innerText()) === 'Unsaved changes' && bildr(FILE).auth?.type === 'bearer', 'a change of the sign-in is unsaved until Save')
    await page.locator('[data-simple-api-save]').click()
    check(await until(() => bildr(FILE)?.auth === undefined), 'Save writes the API with no sign-in')
    check(await until(async () => await page.locator('[data-api-secret]').count() === 0), 'and the secret\'s box goes')
    await calm()

    // A query: its name, its path, Try it, Use this answer, Save.
    await page.locator('[data-api-new="query"]').click()
    await page.locator('[data-artifact-dialog="create"]').waitFor()
    await page.locator('[data-api-item-name]').fill('list posts')
    await page.locator('[data-artifact-submit]').click()
    await page.locator('[data-api-editor="query:listPosts"]').waitFor()
    await page.locator('[data-op-path]').fill('/posts')
    await page.locator('[data-try-run]').click()
    await page.locator('[data-try-status]').waitFor()
    check((await page.locator('[data-try-status]').innerText()).includes('200'), 'Try it shows the status')
    check((await page.locator('[data-try-items]').innerText()).includes('5 items') && (await page.locator('[data-try-items]').innerText()).includes('items'), `and the list it found (${await page.locator('[data-try-items]').innerText()})`)
    check(stub.calls.some(call => call.method === 'GET' && call.path === '/posts'), 'the stub got the call')
    check(await page.locator('[data-try-json]').evaluate(element => !element.open), 'the answer is folded')
    await page.locator('[data-try-json] summary').click()
    check((await page.locator('[data-try-json] pre').innerText()).includes('Post 1'), 'and shows the answer when opened')
    await plain(page, 'the query editor after Try it')
    await shot(page, 'simple-api-query-try')
    await page.locator('[data-try-use]').click()
    const post = await until(() => bildr(FILE)?.models?.find(model => model.name === 'Post') && bildr(FILE).models.find(model => model.name === 'Post'))
    check(post && post.fields.map(field => `${field.name}:${field.type}`).join() === 'id:integer,title:text,body:text', `Use this answer makes the model Post (${JSON.stringify(post?.fields)})`)
    check((await page.locator('[data-op-result-model]').innerText()).includes('Post') && await page.locator('[data-op-result-items]').inputValue() === 'items', 'and fills in what the query answers: Post, a list at items')
    check(bildr(FILE).queries.length === 0, 'the query itself is not written before Save')
    await page.locator('[data-simple-op-save]').click()
    const query = await until(() => bildr(FILE)?.queries?.[0])
    check(canon(query) === canon({ name: 'listPosts', path: '/posts', params: [], result: { model: 'Post', many: true, itemsPath: 'items' } }), `Save writes the query (${JSON.stringify(query)})`)

    // A second query: the path makes its parameter.
    await page.locator('[data-api-back]').click()
    await page.locator('[data-api-new="query"]').click()
    await page.locator('[data-api-item-name]').fill('post by id')
    await page.locator('[data-artifact-submit]').click()
    await page.locator('[data-api-editor="query:postById"]').waitFor()
    await page.locator('[data-op-path]').fill('/posts/:id')
    check(await page.locator('[data-op-param="path:id"]').count() === 1, 'a :id in the path makes the parameter id')
    await pick(page, 'data-op-param-type', 'Whole number')
    await page.locator('[data-try-input="id"]').fill('3')
    await page.locator('[data-try-run]').click()
    await page.locator('[data-try-status]').waitFor()
    check(stub.calls.some(call => call.method === 'GET' && call.path === '/posts/3'), 'Try it filled the parameter into the path')
    await page.locator('[data-try-use]').click()
    check(await until(async () => (await page.locator('[data-op-result-model]').innerText()).includes('Post')), 'Use this answer takes the model that says the same, and asks nothing')
    await page.locator('[data-simple-op-save]').click()
    const byId = await until(() => bildr(FILE)?.queries?.find(entry => entry.name === 'postById'))
    check(canon(byId) === canon({ name: 'postById', path: '/posts/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Post', many: false } }), `and Save writes it (${JSON.stringify(byId)})`)

    // An action: its body model from a sample, a clash with Post that keeps both, Try it with the confirmation.
    await page.locator('[data-api-back]').click()
    await page.locator('[data-api-new="action"]').click()
    await page.locator('[data-api-item-name]').fill('add post')
    await page.locator('[data-artifact-submit]').click()
    await page.locator('[data-api-editor="action:addPost"]').waitFor()
    check((await page.locator('[data-op-method-hint]').innerText()).includes('Adds something new'), 'a new action is a POST, and says what a POST does')
    await page.locator('[data-op-path]').fill('/posts')
    await page.locator('[data-op-body-sample-toggle]').click()
    await page.locator('[data-op-body-sample]').fill('{"title": "Hello", "body": "World"}')
    await page.locator('[data-op-body-sample-use]').click()
    await page.locator('[data-proposal-conflict="Post"]').waitFor()
    check((await page.locator('[data-proposal-conflict="Post"]').innerText()).includes('already exists'), 'a sample whose model has the name of Post asks what to do')
    await plain(page, 'the question of a model that exists')
    await page.locator('[data-proposal-choice="rename"]').click()
    await page.locator('[data-proposal-rename]').fill('New post')
    await page.locator('[data-proposal-apply]').click()
    const fresh = await until(() => bildr(FILE)?.models?.find(model => model.name === 'NewPost'))
    check(fresh?.fields.map(field => field.name).join() === 'title,body' && bildr(FILE).models.find(model => model.name === 'Post').fields.length === 3, 'keeping both makes NewPost and leaves Post as it was')
    check(await until(async () => (await page.locator('[data-op-body-model]').innerText()).includes('NewPost')), 'and the action\'s body is NewPost')
    await pick(page, 'data-op-result-model', 'Post')
    await page.locator('[data-simple-op-save]').click()
    const action = await until(() => bildr(FILE)?.actions?.[0])
    check(canon(action) === canon({ name: 'addPost', method: 'POST', path: '/posts', params: [], body: { model: 'NewPost' }, result: { model: 'Post', many: false } }), `Save writes the action (${JSON.stringify(action)})`)

    const before = stub.posts.size
    await page.locator('[data-try-body]').fill('{"title": "From the editor", "body": "Hi"}')
    await page.locator('[data-try-run]').click()
    await page.locator('[data-confirm]').waitFor()
    const sentence = await page.locator('[role="dialog"]').innerText()
    check(sentence.includes(`This sends a real POST to ${new URL(stub.url).host}: it can change data there`), `Try it asks before a real write (${sentence.replace(/\s+/g, ' ').slice(0, 120)})`)
    await plain(page, 'the confirmation of a real write')
    await shot(page, 'simple-api-confirm')
    await page.locator('[data-confirm-cancel]').click()
    await page.locator('[data-confirm]').waitFor({ state: 'detached' })
    check(stub.posts.size === before && !stub.calls.some(call => call.method === 'POST'), 'cancelled: the stub got nothing')
    await page.locator('[data-try-run]').click()
    await page.locator('[data-confirm]').waitFor()
    await page.locator('[data-confirm-ok]').click()
    await page.locator('[data-try-status]').waitFor()
    check((await page.locator('[data-try-status]').innerText()).includes('201') && stub.posts.size === before + 1 && [...stub.posts.values()].some(row => row.title === 'From the editor'), 'confirmed: the POST was sent and the stub holds the new post')

    // A model a query uses can't be deleted; its refusal is the module's, in plain words.
    await page.locator('[data-api-back]').click()
    await page.locator('[data-api-item="model:Post"] [data-api-delete]').click()
    await page.locator('[data-artifact-dialog="delete"]').waitFor()
    await page.locator('[data-artifact-submit]').click()
    await page.locator('[data-artifact-error]').waitFor()
    const refused = await page.locator('[data-artifact-error]').innerText()
    check(/^Post is used by the quer/.test(refused) && refused.includes('listPosts') && refused.includes('addPost'), `a model a query uses can't be deleted (${refused})`)
    await plain(page, 'a refused delete')
    check(bildr(FILE).models.some(model => model.name === 'Post'), 'and it is still there')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    // A model's editor: a field added and saved with its own Save.
    await page.locator('[data-api-item="model:NewPost"] [data-api-open]').click()
    await page.locator('[data-api-editor="model:NewPost"]').waitFor()
    await page.locator('[data-model-field-add]').click()
    await page.locator('[data-model-field]').last().locator('[data-model-field-name]').fill('draft')
    await page.locator('[data-model-field]').last().locator('[data-model-field-optional]').check()
    await shot(page, 'simple-api-model')
    await page.locator('[data-simple-model-save]').click()
    const grown = await until(() => bildr(FILE)?.models?.find(model => model.name === 'NewPost')?.fields.length === 3 && bildr(FILE).models.find(model => model.name === 'NewPost'))
    check(grown?.fields.at(-1)?.name === 'draft' && grown.fields.at(-1).optional === true, `Save writes the field, which may be missing (${JSON.stringify(grown?.fields.at(-1))})`)
    await page.locator('[data-api-back]').click()

    // Reload: everything is there, with no JSON edited.
    await calm()
    await page.reload()
    await page.locator(`[data-simple-api-panel="${ID}"]`).waitFor({ timeout: 30_000 })
    const lists = async name => (await page.locator(`[data-api-section="${name}"] [data-api-item]`).evaluateAll(rows => rows.map(row => row.getAttribute('data-api-item')))).join()
    check(await lists('queries') === 'query:listPosts,query:postById' && await lists('actions') === 'action:addPost' && await lists('models') === 'model:Post,model:NewPost', `after a reload the API shows its queries, its action and its models (${await lists('queries')} ${await lists('actions')} ${await lists('models')})`)
    check(await page.locator('[data-api-baseurl]').inputValue() === stub.url, 'and its base URL')
    await shot(page, 'simple-api-after-reload')

    // Delete the API: after asking.
    await page.locator('[data-simple-api-delete]').click()
    await page.locator('[data-artifact-dialog="delete"]').waitFor()
    await page.locator('[data-artifact-submit]').click()
    check(await until(() => bildr(FILE) === undefined), 'Delete removes the API\'s file')
    check(await until(async () => await page.locator(`[data-simple-api="${ID}"]`).count() === 0), 'and its row')
  } finally {
    await stub.close()
  }
})
