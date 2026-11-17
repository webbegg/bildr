/**
 * Shared harness of the module editor's browser suite (e2e/module/*.mjs, U8).
 * The scripts are the former hosted editor's e2e scripts, ported to the
 * module's editor at `/__bildr` (the hosted app is retired): same flows, same
 * testids, over `.bildr/`.
 *
 * It boots its own project, as e2e/generated.mjs does:
 * 1. `create-bildr` writes a Blog project into $E2E_TMP (default: the OS temp
 *    dir), with the golden fixture's node_modules symlinked (no install);
 * 2. the golden blog model (fixtures/codegen/blog/.bildr) goes in through the
 *    editor's `model_file_put` action, and the app regenerates;
 * 3. `nuxt dev` runs on a free port (never 3000); the `/__bildr?token=` URL is
 *    read from its log;
 * 4. Playwright (PLAYWRIGHT_CORE, CHROMIUM, the same defaults as e2e/generated.mjs)
 *    drives the editor, and the app next to it.
 *
 * `run(name, body)` is what every script calls: it attaches to the project
 * (a server that `all.mjs`/`serve.mjs` booted and passed in E2E_MODULE_URL and
 * E2E_MODULE_DIR, or its own), puts the model back to the golden one, opens the
 * browser, runs the body and, in a `finally`, closes the browser and puts the
 * model back again (or stops its own server and deletes its project).
 * `check` prints PASS or FAIL and sets the exit code; the last line is
 * `RESULT <name> pass=<n> fail=<n>`, which all.mjs reads.
 *
 * Env: E2E_TMP (scratch parent), E2E_KEEP=1 (keep the project dir),
 * PLAYWRIGHT_CORE, CHROMIUM, E2E_MODULE_URL + E2E_MODULE_DIR (reuse a server).
 */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REPO = fileURLToPath(new URL('../..', import.meta.url))
const FIXTURE = join(REPO, 'fixtures/codegen/blog')
const CLI = join(REPO, 'packages/create-bildr/src/cli.ts')
const PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE || join(homedir(), '.t3/runtime/versions/0.1.6/node_modules/playwright-core/index.mjs')
const CHROMIUM = process.env.CHROMIUM || join(homedir(), '.cache/ms-playwright/chromium-1194/chrome-linux/chrome')
const SHOTS = fileURLToPath(new URL('./.shots/', import.meta.url))

/** A URL without the editor's session token, for anything printed. */
export const redact = url => url.replace(/([?&]token=)[^&#]*/, '$1<redacted>')

/** How long a step may wait for the UI before it fails. */
export const TIMEOUT = 10_000
const MINUTE = 60_000

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const counts = { pass: 0, fail: 0 }

/** Prints PASS or FAIL for one expectation; a FAIL sets the exit code. */
export function check(cond, msg) {
  if (cond) {
    counts.pass++
    console.log(`PASS ${msg}`)
  } else {
    counts.fail++
    process.exitCode = 1
    console.log(`FAIL ${msg}`)
  }
  return !!cond
}

// A stray rejected promise is a FAIL, not a crash that would skip the cleanup.
process.on('unhandledRejection', error => check(false, `unhandled rejection: ${error?.message ?? error}`))

// ── The project under test ─────────────────────────────────────────────

/** The running project: `{ base, token, root, log }`, set by `attach` and read by the helpers below. */
export const app = { base: '', token: '', root: '', log: '' }

const readOr = path => existsSync(path) ? readFileSync(path, 'utf8') : undefined

/** Every file under `dir`, as paths relative to `base`. */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)]
  })
}

/** The model files of a project: `.bildr/**` without the manifest and the cache (bildr writes those). */
function modelFiles(root) {
  const files = {}
  for (const path of walk(join(root, '.bildr'), root)) {
    if (path === '.bildr/manifest.json' || path.startsWith('.bildr/.cache/')) continue
    files[path] = readFileSync(join(root, path), 'utf8')
  }
  return files
}

/** The `.bildr/` file at `path` (relative to `.bildr/`, or an artifact's `filePath`), parsed from disk. */
export function bildr(path) {
  const rel = path.startsWith('.bildr/') ? path : `.bildr/${path}`
  const text = readOr(join(app.root, rel))
  return text === undefined ? undefined : JSON.parse(text)
}

/** The `.bildr/` files whose path (relative to `.bildr/`) starts with `prefix`. */
export const bildrFiles = (prefix = '') => Object.keys(modelFiles(app.root)).map(path => path.slice('.bildr/'.length)).filter(path => path.startsWith(prefix))

/** A project file as text (the generated app, e.g. `layers/blog/app/pages/index.vue`), or undefined. */
export const projectFile = path => readOr(join(app.root, path))

/** The editor's HTTP action at `/__bildr/api/actions/<name>`, as the editor calls it; `{ status, ok, result, code, message, problems }`. */
export async function call(name, input = {}, base = app.base, token = app.token) {
  const response = await fetch(`${base}/__bildr/api/actions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': base, 'x-bildr-token': token },
    body: JSON.stringify(input)
  })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, ...body }
}

/** Runs an action and returns its result; throws on a refusal. */
export async function action(name, input = {}) {
  const answer = await call(name, input)
  if (!answer.ok) throw new Error(`${name} → ${answer.status} ${answer.code}: ${answer.message}${answer.problems ? ` (${answer.problems.map(p => p.message).join('; ')})` : ''}`)
  return answer.result
}

/**
 * The running app's page at `path`, as a browser renders it (the generated app is a client-side Nuxt app, so
 * its HTML only exists once the page ran): `{ status, html, text }` of the document body. Opens its own
 * context, so the app's console output doesn't count as the editor's errors.
 */
export async function renderApp(browser, path, { viewport = { width: 1280, height: 800 }, settle = 20_000 } = {}) {
  const context = await browser.newContext({ viewport })
  try {
    const live = await context.newPage()
    let response = await live.goto(`${app.base}${path}`, { waitUntil: 'load' })
    // Vite's dev server answers 504 "Outdated Optimize Dep" while it re-optimizes dependencies (a new layer, a restart):
    // the app doesn't start, and a reload after a moment does.
    for (let attempt = 0; attempt < 5; attempt++) {
      const started = await live.waitForFunction(() => (document.querySelector('#__nuxt')?.children.length ?? 0) > 0, null, { timeout: attempt === 4 ? settle : 8000 }).then(() => true, () => false)
      if (started) break
      await sleep(2000)
      response = await live.reload({ waitUntil: 'load' })
    }
    await live.waitForLoadState('networkidle', { timeout: settle }).catch(() => {})
    return { status: response?.status(), html: await live.evaluate(() => document.body.innerHTML), text: await live.evaluate(() => document.body.innerText) }
  } finally {
    await context.close()
  }
}

/** Opens the running app's `path` in a page of `context`, reloading while Vite re-optimizes (see renderApp) until the app has started. */
export async function openApp(context, path) {
  const live = await context.newPage()
  await live.goto(`${app.base}${path}`, { waitUntil: 'load' })
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await live.waitForFunction(() => (document.querySelector('#__nuxt')?.children.length ?? 0) > 0, null, { timeout: 8000 }).then(() => true, () => false)) break
    await sleep(2000)
    await live.reload({ waitUntil: 'load' })
  }
  return live
}

/** The app's page `path` once it renders `text` (it regenerates after an edit); the last render when it never does. */
export async function appShows(browser, path, text, timeout = 60_000) {
  let last
  const found = await until(async () => {
    last = await renderApp(browser, path)
    return last.html.includes(text) && last
  }, timeout)
  return found || last
}

/** The first node of a tree that matches `predicate`, depth first. */
export function findNode(node, predicate) {
  if (!node) return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return undefined
}

/** Every node of a tree that matches `predicate`. */
export function findNodes(node, predicate, found = []) {
  if (!node) return found
  if (predicate(node)) found.push(node)
  for (const child of node.children ?? []) findNodes(child, predicate, found)
  return found
}

/** Polls `fn` until it returns a truthy value (or the timeout passes) and returns its last value. */
export async function until(fn, timeout = TIMEOUT) {
  const end = Date.now() + timeout
  let value
  while (Date.now() < end) {
    value = await fn()
    if (value) return value
    await sleep(100)
  }
  return value
}

/** Confirms a pending destructive migration (an entity or field a script made and removed again drops its table or column). */
export async function confirmMigration() {
  const pending = await call('migration_pending_get').catch(() => undefined)
  const hash = pending?.result?.pending?.hash
  if (hash) await call('migration_confirm', { hash })
  return !!hash
}

/** Confirms pending migrations until none shows for three polls in a row (a regeneration plans them a moment after a model change). */
export async function quiesce(timeout = 30_000) {
  const end = Date.now() + timeout
  let calm = 0
  while (Date.now() < end) {
    if (await confirmMigration()) calm = 0
    else if (++calm >= 3) return true
    await sleep(1000)
  }
  return false
}

/** Waits until the dev log has been silent for `ms` (regeneration, migration and Nitro rebuilds are done). */
export async function quiet(ms = 5000, timeout = 90_000) {
  if (!app.log) return sleep(ms)
  const end = Date.now() + timeout
  let size = -1
  let since = Date.now()
  while (Date.now() < end) {
    const now = statSync(app.log).size
    if (now !== size) {
      size = now
      since = Date.now()
    } else if (Date.now() - since >= ms) return true
    await sleep(500)
  }
  return false
}

/**
 * The JSON the running app answers at `path` (a route the app doesn't have yet answers its HTML page), or undefined.
 * A request that reaches the dev server while Nitro rebuilds can be lost and never answer (seen: 300 s), so one that has no answer
 * after `timeout` ms is given up (and said so): the caller asks again, as the editor does.
 */
export async function appApi(path, init, { timeout = 10_000 } = {}) {
  const started = Date.now()
  const response = await fetch(`${app.base}${path}`, { ...init, signal: AbortSignal.timeout(timeout) }).catch((error) => {
    if (error?.name === 'TimeoutError') console.log(`WARN the app gave no answer to ${init?.method ?? 'GET'} ${path} in ${Date.now() - started}ms; giving it up`)
    return undefined
  })
  if (!response || !(response.headers.get('content-type') ?? '').includes('json')) return undefined
  return { status: response.status, body: await response.json().catch(() => undefined) }
}

/**
 * Posts of the blog's database, through the running app's own create route (the app's data is not the editor's:
 * the database starts empty). A row with a slug the table has already is left as it is. Waits for the route.
 */
export async function seedPosts(rows) {
  await until(async () => (await appApi('/api/blog/posts?limit=1&offset=0'))?.status === 200, 90_000)
  for (const row of rows) {
    await appApi('/api/blog/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), body: '', published: false, ...row }) })
  }
}

/** Waits until regeneration has settled (the model loads, no drift). */
export async function settled(timeout = 2 * MINUTE) {
  return until(async () => {
    const health = await call('health_get').catch(() => undefined)
    return health?.ok && health.result?.model?.ok === true && health.result.drift?.files?.length === 0 && health.result.drift.missingManifest === false
  }, timeout)
}

/**
 * Runs `fn` (a step that deletes a route the app generated) while Nitro rebuilds the app. For about a second every route of the app
 * answers 500 (the dev log says "Could not load ... .post.ts: ENOENT": the rebuild met the file the sync had just removed), then it
 * answers again; the editor's own routes (`/__bildr`) answer throughout. The editor reads the app's rows in the background (the Live
 * read of the Rows tab), so the browser logs such a 500 as a console error, and that message does not name the route.
 *
 * So this collects the 500s the browser sees (`response`, with the URL) while `fn` runs and the app settles, and checks that every one
 * is on a route the app generated (`/api/blog/`, or a document), that none is on the editor, and that the editor's own requests all
 * succeeded. It drops from `errors` only the console 500s whose own location is one of those responses, once for each response: any
 * other console error stays an error. Then it waits for the migrations to be confirmed, the dev log to be quiet and the model to
 * settle. Returns `{ fiveHundreds, dropped }`.
 */
export async function whileAppRebuilds(page, errors, fn, what = 'the rebuild') {
  const from = errors.length
  const onEditor = url => new URL(url).pathname.startsWith('/__bildr')
  const onAppRoute = (url, type) => {
    const { pathname } = new URL(url)
    return !onEditor(url) && (pathname.startsWith('/api/blog/') || type === 'document')
  }
  const answered = []
  const consoleFailures = []
  const onResponse = response => answered.push({ url: response.url(), status: response.status(), type: response.request().resourceType() })
  const onConsole = (message) => {
    // The harness's own listener (launch) ran first: the error it kept for this message is the last one, when it kept one.
    // Chromium words it "status of 500 (Server Error)".
    const kept = errors.at(-1)
    if (message.type() === 'error' && /status of 500 \(/.test(message.text()) && kept?.endsWith(`: ${message.text()}`)) consoleFailures.push({ kept, url: message.location().url ?? '' })
  }
  page.on('response', onResponse)
  page.on('console', onConsole)
  let settledAfter
  try {
    await fn()
    await quiesce(60_000)
    await quiet()
    settledAfter = await settled()
  } finally {
    page.off('response', onResponse)
    page.off('console', onConsole)
  }
  const fiveHundreds = answered.filter(entry => entry.status === 500)
  check(settledAfter, `${what}: the model loads with no drift once the app has settled`)
  check(fiveHundreds.every(entry => onAppRoute(entry.url, entry.type)), `every 500 of ${what} is on a route the app generated, none on /__bildr (${fiveHundreds.length}: ${[...new Set(fiveHundreds.map(entry => new URL(entry.url).pathname))].join(', ') || 'none'})`)
  const editorFailed = answered.filter(entry => onEditor(entry.url) && entry.status >= 400)
  check(editorFailed.length === 0 && answered.some(entry => onEditor(entry.url)), `the editor's own requests all succeeded during ${what} (${answered.filter(entry => onEditor(entry.url)).length} answered${editorFailed.length ? `; failed: ${editorFailed.map(entry => `${entry.status} ${new URL(entry.url).pathname}`).join(', ')}` : ''})`)
  // A console 500 is expected once per 500 the browser got for an app route; the others stay in `errors`.
  const unmatched = fiveHundreds.filter(entry => onAppRoute(entry.url, entry.type)).map(entry => entry.url)
  const dropped = consoleFailures.filter(({ url }) => {
    const at = unmatched.indexOf(url)
    if (at >= 0) unmatched.splice(at, 1)
    return at >= 0
  }).map(({ kept }) => kept)
  const during = errors.splice(from)
  for (const kept of dropped) {
    const at = during.indexOf(kept)
    if (at >= 0) during.splice(at, 1)
  }
  errors.push(...during)
  console.log(`INFO ${dropped.length} console 500(s) matched a 500 of the app's routes during ${what}; ${consoleFailures.length - dropped.length} did not and stay errors`)
  return { fiveHundreds, dropped }
}

// ── Pages, components, layouts of a script ─────────────────────────────

let unique = 0
const nameOf = prefix => `${prefix}${Date.now().toString(36)}${(unique++).toString(36)}`

/** Creates a page (a unique kebab name from `prefix`) and returns `{ pageId, filePath, nodeId, name, path }`; `nodeId` is its root. */
export async function newPage(prefix = 'e2e', input = {}) {
  const name = nameOf(`${prefix}-`)
  const made = await action('page_create', { name, ...input })
  return { ...made, name, path: `/${name}` }
}

/** The page at `filePath` as a document (`{ id, root, ... }`), read from disk. */
export const pageDoc = filePath => bildr(filePath)

/** The node `id` of the page, component or layout at `filePath`, read from disk. */
export const nodeIn = (filePath, id) => findNode(bildr(filePath)?.root, n => n.id === id)

/** The newest undo step's action name (the label of what one undo reverts), or undefined. */
export async function lastStep() {
  return (await action('history_get', { limit: 1 })).undo[0]?.action
}

/** A page of its own for a script, with `ins(input)` (node_insert into it), `doc()` and `node(id)` over its file. */
export async function scene(prefix, input) {
  const p = await newPage(prefix, input)
  const file = p.pageId
  return {
    ...p,
    file,
    ins: async (extra) => {
      const { nodeId } = await action('node_insert', { file, ...extra })
      return nodeId
    },
    doc: () => bildr(p.filePath),
    node: id => nodeIn(p.filePath, id)
  }
}

/** The visible text of a generated app page: tags stripped, spaces collapsed. */
export const textOf = html => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

// ── Browser ────────────────────────────────────────────────────────────

let playwright
async function loadPlaywright() {
  const missing = [
    !existsSync(PLAYWRIGHT_CORE) && `playwright-core not found at ${PLAYWRIGHT_CORE}; set PLAYWRIGHT_CORE to its index.mjs`,
    !existsSync(CHROMIUM) && `Chromium not found at ${CHROMIUM}; set CHROMIUM to a Chromium binary`
  ].filter(Boolean)
  if (missing.length) throw new Error(missing.join('\n'))
  playwright ??= await import(pathToFileURL(PLAYWRIGHT_CORE).href)
  return playwright
}

/** A Chromium (1400×850 unless `viewport`); `errors` collects console and page errors; `ignore` patterns skip known noise. */
export async function launch({ ignore = [], viewport = { width: 1400, height: 850 } } = {}) {
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  const context = await browser.newContext({ viewport })
  context.setDefaultTimeout(TIMEOUT)
  const errors = []
  const skip = text => ignore.some(pattern => pattern.test(text))
  const watch = (page) => {
    page.on('console', (message) => {
      if (message.type() === 'error' && !skip(message.text())) errors.push(`${redact(page.url())}: ${message.text()}`)
    })
    page.on('pageerror', (error) => {
      if (!skip(error.message)) errors.push(`${redact(page.url())}: ${error.message}`)
    })
  }
  context.on('page', watch)
  const page = await context.newPage()
  return { browser, context, page, errors }
}

/** Saves a screenshot to e2e/module/.shots/<name>.png. */
export async function shot(page, name) {
  const path = join(SHOTS, `${name}.png`)
  mkdirSync(dirname(path), { recursive: true })
  await page.screenshot({ path })
}

/** The active canvas frame (the device being edited). */
export function canvas(page) {
  return page.frameLocator('iframe[title="Canvas"]')
}

/** Desktop, Tablet and Mobile: the frames the hosted scripts written before every project started with one frame expect. */
export const THREE_FRAMES = ['desktop', 'tablet', 'mobile']

/**
 * Seeds the visible frames, the editor preference in localStorage
 * (`bildr:frames:<fileId>` or the editor's own key), before the page's next loads.
 * Kept for the hosted scripts' call shape; `frames.ts` decides the key.
 */
export async function seedFrames(page, frames = THREE_FRAMES) {
  await page.addInitScript(([value]) => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('bildr:frames')) return
    localStorage.setItem('bildr:frames', value)
  }, [JSON.stringify(frames)])
}

/** The editor's address: the session link (it sets the cookie) and the hash route. */
export const editorUrl = (route = '/design') => `${app.base}/__bildr?token=${app.token}#${route}`

/**
 * Opens the Design screen on a page, component or layout (`file` is its artifact id;
 * without it the editor opens what it last showed) and waits until the canvas renders it.
 */
export async function openEditor(page, file, { route = '/design', variant } = {}) {
  if (file) await action('editor_context_set', { file, nodeId: null, ...(variant !== undefined ? { variant } : {}) })
  // A navigation that only repeats the hash is no reload: reload to start the editor again.
  if (page.url() === editorUrl(route)) await page.reload()
  else await page.goto(editorUrl(route))
  await page.locator('[data-view-menu]').waitFor()
  await canvas(page).locator('[data-node]').first().waitFor({ state: 'attached' })
}

/** Opens the Data screen (`/__bildr#/data`) and waits until it has loaded. */
export async function openData(page) {
  await page.goto(editorUrl('/data'))
  await page.locator('[data-testid="data"]').waitFor()
  await page.locator('[data-testid="data-loading"]').waitFor({ state: 'detached' })
  // The workspace's tree of Collections and Connections is there once the model has loaded.
  await page.locator('[data-data-tree]').waitFor()
}

/** The storage choices of the New collection dialog in the order shown, the chosen one marked with `*`: `['sample*', 'database', 'rest']`. */
export async function storageChoices(page) {
  return await page.locator('[data-storage]').evaluateAll(options => options.map(option => `${option.getAttribute('data-storage')}${option.getAttribute('aria-checked') === 'true' ? '*' : ''}`))
}

/** Switches the editor view through the toolbar's view menu. */
export async function toView(page, label) {
  await page.locator('[data-view-menu]').click()
  await page.locator('[role^=menuitem]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).click()
  await page.locator('[data-view-menu]').filter({ hasText: label }).waitFor()
}

/** The answer to the page's next call of an action, or null if none comes. */
export function actionResponse(page, name, timeout = 20_000) {
  return page.waitForResponse(r => r.url().endsWith(`/api/actions/${name}`), { timeout }).catch(() => null)
}

/**
 * A REST API on a free local port (the module's e2e needs no network): `GET /posts?limit&offset` answers
 * `{ items, total }`, and `GET /posts/:id`, `POST /posts`, `PUT /posts/:id`, `DELETE /posts/:id` work on the same
 * rows. `calls` lists every request (`{ method, path, authorization }`). Close it with `stub.close()`.
 */
export async function stubRest({ count = 30 } = {}) {
  const { createServer } = await import('node:http')
  const posts = new Map(Array.from({ length: count }, (_, i) => [i + 1, { id: i + 1, title: `Post ${i + 1}`, body: `Body of post ${i + 1}` }]))
  const calls = []
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://stub')
    let raw = ''
    request.on('data', chunk => (raw += chunk))
    request.on('end', () => {
      calls.push({ method: request.method, path: url.pathname, authorization: request.headers.authorization })
      const send = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(value === undefined ? '' : JSON.stringify(value))
      }
      const one = /^\/posts\/(\d+)$/.exec(url.pathname)
      if (request.method === 'GET' && url.pathname === '/posts') {
        const limit = Number(url.searchParams.get('limit') ?? 30)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        return send(200, { items: [...posts.values()].slice(offset, offset + limit), total: posts.size })
      }
      if (request.method === 'GET' && one) return posts.has(Number(one[1])) ? send(200, posts.get(Number(one[1]))) : send(404, { message: 'not found' })
      if (request.method === 'POST' && url.pathname === '/posts') {
        const row = { ...JSON.parse(raw || '{}'), id: Math.max(0, ...posts.keys()) + 1 }
        posts.set(row.id, row)
        return send(201, row)
      }
      if (request.method === 'PUT' && one) {
        const row = { ...posts.get(Number(one[1])), ...JSON.parse(raw || '{}'), id: Number(one[1]) }
        posts.set(row.id, row)
        return send(200, row)
      }
      if (request.method === 'DELETE' && one) return send(posts.delete(Number(one[1])) ? 204 : 404)
      send(404, { message: 'not found' })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, posts, calls, close: () => new Promise(resolve => server.close(resolve)) }
}

// ── Booting a project ──────────────────────────────────────────────────

const children = new Set()

/** Starts a long-running command in its own process group, output appended to `log`. */
function start(command, args, { cwd, env = {}, log }) {
  const fd = openSync(log, 'a')
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  children.add(child)
  child.exited = new Promise(resolve => child.on('exit', (code, signal) => {
    children.delete(child)
    resolve({ code, signal })
  }))
  return child
}

/** Kills a child's whole process group: SIGTERM, then SIGKILL after 10s. Only what this script started. */
async function stop(child) {
  if (!children.has(child)) return
  const signal = (sig) => {
    try {
      process.kill(-child.pid, sig)
    } catch {
      // Already gone.
    }
  }
  signal('SIGTERM')
  let timer
  const done = await Promise.race([child.exited, new Promise(resolve => (timer = setTimeout(resolve, 10_000)))])
  clearTimeout(timer)
  if (!done) {
    signal('SIGKILL')
    await child.exited
  }
}

function killAll() {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}
process.on('exit', killAll)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

const freePort = () => new Promise((resolve, reject) => {
  const server = createNetServer()
  server.unref()
  server.on('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => resolve(port))
  })
})

async function waitFor(what, probe, timeout, every = 500) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await probe()
    if (value) return value
    await sleep(every)
  }
  throw new Error(`timed out after ${timeout / 1000}s waiting for ${what}`)
}

/** Files of the model by what they depend on: a put validates the whole model, so references go after what they name. */
const KIND_ORDER = ['bildr.json', 'theme.json', 'datasources/', 'module.json', 'entities/', 'fixtures/', 'repositories/', 'queries/', 'state/', 'actions/', 'components/', 'pages/', 'layouts/']
const kindRank = path => KIND_ORDER.findIndex(key => path.endsWith(`/${key}`) || path.includes(`/${key}`))

let golden
const goldenFiles = () => (golden ??= modelFiles(FIXTURE))

/**
 * Puts the project's model back to the golden blog one, through the editor's actions: the files that differ are
 * put (dependencies first, a refused one retried after the others), the ones the fixture lacks are deleted
 * (dependents first). Returns the paths it could not settle; the empty list means the model is golden.
 */
export async function resetModel(api = call) {
  const want = goldenFiles()
  for (let pass = 0; pass < 6; pass++) {
    await confirmMigration()
    const current = modelFiles(app.root)
    const put = Object.keys(want).filter(path => want[path] !== current[path])
      .sort((a, b) => kindRank(a) - kindRank(b) || (a < b ? -1 : 1))
    const drop = Object.keys(current).filter(path => !(path in want)).sort((a, b) => kindRank(b) - kindRank(a) || (a < b ? -1 : 1))
    if (!put.length && !drop.length) return []
    for (const path of drop) await api('model_file_delete', { path })
    const refused = []
    for (const path of put) {
      const answer = await api('model_file_put', { path, content: JSON.parse(want[path]) })
      if (!answer.ok) refused.push(path)
    }
    // A layout links the pages that set its variables (layoutValues): stage those pages without their values first, as
    // the editor would (add the variable, then set it); the next pass puts them whole.
    if (refused.length === put.length) {
      for (const path of refused) {
        const content = JSON.parse(want[path])
        if (!content.layoutValues) continue
        delete content.layoutValues
        await api('model_file_put', { path, content })
      }
    }
  }
  await confirmMigration()
  const current = modelFiles(app.root)
  return [...new Set([...Object.keys(want), ...Object.keys(current)])].filter(path => want[path] !== current[path])
}

/** Boots a project: create-bildr, the golden model, `nuxt dev`. Returns `{ base, token, root, log, stop }`. */
export async function boot({ keep = process.env.E2E_KEEP === '1', desktop = false } = {}) {
  const parent = process.env.E2E_TMP || tmpdir()
  mkdirSync(parent, { recursive: true })
  const tmp = mkdtempSync(join(parent, 'bildr-e2e-module-'))
  const root = join(tmp, 'app')
  const log = join(tmp, 'dev.log')
  const create = start(process.execPath, ['--experimental-strip-types', '--no-warnings', CLI, root, '--name', 'Blog', '--module', 'blog'], { cwd: tmp, log: join(tmp, 'create.log') })
  const created = await Promise.race([create.exited, sleep(MINUTE).then(() => undefined)])
  if (created?.code !== 0) throw new Error(`create-bildr failed (log ${join(tmp, 'create.log')})`)
  symlinkSync(join(FIXTURE, 'node_modules'), join(root, 'node_modules'), 'dir')
  if (desktop) {
    // A desktop-first project (S37): the starter with its breakpoint base changed before the first `nuxt dev`.
    const path = join(root, '.bildr/bildr.json')
    writeFileSync(path, `${JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), breakpointBase: 'desktop' }, null, 2)}\n`)
  }

  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const dev = start(join(root, 'node_modules/.bin/nuxt'), ['dev', '--port', String(port), '--host', '127.0.0.1'], { cwd: root, log })
  const token = await waitFor('the editor link in the dev log', () => /\/__bildr\?token=([0-9a-f]{48})/.exec(readOr(log) ?? '')?.[1], 3 * MINUTE)
  Object.assign(app, { base, token, root, log })
  await waitFor('health_get to answer', async () => (await call('health_get').catch(() => ({}))).ok, 2 * MINUTE, 1000)
  if (desktop) {
    await settled()
    await quiet(4000)
    return { base, token, root, log, desktop, async stop() {
      await stop(dev)
      if (!keep) rmSync(tmp, { recursive: true, force: true })
      else console.log(`kept ${tmp}`)
    } }
  }
  const left = await resetModel()
  if (left.length) throw new Error(`the golden model could not be put: ${left.join(', ')}`)
  // New layers make Nuxt restart in a new process: wait until the generated blog pages exist and the log is quiet.
  let lastSize = -1
  let quietSince = Date.now()
  await waitFor('regeneration to settle', async () => {
    const size = statSync(log).size
    if (size !== lastSize) {
      lastSize = size
      quietSince = Date.now()
    }
    const health = await call('health_get').catch(() => undefined)
    const ok = health?.ok && health.result?.model?.ok === true && health.result.drift?.files?.length === 0
    return ok && existsSync(join(root, 'layers/blog/app/pages/index.vue')) && Date.now() - quietSince > 4000
  }, 4 * MINUTE, 1000)
  // L9: the regenerated config (the quotes data source) must reach the running app without a manual restart.
  const posts = await waitFor('the dev API to list posts', async () => {
    const response = await fetch(`${base}/api/blog/posts?limit=10&offset=0`).catch(() => undefined)
    return response?.status === 200
  }, MINUTE, 1000).catch(() => false)
  if (!posts) console.log(`WARN the running app's GET /api/blog/posts does not answer 200 (see ${log}): live rows fall back to the fixtures`)
  return {
    base,
    token,
    root,
    log,
    async stop() {
      await stop(dev)
      if (!keep) rmSync(tmp, { recursive: true, force: true })
      else console.log(`kept ${tmp}`)
    }
  }
}

/**
 * Runs one script: attaches to the project (E2E_MODULE_URL + E2E_MODULE_DIR from all.mjs, else its own),
 * puts the model back to golden, launches the browser and runs `body({ page, context, errors, browser })`.
 * An exception is a FAIL; the browser and the model are always restored. Ends with `RESULT`.
 */
export async function run(name, body, options) {
  const started = Date.now()
  let session
  let own
  try {
    if (options?.desktop) own = await boot({ desktop: true })
    else if (process.env.E2E_MODULE_URL) {
      const url = new URL(process.env.E2E_MODULE_URL)
      Object.assign(app, { base: url.origin, token: url.searchParams.get('token'), root: process.env.E2E_MODULE_DIR, log: process.env.E2E_MODULE_LOG ?? '' })
    } else own = await boot()
    if (own) Object.assign(app, { base: own.base, token: own.token, root: own.root, log: own.log })
    if (!own?.desktop) {
      const left = await resetModel()
      if (left.length) throw new Error(`the model is not golden: ${left.join(', ')}`)
    }
    await settled()
    session = await launch(options)
    await body(session)
  } catch (error) {
    check(false, `${name} threw: ${error.stack ?? error}`)
    if (session?.page) await shot(session.page, `${name}-error`).catch(() => {})
  } finally {
    await session?.browser.close().catch(() => {})
    if (app.base && !own?.desktop) {
      await resetModel().catch(error => console.log(`reset: ${error.message}`))
      await quiesce().catch(() => {})
    }
    await own?.stop().catch(() => {})
  }
  console.log(`RESULT ${name} pass=${counts.pass} fail=${counts.fail} time=${((Date.now() - started) / 1000).toFixed(1)}s`)
}
