/**
 * Shared helpers of the browser regression suite (e2e/*.mjs). The suite runs
 * against an already-running `nuxt dev` (BILDR_URL, default
 * http://localhost:3000) with a playwright-core and a Chromium that live
 * outside the repo, so it adds no dependency:
 * - PLAYWRIGHT_CORE: path to playwright-core's index.mjs
 * - CHROMIUM: path to a Chromium binary
 *
 * Every script calls `run(name, body)`: it opens the browser, runs the body,
 * and in a `finally` deletes every project and library theme the script
 * created, even when a step throws. `check` prints PASS or FAIL and sets the exit code.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BASE = (process.env.BILDR_URL || 'http://localhost:3000').replace(/\/+$/, '')

const PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE || join(homedir(), '.t3/runtime/versions/0.1.6/node_modules/playwright-core/index.mjs')
const CHROMIUM = process.env.CHROMIUM || join(homedir(), '.cache/ms-playwright/chromium-1194/chrome-linux/chrome')

const SHOTS = fileURLToPath(new URL('./.shots/', import.meta.url))

/** How long a step may wait for the UI before it fails. */
export const TIMEOUT = 10_000

const counts = { pass: 0, fail: 0 }
const created = []
const themes = []

// A stray rejected promise is a FAIL, not a crash that would skip the cleanup.
process.on('unhandledRejection', error => check(false, `unhandled rejection: ${error?.message ?? error}`))

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

/** POST /api/actions/:name as the editor does (JSON, same origin); throws on a non-2xx answer. */
export async function action(name, input = {}) {
  const response = await fetch(`${BASE}/api/actions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': BASE },
    body: JSON.stringify(input)
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : undefined
  if (!response.ok) throw new Error(`${name} → ${response.status}: ${body?.message ?? body?.statusMessage ?? text}`)
  return body
}

/** Creates a project (named with an `e2e` prefix) that `cleanup` deletes. */
export async function project(name) {
  const doc = await action('project_create', { name: `e2e ${name} ${Date.now()}` })
  created.push({ id: doc.id, slug: doc.slug })
  return doc
}

/** Registers a project created some other way (e.g. through the UI) for cleanup. */
export function track(id, slug) {
  if (!created.some(p => p.id === id)) created.push({ id, slug })
}

/** Deletes every project this script created; missing ones are skipped. */
export async function cleanup() {
  for (const { id, slug } of created.splice(0)) {
    try {
      await action('project_delete', { projectId: id, confirm: slug })
    } catch (error) {
      if (!/→ 404/.test(error.message)) console.log(`cleanup: ${error.message}`)
    }
  }
}

/** Registers a library theme (by id) for `themeCleanup`. */
export function trackTheme(id) {
  if (!themes.includes(id)) themes.push(id)
}

/** Deletes every library theme this script registered; missing ones are skipped. */
export async function themeCleanup() {
  for (const themeId of themes.splice(0)) {
    try {
      await action('theme_library_delete', { themeId })
    } catch (error) {
      if (!/→ 404/.test(error.message)) console.log(`themeCleanup: ${error.message}`)
    }
  }
}

/**
 * A Chromium at 1400×850. `errors` collects console errors and page errors
 * from every page of the context; `ignore` patterns skip known noise.
 */
export async function launch({ ignore = [] } = {}) {
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } })
  context.setDefaultTimeout(TIMEOUT)
  const errors = []
  const skip = text => ignore.some(pattern => pattern.test(text))
  const watch = (page) => {
    page.on('console', (message) => {
      if (message.type() === 'error' && !skip(message.text())) errors.push(`${page.url()}: ${message.text()}`)
    })
    page.on('pageerror', (error) => {
      if (!skip(error.message)) errors.push(`${page.url()}: ${error.message}`)
    })
  }
  context.on('page', watch)
  const page = await context.newPage()
  return { browser, context, page, errors }
}

/** Saves a full-page screenshot to e2e/.shots/<name>.png; `name` may hold a folder (`design/view`). */
export async function shot(page, name) {
  const path = join(SHOTS, `${name}.png`)
  mkdirSync(dirname(path), { recursive: true })
  await page.screenshot({ path })
}

/** The active canvas frame (the device being edited). */
export function canvas(page) {
  return page.frameLocator('iframe[title="Canvas"]')
}

/** Opens a project's editor and waits until the canvas renders its page. */
export async function openEditor(page, id) {
  await page.goto(`${BASE}/editor/${id}`)
  await page.locator('[data-view-menu]').waitFor()
  await canvas(page).locator('[data-bildr-id]').first().waitFor()
}

/** Switches the editor view through the toolbar's view menu. */
export async function toView(page, label) {
  await page.locator('[data-view-menu]').click()
  await page.locator('[role^=menuitem]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).click()
  await page.locator('[data-view-menu]').filter({ hasText: label }).waitFor()
}

/**
 * The answer to the page's next call of an action, or null if none comes: start
 * it before the step that makes the call. It never rejects, so a step that
 * throws first leaves no unhandled rejection behind.
 */
export function actionResponse(page, name, timeout = 20_000) {
  return page.waitForResponse(r => r.url().endsWith(`/api/actions/${name}`), { timeout }).catch(() => null)
}

/** Polls `fn` until it returns a truthy value (or the timeout passes) and returns its last value. */
export async function until(fn, timeout = TIMEOUT) {
  const end = Date.now() + timeout
  let value
  while (Date.now() < end) {
    value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return value
}

/** The first node of a tree that matches `predicate`, depth first. */
export function findNode(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return undefined
}

/**
 * Runs one script: launches the browser, runs `body`, reports errors as a
 * FAIL, and always closes the browser and deletes the created projects and themes.
 * Ends with a `RESULT <name> pass=<n> fail=<n>` line that all.mjs reads.
 */
export async function run(name, body, options) {
  const started = Date.now()
  let session
  try {
    session = await launch(options)
    await body(session)
  } catch (error) {
    check(false, `${name} threw: ${error.stack ?? error}`)
    if (session?.page) await shot(session.page, `${name}-error`).catch(() => {})
  } finally {
    await session?.browser.close().catch(() => {})
    await themeCleanup()
    await cleanup()
  }
  console.log(`RESULT ${name} pass=${counts.pass} fail=${counts.fail} time=${((Date.now() - started) / 1000).toFixed(1)}s`)
}
