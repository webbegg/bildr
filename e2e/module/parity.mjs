/**
 * Screenshot parity (S1, U8): for each flow, the hosted editor (`pnpm dev --port 3200`, BILDR_URL) and the
 * module editor (`/__bildr`) in the same state at the same window size (1400×850), saved as
 * `<flow>-hosted.png` / `<flow>-module.png` (and `<flow>-pair.png`, the two side by side) in PARITY_DIR
 * (default /home/mjuan/.brigadev/bildr-app/research/editor-ui-parity/, outside the repo). It writes no
 * verdict: the differences are read from the pairs and listed in that folder's index.md.
 *
 *   BILDR_URL=http://127.0.0.1:3200 node e2e/module/parity.mjs
 *
 * Both sides get the same content: a page with a Column (padding, gap) holding a Heading, a Text and a
 * Button, and a Card holding a Heading; a component made from the Card with a "Hover" variant.
 */
import { copyFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const HOSTED = (process.env.BILDR_URL || 'http://127.0.0.1:3200').replace(/\/+$/, '')
process.env.BILDR_URL = HOSTED
const OUT = process.env.PARITY_DIR || '/home/mjuan/.brigadev/bildr-app/research/editor-ui-parity'
mkdirSync(OUT, { recursive: true })

const hosted = await import(pathToFileURL(new URL('../lib.mjs', import.meta.url).pathname).href)
const mod = await import('./lib.mjs')
{
  const url = new URL(process.env.E2E_MODULE_URL)
  Object.assign(mod.app, { base: url.origin, token: url.searchParams.get('token'), root: process.env.E2E_MODULE_DIR, log: process.env.E2E_MODULE_LOG ?? '' })
}

/** Same content on both sides, as each one's actions take it. */
const CONTENT = [
  { type: 'Column', style: { p: '4', gap: '2' }, children: [
    { type: 'Heading', props: { text: 'Welcome to the blog' } },
    { type: 'Text', props: { text: 'A paragraph of text on the page.' } },
    { type: 'Button', props: { text: 'Read more' } }
  ] },
  { type: 'Card', style: { p: '4' }, children: [{ type: 'Heading', props: { text: 'Latte' } }] }
]
const forHosted = node => ({ ...node, props: node.props ? Object.fromEntries(Object.entries(node.props).map(([k, v]) => [k === 'text' && node.type === 'Button' ? 'label' : k, v])) : undefined, children: node.children?.map(forHosted) })

// ── Setup ──────────────────────────────────────────────────────────────

async function hostedSide(session) {
  const p = await hosted.project('parity')
  const pageId = p.pages[0].id
  const nodes = []
  for (const node of CONTENT) nodes.push(await hosted.action('node_insert', { projectId: p.id, pageId, ...forHosted(node) }))
  const doc = await hosted.action('project_get', { projectId: p.id })
  const card = doc.pages[0].root.children[1]
  const made = await hosted.action('component_create', { projectId: p.id, pageId, nodeId: card.id, name: 'Latte card' })
  await hosted.action('component_variant_add', { projectId: p.id, componentId: made.componentId, name: 'Hover' })
  await hosted.action('collection_create', { projectId: p.id, name: 'Posts', fields: [{ key: 'title', type: 'text' }, { key: 'slug', type: 'text' }] })
  await hosted.action('record_create', { projectId: p.id, collection: 'posts', values: { title: 'Hello bildr', slug: 'hello-bildr' } })
  await hosted.action('record_create', { projectId: p.id, collection: 'posts', values: { title: 'A draft', slug: 'a-draft' } })
  const fresh = await hosted.action('project_get', { projectId: p.id })
  const page = session.page
  const column = fresh.pages[0].root.children[0]
  return {
    name: 'hosted',
    page,
    ids: { column: column.id, heading: column.children[0].id, instance: fresh.pages[0].root.children.find(n => n.type === 'Instance')?.id, root: fresh.pages[0].root.id, componentId: made.componentId },
    async open() {
      await hosted.seedFrames(page, p.id, ['mobile'])
      await hosted.openEditor(page, p.id)
    },
    async toView(label) { await hosted.toView(page, label) },
    canvasFrame: () => hosted.canvas(page),
    async dataView() { await hosted.toView(page, 'Data') }
  }
}

async function moduleSide(session) {
  // Component names are unique in the module: start every flow from the golden model.
  await mod.resetModel()
  await mod.quiesce()
  const s = await mod.scene('parity')
  for (const node of CONTENT) await s.ins(node)
  const doc = s.doc()
  const card = doc.root.children[1]
  const made = await mod.action('component_create', { file: s.file, nodeId: card.id, name: 'Latte card' })
  await mod.action('component_variant_add', { component: made.componentId, name: 'Hover' })
  const column = s.doc().root.children[0]
  const page = session.page
  return {
    name: 'module',
    page,
    ids: { column: column.id, heading: column.children[0].id, instance: made.nodeId, root: s.nodeId, componentId: made.componentId },
    async open() {
      await page.addInitScript(() => localStorage.setItem('bildr:frames', JSON.stringify(['mobile'])))
      await mod.openEditor(page, s.file)
    },
    async toView(label) { await mod.toView(page, label) },
    canvasFrame: () => mod.canvas(page),
    async dataView() { await mod.openData(page) }
  }
}

// ── Flows ──────────────────────────────────────────────────────────────

const row = (page, id) => page.locator(`[data-layer-id="${id}"]`).first()

const FLOWS = [
  ['canvas-default', 'The editor open on a page, nothing selected (Pages tab).', async () => {}],
  ['layers-selected', 'Layers tab with the Heading selected: the inspector, the canvas handles.', async ({ page, ids }) => {
    await page.getByRole('tab', { name: 'Layers' }).click()
    await row(page, ids.heading).click()
    await page.waitForTimeout(600)
  }],
  ['inspector-column', 'A Column selected: Layout and Size sections, collapsed Typography.', async ({ page, ids }) => {
    await page.getByRole('tab', { name: 'Layers' }).click()
    await row(page, ids.column).click()
    await page.waitForTimeout(600)
  }],
  ['node-menu', 'The node menu on the Column layer (right-click).', async ({ page, ids }) => {
    await page.getByRole('tab', { name: 'Layers' }).click()
    await row(page, ids.column).click({ button: 'right' })
    await page.waitForTimeout(500)
  }],
  ['quick-actions', '⌘K with "Text" typed.', async ({ page }) => {
    await page.locator('body').press('Control+k')
    await page.locator('[data-quick-actions]').waitFor()
    await page.locator('[data-quick-actions] input').fill('Text')
    await page.waitForTimeout(500)
  }],
  ['insert-panel', 'The Insert panel (toolbar +).', async ({ page }) => {
    await page.locator('[data-insert-button]').click()
    await page.waitForTimeout(700)
  }],
  ['assets', 'The Assets tab: components and the design-system row.', async ({ page }) => {
    await page.getByRole('tab', { name: 'Assets' }).click()
    await page.waitForTimeout(700)
  }],
  ['frames', 'Desktop, Tablet and Mobile frames, fit (frame bars, Layers rows).', async ({ page, name }) => {
    await page.addInitScript(() => {})
    for (const device of ['tablet', 'desktop']) {
      await page.locator('[data-frame] [data-frame-add] button').first().click().catch(() => {})
      await page.locator('[role^=menuitem]').filter({ hasText: new RegExp(device === 'tablet' ? 'Tablet' : 'Desktop') }).first().click().catch(() => {})
      await page.waitForTimeout(600)
    }
    await page.locator('[data-canvas-stage]').hover({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Shift+Digit1')
    await page.getByRole('tab', { name: 'Layers' }).click()
    await page.waitForTimeout(800)
    void name
  }],
  ['component-view', 'The component (Latte card) open with its variants: the purple context, the board or the primary.', async ({ page, ids }) => {
    await page.getByRole('tab', { name: 'Layers' }).click()
    await row(page, ids.instance).click()
    await page.locator('[data-component-instance]').getByRole('button', { name: 'Edit' }).click()
    await page.locator('[data-component-view]').waitFor()
    await page.waitForTimeout(900)
  }],
  ['design-system', 'The Design view: theme library, style guide, controls.', async ({ page, toView }) => {
    await toView('Design')
    await page.waitForTimeout(1500)
  }],
  ['settings', 'The Settings view.', async ({ page, toView }) => {
    await toView('Settings')
    await page.waitForTimeout(800)
  }],
  ['data', 'The Data screen with a collection and its rows (hosted collection Posts, module entity Post).', async (side) => {
    await side.dataView()
    await side.page.waitForTimeout(1800)
  }]
]

const results = []
for (const make of process.env.PAIRS_ONLY ? [] : [hostedSide, moduleSide]) {
  const isHosted = make === hostedSide
  // Each flow in a fresh page (fresh editor state), same window size.
  for (const [flow, , steps] of FLOWS) {
    const session = isHosted ? await hosted.launch() : await mod.launch()
    try {
      const side = await (isHosted ? hostedSide : moduleSide)(session)
      await side.open()
      await side.page.waitForTimeout(1200)
      await steps({ ...side, toView: side.toView.bind(side) })
      await side.page.waitForTimeout(400)
      await side.page.screenshot({ path: join(OUT, `${flow}-${side.name}.png`) })
      results.push(`${flow} ${side.name} ok`)
    } catch (error) {
      results.push(`${flow} ${isHosted ? 'hosted' : 'module'} FAILED: ${String(error.message).split('\n')[0]}`)
    } finally {
      await session.browser.close().catch(() => {})
    }
  }
}

// The pairs, side by side.
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE || `${process.env.HOME}/.t3/runtime/versions/0.1.6/node_modules/playwright-core/index.mjs`).href)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || `${process.env.HOME}/.cache/ms-playwright/chromium-1194/chrome-linux/chrome` })
const page = await browser.newPage({ viewport: { width: 2820, height: 860 } })
for (const [flow] of FLOWS) {
  // A page on disk, so file: images load; hosted on the left, module on the right.
  const html = join(OUT, `.${flow}-pair.html`)
  writeFileSync(html, `<body style="margin:0;background:#888;display:flex;gap:20px"><img src="${flow}-hosted.png" width="1400"><img src="${flow}-module.png" width="1400"></body>`)
  await page.goto(`file://${html}`)
  await page.waitForLoadState('load')
  await page.screenshot({ path: join(OUT, `${flow}-pair.png`) })
  unlinkSync(html)
}
await browser.close()
// The index of the differences is kept next to this script.
copyFileSync(new URL('./parity-index.md', import.meta.url), join(OUT, 'index.md'))
if (!process.env.PAIRS_ONLY) {
  await hosted.cleanup()
  await mod.resetModel()
  await mod.quiesce()
}
console.log(results.join('\n'))
