#!/usr/bin/env node
/**
 * End-to-end check of a generated bildr app (T11, specs S1 and S2): from an
 * empty directory to a built, booted app that lists, shows and creates a
 * record. Standalone: it needs no running bildr server (unlike e2e/all.mjs).
 *
 *   node e2e/generated.mjs [--install] [--keep]
 *   pnpm e2e:generated
 *
 * Steps, in a fresh temp dir under $E2E_TMP (default: the OS temp dir):
 * 1. create   `create-bildr` writes the starter kit (S1).
 * 2. install  `--install`: a real `pnpm install` (S1 "installs"); by default the
 *             golden fixture's node_modules is symlinked, as packages/nuxt/test does.
 * 3. model    `nuxt dev`, then the golden blog model (fixtures/codegen/blog/.bildr)
 *             is written through the editor's actions (`model_file_put`); once
 *             regeneration settles, the generated files equal the fixture's.
 * 4. standalone  no bildr runtime dependency; with `@bildr/nuxt` removed from
 *             `modules`, `nuxi typecheck`, `nuxi build` and `vitest run` pass (S2).
 * 5. smoke    the built server on a fresh database; a headless Chromium opens the
 *             list, creates a post through the form, sees it in the list and on
 *             its detail page; the API lists it. Console errors and failed
 *             requests are FAILs.
 *
 * Flags and env:
 * --install          real install instead of the symlink
 * --keep             keep the temp dir (its path is printed)
 * E2E_TMP            parent of the temp dir
 * E2E_MUTATE=a,b     break the generated app on purpose, to prove the checks catch it:
 *                    `submit` (the create form doesn't submit), `list` (list cards lose the title)
 * PLAYWRIGHT_CORE, CHROMIUM  as in e2e/lib.mjs
 *
 * PASS/FAIL lines and the exit code work like e2e/lib.mjs. Every child process
 * runs in its own process group and is killed on exit, failure or Ctrl-C.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = join(REPO, 'fixtures/codegen/blog')
const CLI = join(REPO, 'packages/create-bildr/src/cli.ts')
const PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE || join(homedir(), '.t3/runtime/versions/0.1.6/node_modules/playwright-core/index.mjs')
const CHROMIUM = process.env.CHROMIUM || join(homedir(), '.cache/ms-playwright/chromium-1194/chrome-linux/chrome')

const flags = new Set(process.argv.slice(2))
const INSTALL = flags.has('--install')
const KEEP = flags.has('--keep')
const MUTATE = new Set((process.env.E2E_MUTATE ?? '').split(',').map(name => name.trim()).filter(Boolean))
for (const flag of flags) if (!['--install', '--keep'].includes(flag)) throw new Error(`Unknown flag ${flag}. Usage: node e2e/generated.mjs [--install] [--keep]`)

const MINUTE = 60_000
const UI_TIMEOUT = 20_000

// ── Output ─────────────────────────────────────────────────────────────

const counts = { pass: 0, fail: 0 }

/** Prints PASS or FAIL for one expectation; a FAIL sets the exit code. */
function check(cond, msg) {
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** `promise`, or undefined after `ms`; the timer is cleared either way so it never keeps the script alive. */
const within = (promise, ms) => {
  let timer
  const timeout = new Promise(resolve => (timer = setTimeout(resolve, ms, undefined)))
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Polls `probe` until it returns a truthy value; throws `what` after `timeout`. */
async function waitFor(what, probe, timeout, every = 500) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await probe()
    if (value) return value
    await sleep(every)
  }
  throw new Error(`timed out after ${timeout / 1000}s waiting for ${what}`)
}

// ── Child processes ────────────────────────────────────────────────────

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

/** Kills a child's whole process group: SIGTERM, then SIGKILL after 10s. */
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
  const done = await within(child.exited, 10_000)
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

/** Runs a command to completion; output goes to `log`. Resolves with the exit code (null on timeout). */
async function run(command, args, { cwd, env, log, timeout }) {
  const child = start(command, args, { cwd, env, log })
  const result = await within(child.exited, timeout)
  if (!result) {
    await stop(child)
    return { code: null, timedOut: true }
  }
  return result
}

const tail = (log, lines = 30) => existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n').slice(-lines).map(line => `    | ${line}`).join('\n') : '    | (no log)'

/** Runs a command and checks it exits 0; prints the end of its log otherwise. */
async function checkRun(label, command, args, options) {
  const started = Date.now()
  const { code, timedOut } = await run(command, args, options)
  const ok = check(code === 0, `${label} ${timedOut ? `timed out after ${options.timeout / 1000}s` : `exits ${code}`} (${((Date.now() - started) / 1000).toFixed(1)}s, log ${options.log})`)
  if (!ok) console.log(tail(options.log))
  return ok
}

const freePort = () => new Promise((resolve, reject) => {
  const server = createNetServer()
  server.unref()
  server.on('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => resolve(port))
  })
})

// ── Files ──────────────────────────────────────────────────────────────

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

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const managedPaths = root => Object.entries(readJson(join(root, '.bildr/manifest.json')).files)
  .filter(([, entry]) => entry.owner === 'managed').map(([path]) => path).sort()
const readOr = path => existsSync(path) ? readFileSync(path, 'utf8') : undefined

// ── Steps ──────────────────────────────────────────────────────────────

/**
 * S1: the starter kit. Named "Blog" with module "blog": the golden model's
 * blog index page reuses the starter page's id (`pg_index`), so a `main`
 * starter can't be turned into the blog through valid edits (its index page
 * can't be put while main's exists, main's can't be deleted while the layout
 * links it, and module.json files are never deletable).
 */
async function create(ctx) {
  const ok = await checkRun('create-bildr', process.execPath, ['--experimental-strip-types', '--no-warnings', CLI, ctx.dir, '--name', 'Blog', '--module', 'blog'], { cwd: ctx.tmp, log: join(ctx.tmp, 'create.log'), timeout: MINUTE })
  if (!ok) throw new Error('create-bildr failed')
  check(existsSync(join(ctx.dir, '.bildr/bildr.json')) && existsSync(join(ctx.dir, '.bildr/manifest.json')), 'the project has .bildr/bildr.json and a manifest')
  check(existsSync(join(ctx.dir, 'layers/core/nuxt.config.ts')), 'the project has layers/core')
}

async function install(ctx) {
  if (INSTALL) {
    console.log('mode: pnpm install (real install)')
    const ok = await checkRun('pnpm install', 'pnpm', ['install'], { cwd: ctx.dir, log: join(ctx.tmp, 'install.log'), timeout: 15 * MINUTE })
    if (!ok) throw new Error('pnpm install failed')
  } else {
    console.log(`mode: symlinked node_modules → ${relative(REPO, join(FIXTURE, 'node_modules'))} (pass --install for a real install)`)
    symlinkSync(join(FIXTURE, 'node_modules'), join(ctx.dir, 'node_modules'), 'dir')
  }
  check(existsSync(join(ctx.dir, 'node_modules/.bin/nuxi')), 'node_modules/.bin/nuxi exists')
}

/** Files of the model by what they depend on: a put validates the whole model, so references go after what they name. */
const KIND_ORDER = ['bildr.json', 'theme.json', 'datasources/', 'module.json', 'entities/', 'fixtures/', 'repositories/', 'queries/', 'state/', 'actions/', 'components/', 'pages/', 'layouts/']
const kindRank = path => KIND_ORDER.findIndex(key => path.endsWith(`/${key}`) || path.includes(`/${key}`))

/** The editor's HTTP actions on a running `nuxt dev` (T10 action contract). */
const editorClient = (base, token) => async (name, input = {}) => {
  const response = await fetch(`${base}/__bildr/api/actions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': base, 'x-bildr-token': token },
    body: JSON.stringify(input)
  })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, ...body }
}

/** D8/D12: the whole loop. The golden model goes in through the editor's actions; `nuxt dev` regenerates the app. */
async function model(ctx) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const log = join(ctx.tmp, 'dev.log')
  const dev = start(join(ctx.dir, 'node_modules/.bin/nuxt'), ['dev', '--port', String(port), '--host', '127.0.0.1'], { cwd: ctx.dir, log })
  try {
    const token = await waitFor('the editor link in the dev log', () => /\/__bildr\?token=([0-9a-f]{48})/.exec(readOr(log) ?? '')?.[1], 3 * MINUTE)
    const action = editorClient(base, token)
    await waitFor('health_get to answer', async () => (await action('health_get').catch(() => ({}))).ok, 2 * MINUTE, 1000)
    check(true, `nuxt dev serves the editor actions at ${base}/__bildr (log ${log})`)

    // What the golden model needs: its files that the starter lacks or has otherwise; starter-only files go.
    const golden = modelFiles(FIXTURE)
    const current = modelFiles(ctx.dir)
    const extra = Object.keys(current).filter(path => !(path in golden))
    let todo = Object.keys(golden).filter(path => golden[path] !== current[path])
      .sort((a, b) => kindRank(a) - kindRank(b) || (a < b ? -1 : 1))
    const order = []
    // Dependency order first; a put refused as `invalid` is retried after the others (pages link each other).
    for (let pass = 0; todo.length && pass < 5; pass++) {
      const refused = []
      for (const path of todo) {
        const result = await action('model_file_put', { path, content: JSON.parse(golden[path]) })
        if (result.ok) order.push(path)
        else if (result.code === 'invalid') refused.push({ path, result })
        else throw new Error(`model_file_put ${path} → ${result.status} ${result.code}: ${result.message}`)
      }
      if (refused.length === todo.length) {
        for (const { path, result } of refused) console.log(`    ${path}: ${result.problems?.map(problem => `${problem.path}: ${problem.message}`).join('; ')}`)
        break
      }
      todo = refused.map(({ path }) => path)
    }
    for (const path of extra) {
      const result = await action('model_file_delete', { path })
      check(result.ok, `model_file_delete ${path}${result.ok ? '' : ` → ${result.code}: ${result.message}`}`)
      if (result.ok) order.push(`delete ${path}`)
    }
    console.log(`model put order:\n${order.map((path, index) => `    ${index + 1}. ${path}`).join('\n')}`)
    check(todo.length === 0, `every golden model file was saved through model_file_put (${order.length} puts${todo.length ? `, refused: ${todo.join(', ')}` : ''})`)

    // Settled: the model loads, no drift, no pending migration, the managed files match, and the log is quiet.
    const goldenManaged = managedPaths(FIXTURE)
    let lastSize = -1
    let quietSince = Date.now()
    let state = {}
    try {
      await waitFor('regeneration to settle', async () => {
        const size = statSync(log).size
        if (size !== lastSize) {
          lastSize = size
          quietSince = Date.now()
        }
        // New layers make Nuxt restart in a new process: a refused connection means "not settled yet".
        const [health, pending] = await Promise.all([action('health_get'), action('migration_pending_get')]).catch(() => [])
        if (!health || !pending) return false
        state = {
          model: health.result?.model?.ok === true,
          drift: health.result?.drift?.files?.length === 0 && health.result.drift.missingManifest === false,
          migration: pending.ok && pending.result?.pending === null,
          files: goldenManaged.every(path => readOr(join(ctx.dir, path)) === readOr(join(FIXTURE, path))),
          quiet: Date.now() - quietSince > 4000,
          health
        }
        return state.model && state.drift && state.migration && state.files && state.quiet
      }, 4 * MINUTE, 1000)
    } catch (error) {
      console.log(`    ${error.message}`)
    }
    check(state.model, 'health_get: the model loads')
    check(state.drift, `health_get: drift lists no file${state.drift ? '' : ` (${JSON.stringify(state.health?.result?.drift)?.slice(0, 600)})`}`)
    check(state.migration, 'migration_pending_get: no pending migration')

    // The generated app equals the golden fixture, file by file.
    const managed = managedPaths(ctx.dir)
    const differing = goldenManaged.filter(path => readOr(join(ctx.dir, path)) !== readOr(join(FIXTURE, path)))
    check(existsSync(join(ctx.dir, 'layers/blog/app/pages/index.vue')), 'layers/blog/app/pages/index.vue was generated')
    check(differing.length === 0, `the ${goldenManaged.length} managed files of the fixture are byte-identical in the project${differing.length ? ` (differ: ${differing.slice(0, 10).join(', ')})` : ''}`)
    const missing = goldenManaged.filter(path => !managed.includes(path))
    const added = managed.filter(path => !goldenManaged.includes(path))
    check(!missing.length && !added.length, `the project's manifest manages the fixture's files exactly${missing.length ? `; missing: ${missing.join(', ')}` : ''}${added.length ? `; extra: ${added.join(', ')}` : ''}`)
    const after = modelFiles(ctx.dir)
    const modelDiff = [...new Set([...Object.keys(after), ...Object.keys(golden)])].filter(path => after[path] !== golden[path])
    check(modelDiff.length === 0, `the project's .bildr/ model equals the fixture's (${Object.keys(golden).length} files)${modelDiff.length ? `; differ: ${modelDiff.join(', ')}` : ''}`)
    check(existsSync(join(ctx.dir, 'server/database/migrations/meta/_journal.json')), 'nuxt dev wrote the database migrations (server/database/migrations/meta/_journal.json)')
    const problems = (readOr(log) ?? '').split('\n').filter(line => /could not regenerate|can't generate|model has problems|did not migrate|could not plan|ERROR/.test(line))
    check(problems.length === 0, `the dev log has no regeneration or migration errors${problems.length ? `:\n${problems.slice(0, 10).map(line => `    | ${line}`).join('\n')}` : ''}`)
  } finally {
    await stop(dev)
  }
}

/** Breaks the generated app on purpose (E2E_MUTATE), so a run proves the smoke checks notice. */
const MUTATIONS = {
  submit: ['layers/blog/app/pages/posts/new.vue', ' @submit.prevent="onFormSubmit"', ''],
  list: ['layers/blog/app/components/blog/PostCard.vue', /\n\s*<h2[^\n]*props\.post\.title[^\n]*<\/h2>/, '']
}
function mutate(ctx) {
  for (const name of MUTATE) {
    const mutation = MUTATIONS[name]
    if (!mutation) throw new Error(`Unknown E2E_MUTATE "${name}" (known: ${Object.keys(MUTATIONS).join(', ')})`)
    const [path, find, replace] = mutation
    const target = join(ctx.dir, path)
    const before = readFileSync(target, 'utf8')
    const after = before.replace(find, replace)
    if (after === before) throw new Error(`E2E_MUTATE ${name}: pattern not found in ${path}`)
    writeFileSync(target, after)
    console.log(`MUTATE ${name}: edited ${path}`)
  }
}

/** S2: a first Nuxt citizen without the editor. */
async function standalone(ctx) {
  const pkg = readJson(join(ctx.dir, 'package.json'))
  const isBildr = name => name.startsWith('@bildr/') || /(^|-)bildr$/.test(name)
  const runtime = Object.keys(pkg.dependencies ?? {}).filter(isBildr)
  const dev = Object.keys(pkg.devDependencies ?? {}).filter(isBildr)
  check(runtime.length === 0, `package.json dependencies have no bildr package${runtime.length ? ` (found ${runtime.join(', ')})` : ''}`)
  check(dev.length === 1 && dev[0] === '@bildr/nuxt', `the only bildr devDependency is @bildr/nuxt (found ${dev.join(', ') || 'none'})`)

  const configPath = join(ctx.dir, 'nuxt.config.ts')
  const config = readFileSync(configPath, 'utf8')
  const without = config.replace(/(modules:\s*\[[^\]]*?),?\s*'@bildr\/nuxt'/, '$1')
  writeFileSync(configPath, without)
  const modulesLine = /modules:\s*\[[^\]]*\]/.exec(without)?.[0] ?? ''
  check(without !== config && !modulesLine.includes('@bildr/nuxt'), `@bildr/nuxt removed from nuxt.config.ts modules (${modulesLine})`)

  mutate(ctx)
  const bin = name => join(ctx.dir, 'node_modules/.bin', name)
  const options = name => ({ cwd: ctx.dir, log: join(ctx.tmp, `${name}.log`), timeout: 15 * MINUTE })
  await checkRun('nuxi typecheck', bin('nuxi'), ['typecheck'], options('typecheck'))
  const built = await checkRun('nuxi build', bin('nuxi'), ['build'], options('build'))
  await checkRun('vitest run (generated tests)', bin('vitest'), ['run'], options('vitest'))
  if (!built) throw new Error('nuxi build failed: nothing to boot')
}

/** A stand-in for the REST "quotes" data source (dummyjson.com), so the smoke needs no network. */
function quotesStub() {
  const server = createServer((request, response) => {
    const ok = new URL(request.url, 'http://stub').pathname === '/quotes'
    response.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' })
    response.end(JSON.stringify(ok ? { quotes: [{ id: 1, quote: 'Stub quote from e2e', author: 'E2E' }], total: 1 } : {}))
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** S2 "lists, shows detail and creates a record" on the built app with a fresh database. */
async function smoke(ctx) {
  for (const [label, path] of [['playwright-core', PLAYWRIGHT_CORE], ['Chromium', CHROMIUM]]) {
    if (!existsSync(path)) throw new Error(`${label} not found at ${path}; set ${label === 'Chromium' ? 'CHROMIUM' : 'PLAYWRIGHT_CORE'}`)
  }
  const stub = await quotesStub()
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const dbFile = join(ctx.tmp, 'smoke.db')
  const log = join(ctx.tmp, 'server.log')
  const server = start(process.execPath, ['.output/server/index.mjs'], {
    cwd: ctx.dir,
    log,
    env: { PORT: String(port), HOST: '127.0.0.1', NUXT_DB_URL: `file:${dbFile}`, NUXT_DATASOURCES_QUOTES_BASE_URL: `http://127.0.0.1:${stub.address().port}` }
  })
  let browser
  try {
    await waitFor('the built server to answer', async () => (await fetch(`${base}/`).catch(() => undefined))?.ok, MINUTE)
    const empty = await (await fetch(`${base}/api/blog/posts`)).json().catch(() => undefined)
    check(Array.isArray(empty?.items) && empty.items.length === 0, `the boot plugin migrated the empty database: GET /api/blog/posts → ${JSON.stringify(empty)?.slice(0, 200)}`)
    check(existsSync(dbFile), `the database file was created at ${dbFile}`)

    const { chromium } = await import(pathToFileURL(PLAYWRIGHT_CORE).href)
    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
    const page = await browser.newPage()
    const errors = []
    page.on('console', message => message.type() === 'error' && errors.push(`console: ${message.text()}`))
    page.on('pageerror', error => errors.push(`page error: ${error.message}`))
    // ERR_ABORTED is a request a navigation cancelled (the form goes to the detail page while the checkbox icon loads).
    page.on('requestfailed', request => request.failure()?.errorText !== 'net::ERR_ABORTED' && errors.push(`request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText})`))
    // Not a FAIL (yet): the app works, but these need the network at runtime.
    const external = new Set()
    page.on('request', request => !request.url().startsWith(base) && !request.url().startsWith('data:') && external.add(new URL(request.url()).origin + new URL(request.url()).pathname))
    page.on('response', response => response.status() >= 400 && !response.url().endsWith('/favicon.ico') && errors.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`))
    const visible = async (locator, msg) => check(await locator.first().waitFor({ timeout: UI_TIMEOUT }).then(() => true, () => false), msg)

    const post = { title: `E2E post ${Date.now()}`, slug: `e2e-post-${Date.now()}`, body: 'Written by e2e/generated.mjs.' }

    await page.goto(`${base}/`)
    await visible(page.getByText('No posts yet.'), 'list page: the empty state on a fresh database')
    await visible(page.getByText('Stub quote from e2e'), 'list page: the quotes from the REST data source')
    await visible(page.getByText('A blog built with bildr.'), 'layout: the footer shows the project description')

    await page.getByRole('link', { name: 'New post' }).click()
    await visible(page.getByRole('heading', { name: 'New post' }), 'the layout\'s "New post" link opens the create form')
    await page.locator('input[name="title"]').fill(post.title)
    await page.locator('input[name="slug"]').fill(post.slug)
    await page.locator('textarea[name="body"]').fill(post.body)
    await page.getByText('Publish now').click()
    await page.getByRole('button', { name: 'Create' }).click()
    check(await page.waitForURL(`**/posts/${post.slug}`, { timeout: UI_TIMEOUT }).then(() => true, () => false), `create: the form goes to the detail page /posts/${post.slug} (at ${page.url()})`)
    await visible(page.getByRole('heading', { name: post.title }), 'detail page: the title')
    await visible(page.getByText(post.body), 'detail page: the body')

    const list = await (await fetch(`${base}/api/blog/posts`)).json().catch(() => undefined)
    const saved = list?.items?.find(item => item.slug === post.slug)
    check(saved?.title === post.title && saved.body === post.body && saved.published === true, `API: GET /api/blog/posts lists the created post (${JSON.stringify(saved ?? list)?.slice(0, 300)})`)

    await page.goto(`${base}/`)
    const card = page.locator(`a[href="/posts/${post.slug}"]`)
    await visible(card.getByText(post.title), 'list page: the new post\'s card shows its title')
    await visible(card.getByText(post.body), 'list page: the new post\'s card shows its body')
    if (await card.count()) {
      await card.first().click()
      check(await page.waitForURL(`**/posts/${post.slug}`, { timeout: UI_TIMEOUT }).then(() => true, () => false), 'list page: the card opens the detail page')
      await visible(page.getByRole('heading', { name: post.title }), 'detail page (from the list): the title')
    }
    await page.goto(`${base}/posts/${post.slug}`)
    await visible(page.getByRole('heading', { name: post.title }), 'detail page by direct URL: the title')

    check(errors.length === 0, `no console errors or failed requests${errors.length ? `:\n${errors.map(line => `    | ${line}`).join('\n')}` : ''}`)
    if (external.size) console.log(`NOTE the app requested other origins at runtime:\n${[...external].map(url => `    | ${url}`).join('\n')}`)
  } finally {
    await browser?.close().catch(() => {})
    await stop(server)
    await new Promise(resolve => stub.close(resolve))
    if (counts.fail) console.log(`server log (${log}):\n${tail(log, 15)}`)
  }
}

// ── Main ───────────────────────────────────────────────────────────────

const STEPS = [['create', create], ['install', install], ['model', model], ['standalone', standalone], ['smoke', smoke]]

async function main() {
  const parent = process.env.E2E_TMP ?? tmpdir()
  const tmp = mkdtempSync(join(parent, 'bildr-e2e-'))
  const ctx = { tmp, dir: join(tmp, 'blog') }
  console.log(`temp dir: ${tmp}${MUTATE.size ? ` (E2E_MUTATE=${[...MUTATE].join(',')})` : ''}`)
  const cleanup = () => {
    killAll()
    if (!KEEP) rmSync(tmp, { recursive: true, force: true })
  }
  process.on('exit', killAll)
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`\n${signal}: stopping`)
      cleanup()
      process.exit(130)
    })
  }

  const timings = []
  let broken
  for (const [name, step] of STEPS) {
    if (broken) {
      console.log(`\n── ${name}: skipped (${broken} failed)`)
      timings.push([name, 'skipped'])
      continue
    }
    console.log(`\n── ${name}`)
    const started = Date.now()
    try {
      await step(ctx)
    } catch (error) {
      check(false, `${name}: ${error.message}`)
      broken = name
    }
    timings.push([name, `${((Date.now() - started) / 1000).toFixed(1)}s`])
  }

  console.log(`\n${timings.map(([name, time]) => `${name.padEnd(11)} ${time}`).join('\n')}`)
  console.log(`\n${counts.pass} passed, ${counts.fail} failed`)
  cleanup()
  console.log(KEEP ? `kept ${tmp}` : `removed ${tmp}`)
}

process.on('unhandledRejection', error => check(false, `unhandled rejection: ${error?.message ?? error}`))
await main()
