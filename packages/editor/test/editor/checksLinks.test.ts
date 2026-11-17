import { afterEach, describe, expect, it, vi } from 'vitest'
import { click, mockActions, mountWithApp, settle } from '../helpers.ts'
import App from '../../src/App.vue'
import { takeStart } from '../../src/editor/views.ts'
import DesignView from '../../src/views/DesignView.vue'
import { baseHandlers, menuItem, modelGet, setupHarness } from '../design/harness.ts'
import { activeTab } from './dataKit.ts'

/**
 * The Checks screen's links and its failure dot (S8), mounted as the whole App over the mocked actions: the dot of the menu and the
 * toolbar, the links of each finding, drift item and model problem, and where each one lands. The mapping itself is `findingTargets.test.ts`.
 */

setupHarness()
afterEach(() => takeStart())

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

const PAGE = 'layers/blog/app/pages/index.vue'
const DETAIL = 'layers/blog/app/pages/posts/[slug].vue'
const POST = 'layers/blog/shared/domain/post.ts'
const TIP = 'layers/blog/app/components/blog/Tip.vue'

const check = (name: string, ok: boolean, findings: unknown[] = []) => ({ name, ok, startedAt: '2026-11-13T09:00:00.000Z', durationMs: 1300, summary: ok ? 'fine' : 'broken', findings })

/** A report with a failing lint (a boundary in a generated page, a hand-written file, a type error in a generated collection) and a component edited by hand. */
const failing = () => ({
  updatedAt: '2026-11-13T09:00:00.000Z',
  model: { ok: true },
  drift: { missingManifest: false, files: [{ path: TIP, state: 'detached', diff: '--- generated\n+++ disk\n@@ -1 +1 @@\n-a\n+b\n' }] },
  migration: null,
  checks: {
    lint: check('lint', false, [
      { file: PAGE, line: 3, message: 'Import of server code from the app', rule: 'no-restricted-imports', boundary: true },
      { file: 'layers/main/app/utils/reach.ts', line: 1, message: 'Unused variable', rule: 'no-unused-vars' },
      { file: DETAIL, line: 2, message: 'Unused variable', rule: 'no-unused-vars' }
    ]),
    types: check('types', false, [{ file: POST, line: 1, rule: 'TS2322', message: 'Type \'string\' is not assignable to type \'number\'.' }])
  }
})
const passing = () => ({ updatedAt: '2026-11-13T09:00:00.000Z', model: { ok: true }, drift: { missingManifest: false, files: [] }, migration: null, checks: { lint: check('lint', true), types: check('types', true) } })
const notRun = () => ({ updatedAt: '', checks: {} })

/** Mounts the whole App at `path` over a project whose Health report is `report`. */
const open = async (path: string, report: () => unknown, extra: Record<string, (input: Record<string, unknown>) => unknown> = {}) => {
  const actions = mockActions({
    ...baseHandlers(),
    env_status: () => ({ variables: [] }),
    health_get: report,
    migration_pending_get: () => ({ pending: null, database: true }),
    code_view: () => ({ files: [{ path: PAGE, state: 'managed', content: 'a' }, { path: TIP, state: 'detached', content: 'b' }] }),
    ...extra
  })
  const mounted = await mountWithApp(App, path)
  return { actions, ...mounted }
}

const links = (within: Element | null) => [...(within?.querySelectorAll<HTMLElement>('[data-testid="target-link"]') ?? [])].map(link => link.getAttribute('data-target'))
const labels = (within: Element | null) => [...(within?.querySelectorAll<HTMLElement>('[data-testid="target-link"]') ?? [])].map(link => text(link))
const link = (key: string) => q(`[data-testid="target-link"][data-target="${key}"]`)

describe('the failure dot', () => {
  const dotTitle = (within: Element | null) => within?.querySelector('[data-checks-dot]')?.getAttribute('title') ?? null
  const openMenu = async () => {
    q('[data-view-menu]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
  }

  it('shows on the toolbar\'s menu button and on the Checks entry while a check failed, the model has problems or a file differs, in plain words', async () => {
    await open('/design', failing)
    expect(dotTitle(q('[data-view-menu]'))).toBe('2 checks failed. 1 generated file differs from the model')
    await openMenu()
    const items = qa('[role^="menuitem"]')
    expect(items.map(item => item.querySelector('[data-checks-dot]') !== null)).toEqual([false, false, false, false, true, false])
    expect(text(items[4]!)).toBe('Checks')
    expect(dotTitle(items[4]!)).toBe('2 checks failed. 1 generated file differs from the model')
    // The button still names the view, with no word of the dot in it.
    expect(text(q('[data-view-menu]'))).toBe('Canvas')
  })

  it('shows on the bar of the screens with no editor too', async () => {
    await open('/health', failing)
    expect(dotTitle(q('[data-view-menu]'))).toBe('2 checks failed. 1 generated file differs from the model')
  })

  it('says the model has problems', async () => {
    await open('/design', () => ({ ...passing(), model: { ok: false, problems: [{ path: '.bildr/bildr.json', message: 'bad' }] } }))
    expect(dotTitle(q('[data-view-menu]'))).toBe('The model has problems')
  })

  it('shows nothing when every check passes', async () => {
    await open('/design', passing)
    expect(q('[data-checks-dot]')).toBeNull()
  })

  it('shows nothing when no check has run', async () => {
    await open('/design', notRun)
    expect(q('[data-checks-dot]')).toBeNull()
  })

  it('follows the status the shell refreshes: it goes away once the report is clean', async () => {
    let report: () => unknown = failing
    await open('/design', () => report())
    expect(q('[data-checks-dot]')).not.toBeNull()
    report = passing
    const { FakeEventSource } = await import('../design/harness.ts')
    FakeEventSource.instances.at(-1)!.send({ type: 'regenerated', version: 2, ok: true })
    await vi.waitFor(() => expect(q('[data-checks-dot]')).toBeNull())
  })
})

describe('the links of the Checks screen', () => {
  it('links each finding and each drift item to where it is: Code, and the item it is generated from', async () => {
    await open('/health', failing)
    const lint = q('[data-testid="check-lint"]')!
    const findings = qa('[data-testid="check-lint"] li')
    expect(links(findings[0]!)).toEqual([`code:${PAGE}`, 'page:pg_index'])
    expect(labels(findings[0]!)).toEqual(['Open in Code', 'Open Page index'])
    // Hand-written: no generated file, so nothing to open.
    expect(links(findings[1]!)).toEqual([])
    expect(links(findings[2]!)).toEqual([`code:${DETAIL}`, 'page:pg_post_detail'])
    expect(links(q('[data-testid="check-types"]'))).toEqual([`code:${POST}`, 'collection:ent_post'])
    expect(labels(q('[data-testid="check-types"]'))).toEqual(['Open in Code', 'Open Collection Post'])
    expect(links(q('[data-testid="drift"]'))).toEqual([`code:${TIP}`, 'component:cmp_tip'])
    expect(text(lint)).not.toMatch(/Model screen/)
  })

  it('opens the generated file in Code, on the tab of that file, from a drift item', async () => {
    const { router } = await open('/health', failing)
    await click(q('[data-testid="drift"] [data-target^="code:"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/code'))
    expect(router.currentRoute.value.query).toEqual({ path: '.bildr/modules/blog/components/tip.json', file: TIP })
    expect(text(q('[data-testid="code-tabs"] [role="tab"][aria-selected="true"]'))).toContain('Tip.vue')
    expect(text(q('[data-testid="code-tabs"] [role="tab"][aria-selected="true"]'))).not.toContain('index.vue')
  })

  it('opens the generated file of a finding in Code, and the file shown is the one named', async () => {
    const { router } = await open('/health', failing, {
      code_view: () => ({ files: [{ path: 'layers/blog/app/data/posts.collection.ts', state: 'managed', content: 'a' }, { path: POST, state: 'managed', content: 'b' }] })
    })
    await click(q('[data-testid="check-types"] [data-target^="code:"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/code'))
    expect(text(q('[data-testid="code-tabs"] [role="tab"][aria-selected="true"]'))).toContain('post.ts')
  })

  it('opens a collection in the Data workspace from a finding', async () => {
    const { router } = await open('/health', failing)
    await click(link('collection:ent_post'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    expect(router.currentRoute.value.query.item).toBe('collection:ent_post')
    expect(q('[data-testid="data"]')).not.toBeNull()
    expect(activeTab()).toBeTruthy()
    expect(q('[data-tree-item="collection:ent_post"]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('opens a page from a finding: the Design screen, on that page', async () => {
    const mounted = await open('/health', failing)
    await click(link('page:pg_post_detail'))
    await vi.waitFor(() => expect(mounted.router.currentRoute.value.path).toBe('/design'))
    await settle()
    const editor = (mounted.wrapper.findComponent(DesignView).vm as unknown as { editor: { mode: string, pageId: string } }).editor
    expect(editor.mode).toBe('build')
    expect(editor.pageId).toBe('pg_post_detail')
  })

  it('opens a component from a drift item: the Design screen, in that component', async () => {
    const mounted = await open('/health', failing)
    await click(link('component:cmp_tip'))
    await vi.waitFor(() => expect(mounted.router.currentRoute.value.path).toBe('/design'))
    await settle()
    const editor = (mounted.wrapper.findComponent(DesignView).vm as unknown as { editor: { componentId: string | null } }).editor
    expect(editor.componentId).toBe('cmp_tip')
  })

  it('links the model problems it lists to their files in All model files, or to their items when the model loads', async () => {
    const problems = [{ path: '.bildr/modules/blog/pages/index.json', message: 'Unknown node type "Wat"' }, { path: '.bildr/modules/blog/entities/post.json', message: 'bad field' }]
    const { router } = await open('/health', () => ({ ...passing(), model: { ok: false, problems } }))
    // The model loads here (it was fixed since the report): each problem is linked to the item its file holds.
    expect(links(q('[data-testid="model-status"]'))).toEqual(['page:pg_index', 'collection:ent_post'])
    await click(link('collection:ent_post'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    expect(router.currentRoute.value.query.item).toBe('collection:ent_post')
  })

  it('links the model problems to their files while the model does not load', async () => {
    const problems = [{ path: '.bildr/modules/blog/pages/index.json', message: 'Unknown node type "Wat"' }]
    const { router } = await open('/health', () => ({ ...passing(), model: { ok: false, problems } }), { model_get: () => ({ ok: false, problems, files: modelGet().files, database: false }) })
    expect(links(q('[data-testid="model-status"]'))).toEqual(['files:.bildr/modules/blog/pages/index.json'])
    expect(labels(q('[data-testid="model-status"]'))).toEqual(['Open in All model files'])
    await click(link('files:.bildr/modules/blog/pages/index.json'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    expect(router.currentRoute.value.query).toEqual({ item: 'files', file: '.bildr/modules/blog/pages/index.json' })
  })

  it('links nothing, and says nothing wrong, when the model could not be read', async () => {
    await open('/health', failing, { model_get: () => ({ ok: false, problems: [{ path: '.bildr/bildr.json', message: 'bad' }], files: {} }) })
    expect(qa('[data-testid="target-link"]')).toEqual([])
    expect(text(q('[data-testid="drift"]'))).toContain(TIP)
  })

  it('says it in the words of the workspace (S2): the links, the dot and what they name are Collection, Connection and Sample data, never entity, fixtures, data source or the Model screen', async () => {
    const files = ['entities/post', 'repositories/quote', 'fixtures/post', 'queries/featured-posts', 'actions/create-post', 'pages/index'].map(path => `.bildr/modules/blog/${path}.json`)
    const problems = [...files, '.bildr/datasources/quotes.json', '.bildr/datasources/main.json'].map(path => ({ path, message: 'bad' }))
    const words = /synced|fixtures?\b|data ?sources?|entit(y|ies)|repositor|model screen|\bids?\b|\b(pg|ent|ds|q|act|cmp|lay)_\w+/i
    // What a person reads of a link or a dot: its label, its tooltip and its accessible name, not the file paths it sits beside.
    const read = () => [...document.body.querySelectorAll<HTMLElement>('[data-testid="target-link"], [data-checks-dot]')].flatMap(element => [text(element), element.getAttribute('title') ?? '', element.getAttribute('aria-label') ?? ''])
    await open('/health', () => ({ ...failing(), model: { ok: false, problems } }))
    expect(read().length).toBeGreaterThan(8)
    expect(read().filter(sentence => words.test(sentence))).toEqual([])
    expect(text(q('[data-testid="model-status"]'))).not.toMatch(/model screen/i)
    expect(labels(q('[data-testid="model-status"]'))).toEqual(['Open Collection Post', 'Open Collection Quote', 'Open Collection Post', 'Open Query Featured posts', 'Open Action Create post', 'Open Page index', 'Open Connection quotes', 'Open in All model files'])
  })

  it('says what each link opens, in the order of the screen: drift, then each check', async () => {
    await open('/health', failing)
    expect(labels(document.body)).toEqual(['Open in Code', 'Open Component Tip', 'Open in Code', 'Open Page index', 'Open in Code', 'Open Page posts-slug', 'Open in Code', 'Open Collection Post'])
  })
})

describe('the links of the model problems on the Data and Design screens', () => {
  const problems = [{ path: '.bildr/modules/blog/pages/index.json', message: 'Unknown node type "Wat"' }]
  const broken = { model_get: () => ({ ok: false, problems, files: modelGet().files, database: false }) }

  it('links each problem on the Data screen to its file in All model files, which opens on that file', async () => {
    const { router } = await open('/data', passing, broken)
    const list = q('[data-testid="data-problems"]')
    expect(labels(list)).toEqual(['Open in All model files'])
    expect(text(list)).not.toContain('(Model screen)')
    await click(link('files:.bildr/modules/blog/pages/index.json'))
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'files', file: '.bildr/modules/blog/pages/index.json' }))
    expect(router.currentRoute.value.path).toBe('/data')
    await vi.waitFor(() => expect(q('[data-testid="raw-content"]')).not.toBeNull())
  })

  it('links each problem on the Design screen to its file in All model files', async () => {
    const { router } = await open('/design', passing, broken)
    const list = q('[data-testid="design-problems"]')
    expect(labels(list)).toEqual(['Open in All model files'])
    expect(text(list)).not.toContain('(Model screen)')
    await click(link('files:.bildr/modules/blog/pages/index.json'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    expect(router.currentRoute.value.query).toEqual({ item: 'files', file: '.bildr/modules/blog/pages/index.json' })
  })

  it('keeps the Open model files button beside them', async () => {
    await open('/data', passing, broken)
    expect(q('[data-testid="open-model"]')).not.toBeNull()
  })
})

describe('the menu', () => {
  it('still goes to Checks from the menu, with the dot beside it', async () => {
    const { router } = await open('/design', failing)
    await menuItem(q('[data-view-menu]'), 'Checks')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/health'))
    await settle()
    expect(text(q('[data-view-menu]'))).toBe('Checks')
    expect(q('[data-view-menu] [data-checks-dot]')).not.toBeNull()
  })
})
