/**
 * An API made and used in the simple Data section (simple data, S4, S5, S6): from the APIs section's "+" a "Stub shop" API is made against a
 * local stub (lib.mjs `stubRest`: `/posts`, `/posts/:id`, `POST /posts`), its base URL checked as it is typed, its sign-in (a bearer token) shown
 * with the env var to set and "Not set", never a value. In its panel a query "list posts" is tried, "Use this answer" makes the model Post and
 * fills in what the query answers (a list at `items`), and Save writes it; a query "post by id" gets its `:id` parameter from the path; an
 * action "add post" gets its body model from a sample (a clash with Post asks, and keeps both), is tried only after the confirmation of a real
 * POST (cancelled first: the stub sees nothing) and the stub then holds the new post. A model a query uses can't be deleted (the module's
 * words), the settings are edited and saved, and after a reload everything is still there. Every step is checked in `.bildr/datasources/`.
 * The only JSON typed is the sample body an action is tried with: no model file is edited by hand, and no JSON tab is opened.
 * Every step that writes the API waits for the app to rebuild before the next live call, nothing is read straight after a fill (it waits for
 * what it expects), and the page that uses the API (page_delete, when it is still there) and the stub's API file are removed in the `finally`, so a failed run can't leave them for the next one.
 *
 * Use in a page (simple data P7b, SD-A): from the Design view a List's Items offers the query as "stub-shop · listPosts" (only one that
 * answers many rows), picking it adds the page's use and binds the List, and a Text inside it binds `post.title` from the braces menu. The canvas
 * shows three sample rows built from the model's fields, says "Sample data" and makes no call to the API; the generated app renders the
 * stub's five posts. In the Data section the query's row says which page uses it, and its Delete says so and is refused, naming the page.
 * Shots go to e2e/module/.shots/.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { action as editApp, app, appShows, bildr, call, canvas, check, editorUrl, newPage, openEditor, openSimpleData, quiet, run, settled, shot, stubRest, until } from './lib.mjs'

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

/** What the element says or holds right now, or '' while it is not there (for a wait that polls: `until`). */
const saysNow = (page, selector) => page.locator(selector).first().innerText({ timeout: 500 }).catch(() => '')
const holdsNow = (page, selector) => page.locator(selector).first().inputValue({ timeout: 500 }).catch(() => '')

/** The stub API's file and what removes it: the module's own delete when it answers, else the file itself (a run that failed half way). */
const removeStubApi = async () => {
  if (bildr(FILE) === undefined) return
  const answer = await call('datasource_delete', { datasource: ID }).catch(() => undefined)
  if (!answer?.ok) rmSync(join(app.root, '.bildr', FILE), { force: true })
}

/** The page that uses the API, when the run made it and it is still there: the module's own delete, else the file itself. */
const removeShopPage = async (shop) => {
  if (!shop || bildr(shop.filePath) === undefined) return
  const answer = await call('page_delete', { page: shop.pageId }).catch(() => undefined)
  if (!answer?.ok) rmSync(join(app.root, shop.filePath.startsWith('.bildr/') ? shop.filePath : `.bildr/${shop.filePath}`), { force: true })
}

/** JSON with the keys in order, so two values that say the same compare equal whatever order the file wrote them in. */
const canon = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1)) : item)

/** Picks the option whose text starts with `label` in the kit select that carries `hook`. */
const pick = async (page, hook, label) => {
  await page.locator(`[${hook}]`).first().click()
  await page.getByRole('option', { name: label }).first().click()
}

await run('simple-api', async ({ page, browser }) => {
  const stub = await stubRest({ count: 5 })
  // The page that uses the API, once it is made: the `finally` takes it off first, or its use would outlive the API it names.
  let shop
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
    await page.locator('[data-api-new-url-error]').waitFor({ state: 'detached' })
    await page.locator('[data-artifact-submit]').waitFor()
    check(await until(() => page.locator('[data-artifact-submit]').isEnabled()), 'a good base URL clears the refusal')
    check(await until(async () => (await saysNow(page, '[data-artifact-dialog] [data-form-row="Name"]')).includes('It will be called “stub-shop”')), 'the dialog says under the name what it will be called')
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
    await page.locator('[data-simple-api-unsaved]').waitFor()
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
    check(await page.locator('[data-answer-tree]').count() === 1, 'the answer shows as a tree')
    check(await page.locator('[data-answer-recommended]').count() === 1, 'with one list recommended')
    await page.locator('[data-answer-tabs] button[aria-label="Raw"]').click()
    check((await page.locator('[data-answer-raw]').innerText()).includes('Post 1'), 'and Raw shows the answer as it came')
    await page.locator('[data-answer-tabs] button[aria-label="Tree"]').click()
    await plain(page, 'the query editor after Try it')
    await shot(page, 'simple-api-query-try')
    await page.locator('[data-try-use]').click()
    const post = await until(() => bildr(FILE)?.models?.find(model => model.name === 'Post') && bildr(FILE).models.find(model => model.name === 'Post'))
    check(post && post.fields.map(field => `${field.name}:${field.type}`).join() === 'id:integer,title:text,body:text', `Use this answer makes the model Post (${JSON.stringify(post?.fields)})`)
    check(await until(async () => (await saysNow(page, '[data-op-result-model]')).includes('Post') && await holdsNow(page, '[data-op-result-items]') === 'items'), 'and fills in what the query answers: Post, a list at items')
    check(await until(async () => (await saysNow(page, '[data-simple-op-blocked]')) === 'Models added. Save to keep the query.'), 'and the footer says the models were added and that Save keeps the query')
    check(bildr(FILE).queries.length === 0, 'the query itself is not written before Save')
    await calm()
    await page.locator('[data-simple-op-save]').click()
    const query = await until(() => bildr(FILE)?.queries?.[0])
    check(canon(query) === canon({ name: 'listPosts', path: '/posts', params: [], result: { model: 'Post', many: true, itemsPath: 'items' } }), `Save writes the query (${JSON.stringify(query)})`)
    await calm()

    // A second query: the path makes its parameter.
    await page.locator('[data-api-back]').click()
    await page.locator('[data-api-new="query"]').click()
    await page.locator('[data-api-item-name]').fill('post by id')
    await page.locator('[data-artifact-submit]').click()
    await page.locator('[data-api-editor="query:postById"]').waitFor()
    await page.locator('[data-op-path]').fill('/posts/:id')
    await page.locator('[data-op-param="path:id"]').waitFor()
    check(await page.locator('[data-op-param="path:id"]').count() === 1, 'a :id in the path makes the parameter id')
    await pick(page, 'data-op-param-type', 'Whole number')
    await page.locator('[data-try-input="id"]').fill('3')
    await page.locator('[data-try-run]').click()
    await page.locator('[data-try-status]').waitFor()
    check(stub.calls.some(call => call.method === 'GET' && call.path === '/posts/3'), 'Try it filled the parameter into the path')
    await page.locator('[data-try-use]').click()
    check(await until(async () => (await saysNow(page, '[data-op-result-model]')).includes('Post')), 'Use this answer takes the model that says the same, and asks nothing')
    await page.locator('[data-simple-op-save]').click()
    const byId = await until(() => bildr(FILE)?.queries?.find(entry => entry.name === 'postById'))
    check(canon(byId) === canon({ name: 'postById', path: '/posts/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Post', many: false } }), `and Save writes it (${JSON.stringify(byId)})`)
    await calm()

    // An action: its body model from a sample, a clash with Post that keeps both, Try it with the confirmation.
    await page.locator('[data-api-back]').click()
    await page.locator('[data-api-new="action"]').click()
    await page.locator('[data-api-item-name]').fill('add post')
    await page.locator('[data-artifact-submit]').click()
    await page.locator('[data-api-editor="action:addPost"]').waitFor()
    check(await until(async () => (await saysNow(page, '[data-op-method-hint]')).includes('Adds something new')), 'a new action is a POST, and says what a POST does')
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
    check(await until(async () => (await saysNow(page, '[data-op-body-model]')).includes('NewPost')), 'and the action\'s body is NewPost')
    check(await until(async () => (await holdsNow(page, '[data-try-body]')) === '{"title": "Hello", "body": "World"}'), 'and Try it\'s body is the sample the model was made from')
    await calm()
    await pick(page, 'data-op-result-model', 'Post')
    await page.locator('[data-simple-op-save]').click()
    const action = await until(() => bildr(FILE)?.actions?.[0])
    check(canon(action) === canon({ name: 'addPost', method: 'POST', path: '/posts', params: [], body: { model: 'NewPost' }, result: { model: 'Post', many: false } }), `Save writes the action (${JSON.stringify(action)})`)
    await calm()

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
    await calm()
    await page.locator('[data-api-back]').click()

    // Reload: everything is there, with no JSON edited.
    await calm()
    await page.reload()
    await page.locator(`[data-simple-api-panel="${ID}"]`).waitFor({ timeout: 30_000 })
    const lists = async name => (await page.locator(`[data-api-section="${name}"] [data-api-item]`).evaluateAll(rows => rows.map(row => row.getAttribute('data-api-item')))).join()
    check(await lists('queries') === 'query:listPosts,query:postById' && await lists('actions') === 'action:addPost' && await lists('models') === 'model:Post,model:NewPost', `after a reload the API shows its queries, its action and its models (${await lists('queries')} ${await lists('actions')} ${await lists('models')})`)
    check(await until(async () => (await holdsNow(page, '[data-api-baseurl]')) === stub.url), 'and its base URL')
    await shot(page, 'simple-api-after-reload')

    // Use the query on a page from the Design view: a List of its own, and a Text in it.
    shop = await newPage('shop')
    const listId = (await editApp('node_insert', { file: shop.pageId, parentId: shop.nodeId, type: 'List', props: {} })).nodeId
    const textId = (await editApp('node_insert', { file: shop.pageId, parentId: listId, type: 'Text', props: { text: 'Title: ' } })).nodeId
    const shopFile = () => bildr(shop.filePath)
    await calm()
    const apiCalls = () => stub.calls.filter(entry => entry.method === 'GET' && entry.path === '/posts').length
    const callsBefore = apiCalls()
    await openEditor(page, shop.pageId)
    await page.getByRole('tab', { name: 'Layers' }).click()
    await page.locator(`[data-layer-id="${listId}"]`).first().click()
    const items = page.locator('[data-testid="list-items"]')
    await items.waitFor()
    const offered = (await items.locator('option').allInnerTexts()).map(label => label.trim())
    check(offered.includes('stub-shop · listPosts') && !offered.some(label => label.includes('postById')), `the Items list offers the query that answers many rows as "stub-shop · listPosts", and not the one that answers one (${offered.join(' | ')})`)
    await items.selectOption(`api:${ID}:listPosts`)
    const bound = await until(() => shopFile().uses?.apis?.length && shopFile())
    check(JSON.stringify(bound?.uses.apis) === JSON.stringify([{ as: 'listPosts', datasource: ID, query: 'listPosts' }]), `picking it adds the page's use of the query (${JSON.stringify(bound?.uses?.apis)})`)
    const boundList = await until(() => shopFile().root.children?.find(node => node.id === listId)?.props?.items && shopFile().root.children.find(node => node.id === listId))
    check(JSON.stringify(boundList?.props.items) === JSON.stringify({ $bind: 'listPosts' }) && boundList.props.as === 'post', `and binds the List's items and item name (${JSON.stringify(boundList?.props)})`)
    check(await until(async () => await items.inputValue() === 'listPosts'), 'the select then shows the List\'s source')
    check(await page.locator('[data-testid="api-source"]').count() === 1 && await page.locator('[data-testid="source-listPosts-sort-field"], [data-testid="source-listPosts-limit"]').count() === 0, 'the source says which query it is and has no sort, filter or limit')
    const sourceWords = await page.locator('[data-testid="list-source"]').innerText()
    check(!JARGON.test(sourceWords) && !/\buse[A-Z][A-Za-z0-9]+/.test(sourceWords), `the List's source is in plain words (${sourceWords.replace(/\s+/g, ' ')})`)
    await page.locator(`[data-layer-id="${textId}"]`).first().click()
    const textField = page.locator('[data-prop-row="text"] input, [data-prop-row="text"] textarea').first()
    await textField.click()
    await textField.press('End')
    await page.locator('[data-prop-row="text"] [data-variable-picker]').click()
    const picked = page.getByRole('menuitem', { name: /post\.title/ })
    check(await picked.count() > 0 && await page.getByRole('menuitem', { name: /post\.body/ }).count() > 0, 'the braces menu offers the fields of the query\'s model: post.title, post.body')
    await picked.first().click()
    const templated = await until(() => JSON.stringify(shopFile().root.children?.find(node => node.id === listId)?.children?.[0]?.props?.text) === JSON.stringify({ $template: 'Title: {post.title}' }))
    check(templated, 'and binds the Text to post.title')

    // The canvas shows sample rows from the model's fields, says so, and asks the API for nothing.
    const rowsOnCanvas = async () => (await canvas(page).locator('[data-node-type="Text"]').allInnerTexts()).filter(text => text.includes('Title: title')).length
    check(await until(async () => await rowsOnCanvas() >= 3, 30_000), `the canvas shows three sample rows (${await rowsOnCanvas()})`)
    const badge = page.locator('[data-testid="data-badge"]')
    check(await until(async () => (await badge.innerText().catch(() => '')).trim() === 'Sample data'), `the data badge says Sample data (${await badge.innerText().catch(() => '')})`)
    check((await badge.getAttribute('title'))?.includes('a sample built from the fields of its model') === true, 'and says why')
    await shot(page, 'simple-api-canvas-sample')
    check(apiCalls() === callsBefore, 'the canvas made no call to the API')

    // The generated app renders the API's rows.
    const rendered = await appShows(browser, shop.path, 'Title: Post 5', 180_000)
    check(rendered.html.includes('Title: Post 1') && rendered.html.includes('Title: Post 5') && !rendered.html.includes('Title: Post 6'), 'the generated page renders the stub\'s five posts')
    check(apiCalls() > callsBefore, 'which the app\'s server read from the stub')

    // Used in: the query's row names the page, the Delete says so and is refused, naming it.
    await page.goto(editorUrl(`/data?item=api:${ID}`))
    await page.locator(`[data-simple-api-panel="${ID}"]`).waitFor()
    const used = page.locator('[data-api-item="query:listPosts"] [data-api-used]')
    await used.waitFor()
    check((await used.innerText()).trim() === `Used in ${shop.name}`, `the query's row says which page uses it (${await used.innerText()})`)
    check(await page.locator('[data-api-item="query:postById"] [data-api-used]').count() === 0, 'and a query no page uses says nothing')
    await shot(page, 'simple-api-used-in')
    await page.locator('[data-api-item="query:listPosts"] [data-api-delete]').click()
    await page.locator('[data-artifact-dialog="delete"]').waitFor()
    check((await page.locator('[data-api-item-delete-used]').innerText()).includes(`Used in ${shop.name}`), 'its Delete says which page uses it')
    await page.locator('[data-artifact-submit]').click()
    await page.locator('[data-artifact-error]').waitFor()
    const kept = await page.locator('[data-artifact-error]').innerText()
    check(kept.includes('still used') && kept.includes(`page "${shop.name}"`) && !/pg_/.test(kept), `and the module refuses it, naming the page (${kept})`)
    check(bildr(FILE).queries.some(entry => entry.name === 'listPosts'), 'the query is still there')
    await plain(page, 'a refused delete of a query a page uses')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    // The page goes, and with it the use that kept the query.
    await editApp('page_delete', { page: shop.pageId })
    await calm()
    await page.reload()
    await page.locator('[data-api-item="query:listPosts"]').waitFor({ timeout: 30_000 })
    check(await page.locator('[data-api-item="query:listPosts"] [data-api-used]').count() === 0, 'once the page is gone the row says nothing again')

    // Delete the API: after asking.
    await page.locator('[data-simple-api-delete]').click()
    await page.locator('[data-artifact-dialog="delete"]').waitFor()
    await page.locator('[data-artifact-submit]').click()
    check(await until(() => bildr(FILE) === undefined), 'Delete removes the API\'s file')
    check(await until(async () => await page.locator(`[data-simple-api="${ID}"]`).count() === 0), 'and its row')
    await calm()
  } finally {
    // A run that failed half way leaves the API (its file would break the next run: the name is taken) and the page that uses it (its use
    // would name an API that is gone, and the model would no longer load): the page goes first, then the API, then the stub.
    await removeShopPage(shop)
    await removeStubApi()
    await stub.close()
  }
})
