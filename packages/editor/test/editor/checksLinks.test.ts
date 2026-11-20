import { afterEach, describe, expect, it, vi } from 'vitest'
import { generate } from '@bildr/codegen/generate'
import { click, mockActions, mountWithApp, settle } from '../helpers.ts'
import App from '../../src/App.vue'
import { takeStart } from '../../src/editor/views.ts'
import { FakeEventSource, baseHandlers, indexPage, menuItem, modelGet, setupHarness, world } from '../design/harness.ts'
import { activeTab } from './dataKit.ts'

/**
 * The Checks screen's links and its failure dot (S8), mounted as the whole App over the mocked actions: the dot of the menu and the
 * toolbar, the links of each finding, drift item and model problem, and where each one lands. The mapping itself is `findingTargets.test.ts`,
 * how an item is opened `openItem.test.ts`.
 */

// Counts how often the generator runs, with its own behaviour.
vi.mock('@bildr/codegen/generate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bildr/codegen/generate')>()
  return { ...actual, generate: vi.fn(actual.generate) }
})

setupHarness()
afterEach(() => takeStart())

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

const PAGE = 'layers/blog/app/pages/index.vue'
const DETAIL = 'layers/blog/app/pages/posts/[slug].vue'
const HAND_WRITTEN = 'layers/main/app/utils/reach.ts'
const POST = 'layers/blog/shared/domain/post.ts'
const TIP = 'layers/blog/app/components/blog/Tip.vue'
const INDEX_FILE = '.bildr/modules/blog/pages/index.json'

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
      { file: HAND_WRITTEN, line: 1, message: 'Unused variable', rule: 'no-unused-vars' },
      { file: DETAIL, line: 2, message: 'Unused variable', rule: 'no-unused-vars' }
    ]),
    types: check('types', false, [{ file: POST, line: 1, rule: 'TS2322', message: 'Type \'string\' is not assignable to type \'number\'.' }])
  }
})
const FAILING_SUMMARY = '2 checks failed. 1 file bildr wrote was edited by hand.'
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

/** The module says something changed: the shell reads the report again, which is what the Checks screen follows. */
const regenerated = () => FakeEventSource.instances.at(-1)!.send({ type: 'regenerated', version: 2, ok: true })

const LINK = '[data-testid="target-link"]'
const linksIn = (within: Element | null) => [...(within?.querySelectorAll<HTMLElement>(LINK) ?? [])]
const links = (within: Element | null) => linksIn(within).map(link => link.getAttribute('data-target'))
const labels = (within: Element | null) => linksIn(within).map(link => text(link))
const link = (key: string) => q(`${LINK}[data-target="${key}"]`)
/** The row of a lint or type finding, found by the file it names. */
const findingOf = (file: string) => qa('[data-testid^="check-"] li').find(row => text(row).includes(file)) ?? null
const model = () => q('[data-testid="model-status"]')
const drift = () => q('[data-testid="drift"]')

describe('the failure dot', () => {
  const dot = (within: Element | null) => within?.querySelector('[data-checks-dot]') ?? null
  const openMenu = async () => {
    q('[data-view-menu]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
  }
  /** What a menu entry is, by its words (not by its place in the menu). */
  const entries = () => new Map(qa('[role^="menuitem"]').map(item => [/^\w+/.exec(text(item))![0], item]))

  it('shows on the toolbar\'s menu button and on the Checks entry only, while something failed', async () => {
    await open('/design', failing)
    expect(dot(q('[data-view-menu]'))).not.toBeNull()
    await openMenu()
    const withDot = [...entries()].filter(([, item]) => dot(item)).map(([name]) => name)
    expect(withDot).toEqual(['Checks'])
  })

  it('is decoration: hidden from assistive technology, with its reason said once, by the button and by the entry', async () => {
    await open('/design', failing)
    const button = q('[data-view-menu]')!
    expect(dot(button)?.getAttribute('aria-hidden')).toBe('true')
    expect(dot(button)?.getAttribute('title')).toBeNull()
    expect(dot(button)?.getAttribute('aria-label')).toBeNull()
    // The button says what it is, and the dot's reason as its description.
    expect(button.getAttribute('title')).toBe(FAILING_SUMMARY)
    expect(text(button)).toBe('Canvas')
    await openMenu()
    const checks = entries().get('Checks')!
    expect(dot(checks)?.getAttribute('aria-hidden')).toBe('true')
    expect(text(checks)).toBe(`Checks, ${FAILING_SUMMARY}`)
    expect(text(checks).split(FAILING_SUMMARY)).toHaveLength(2)
  })

  it('shows on the bar of the screens with no editor too', async () => {
    await open('/health', failing)
    expect(q('[data-view-menu]')?.getAttribute('title')).toBe(FAILING_SUMMARY)
    expect(dot(q('[data-view-menu]'))).not.toBeNull()
  })

  it('says some model files have problems', async () => {
    await open('/design', () => ({ ...passing(), model: { ok: false, problems: [{ path: '.bildr/bildr.json', message: 'bad' }] } }))
    expect(q('[data-view-menu]')?.getAttribute('title')).toBe('Some model files have problems.')
  })

  it('shows nothing when every check passes', async () => {
    await open('/design', passing)
    expect(q('[data-checks-dot]')).toBeNull()
    expect(q('[data-view-menu]')?.getAttribute('title')).toBeNull()
  })

  it('shows nothing when no check has run', async () => {
    await open('/design', notRun)
    expect(q('[data-checks-dot]')).toBeNull()
  })

  it('shows nothing for a file kept as it was written once (a pending file, an orphan): nothing to do', async () => {
    const report = () => ({ ...passing(), drift: { missingManifest: false, files: [{ path: PAGE, state: 'pending' }, { path: TIP, state: 'orphaned' }] } })
    await open('/design', report)
    expect(q('[data-checks-dot]')).toBeNull()
  })

  it('follows the status the shell refreshes: it goes away once the report is clean', async () => {
    let report: () => unknown = failing
    await open('/design', () => report())
    expect(q('[data-checks-dot]')).not.toBeNull()
    report = passing
    regenerated()
    await vi.waitFor(() => expect(q('[data-checks-dot]')).toBeNull())
  })
})

describe('the summary at the top of the Checks screen', () => {
  const summary = () => q('[data-testid="checks-summary"]')

  it('says the same thing as the dot, in the same words', async () => {
    await open('/health', failing)
    expect(text(summary())).toBe(FAILING_SUMMARY)
    expect(q('[data-view-menu]')?.getAttribute('title')).toBe(text(summary()))
  })

  it('is not there when nothing is wrong', async () => {
    await open('/health', passing)
    expect(summary()).toBeNull()
  })

  it('names a drifted file in plain words: Edited by hand', async () => {
    await open('/health', failing)
    expect(text(q('[data-testid="drift"] [data-testid="state"]'))).toBe('Edited by hand')
  })
})

describe('the links of the Checks screen', () => {
  it('links each finding and each drift item to where it is: Code, and the item it is generated from', async () => {
    await open('/health', failing)
    expect(links(findingOf(PAGE))).toEqual([`code:${PAGE}`, 'page:pg_index'])
    expect(labels(findingOf(PAGE))).toEqual(['Open file in Code', 'Open page “index”'])
    // Hand-written: no generated file, so nothing to open.
    expect(links(findingOf(HAND_WRITTEN))).toEqual([])
    expect(links(findingOf(DETAIL))).toEqual([`code:${DETAIL}`, 'page:pg_post_detail'])
    expect(links(q('[data-testid="check-types"]'))).toEqual([`code:${POST}`, 'collection:ent_post'])
    expect(labels(q('[data-testid="check-types"]'))).toEqual(['Open file in Code', 'Open collection “Post”'])
    expect(links(drift())).toEqual([`code:${TIP}`, 'component:cmp_tip'])
    expect(labels(drift())).toEqual(['Open file in Code', 'Open component “Tip”'])
    expect(text(q('[data-testid="check-lint"]'))).not.toMatch(/Model screen/)
  })

  it('says what each link opens, screen section by section', async () => {
    await open('/health', failing)
    expect(labels(drift())).toEqual(['Open file in Code', 'Open component “Tip”'])
    expect(labels(q('[data-testid="check-lint"]'))).toEqual(['Open file in Code', 'Open page “index”', 'Open file in Code', 'Open page “posts-slug”'])
    expect(labels(q('[data-testid="check-types"]'))).toEqual(['Open file in Code', 'Open collection “Post”'])
  })

  it('looks like links: in the link colour, with a focus ring, and a separator between them', async () => {
    await open('/health', failing)
    const row = findingOf(PAGE)!
    const [first, second] = linksIn(row)
    for (const target of [first!, second!]) {
      expect(target.tagName).toBe('BUTTON')
      expect(target.className).toContain('text-primary')
      expect(target.className).toContain('focus-visible:')
    }
    const separators = row.querySelectorAll('[data-target-links] [aria-hidden="true"]')
    expect(separators).toHaveLength(1)
    expect(first!.nextElementSibling).toBe(separators[0])
    expect(second!.previousElementSibling).toBe(separators[0])
    // One link has nothing to separate it from.
    expect(findingOf(POST)?.querySelectorAll('[data-target-links] [aria-hidden="true"]')).toHaveLength(1)
    expect(findingOf(HAND_WRITTEN)?.querySelector('[data-target-links]')).toBeNull()
  })

  it('opens the generated file in Code, on the tab of that file, from a drift item', async () => {
    const { router } = await open('/health', failing)
    await click(q('[data-testid="drift"] [data-target^="code:"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/code'))
    expect(router.currentRoute.value.query).toEqual({ path: '.bildr/modules/blog/components/tip.json', file: TIP })
    const tab = text(q('[data-testid="code-tabs"] [role="tab"][aria-selected="true"]'))
    expect(tab).toContain('Tip.vue')
    expect(tab).not.toContain('index.vue')
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
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query.item).toBe('collection:ent_post')
    expect(q('[data-testid="data"]')).not.toBeNull()
    expect(activeTab()).toBeTruthy()
    expect(q('[data-tree-item="collection:ent_post"]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('opens a page from a finding: the Design screen, on that page', async () => {
    const { router } = await open('/health', failing)
    await click(link('page:pg_post_detail'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/design'))
    await vi.waitFor(() => expect(q('[data-page-id="pg_post_detail"] [aria-current="page"]')).not.toBeNull())
    expect(q('[data-page-id="pg_index"] [aria-current="page"]')).toBeNull()
  })

  it('opens a component from a drift item: the Design screen, in that component', async () => {
    const { router } = await open('/health', failing)
    await click(link('component:cmp_tip'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/design'))
    await vi.waitFor(() => expect(text(q('[data-breadcrumb]'))).toContain('Tip'))
  })

  it('links the model problems it lists to their files in All model files, or to their items when the model loads', async () => {
    const problems = [{ path: INDEX_FILE, message: 'Unknown node type "Wat"' }, { path: '.bildr/modules/blog/entities/post.json', message: 'bad field' }]
    const { router } = await open('/health', () => ({ ...passing(), model: { ok: false, problems } }))
    // The model loads here (it was fixed since the report): each problem is linked to the item its file holds.
    expect(links(model())).toEqual(['page:pg_index', 'collection:ent_post'])
    await click(link('collection:ent_post'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query.item).toBe('collection:ent_post')
  })

  it('links the model problems to their files while the model does not load', async () => {
    const problems = [{ path: INDEX_FILE, message: 'Unknown node type "Wat"' }]
    const { router } = await open('/health', () => ({ ...passing(), model: { ok: false, problems } }), { model_get: () => ({ ok: false, problems, files: modelGet().files, database: false }) })
    expect(links(model())).toEqual([`files:${INDEX_FILE}`])
    expect(labels(model())).toEqual(['Open in All model files'])
    await click(link(`files:${INDEX_FILE}`))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query).toEqual({ item: 'files', file: INDEX_FILE })
  })

  it('links nothing, and says nothing wrong, when the model could not be read', async () => {
    await open('/health', failing, { model_get: () => ({ ok: false, problems: [{ path: '.bildr/bildr.json', message: 'bad' }], files: {} }) })
    expect(qa(LINK)).toEqual([])
    expect(text(drift())).toContain(TIP)
    expect(q('[data-testid="links-unavailable"]')).toBeNull()
  })

  it('says it in the words of the workspace (S2): collection, connection and sample data, never entity, fixtures, data source, drift, ids or the Model screen', async () => {
    const files = ['entities/post', 'repositories/quote', 'fixtures/post', 'queries/featured-posts', 'actions/create-post', 'pages/index'].map(path => `.bildr/modules/blog/${path}.json`)
    const problems = [...files, '.bildr/datasources/quotes.json', '.bildr/datasources/main.json'].map(path => ({ path, message: 'bad' }))
    const jargon = ['synced', 'fixture', 'data source', 'datasource', 'entity', 'entities', 'repositor', 'model screen', 'drift', 'detached', 'generated']
    const anId = /\b(pg|ent|ds|q|act|cmp|lay)_\w+/
    // What a person reads of a link, the dot and the summary: not the file paths they sit beside.
    const read = () => [...qa(LINK).map(text), q('[data-view-menu]')?.getAttribute('title') ?? '', text(q('[data-testid="checks-summary"]'))]
    await open('/health', () => ({ ...failing(), model: { ok: false, problems } }))
    expect(read().filter(Boolean).length).toBeGreaterThan(8)
    expect(read().filter(sentence => anId.test(sentence) || jargon.some(word => sentence.toLowerCase().includes(word)))).toEqual([])
    expect(text(model())).not.toMatch(/model screen/i)
    expect(labels(model())).toEqual([
      'Open collection “Post”',
      'Open collection “Quote”',
      'Open collection “Post”',
      'Open query “Featured posts”',
      'Open action “Create post”',
      'Open page “index”',
      'Open connection “quotes”',
      'Open in All model files'
    ])
  })
})

describe('the links follow the model while the screen is open', () => {
  const lintRow = () => findingOf(PAGE)
  const brokenModel = () => ({ ok: false, problems: [{ path: INDEX_FILE, message: 'Unknown node type "Wat"' }], files: modelGet().files, database: false })

  it('follows a rename: the label says the new name, with no reload', async () => {
    await open('/health', failing)
    expect(labels(lintRow())).toEqual(['Open file in Code', 'Open page “index”'])
    indexPage().name = 'home'
    regenerated()
    await vi.waitFor(() => expect(labels(lintRow())).toEqual(['Open file in Code', 'Open page “home”']))
  })

  it('gives a model that was broken when the screen opened its links once it is fixed', async () => {
    let served: () => unknown = brokenModel
    await open('/health', failing, { model_get: () => served() })
    expect(qa(LINK)).toEqual([])
    served = modelGet
    regenerated()
    await vi.waitFor(() => expect(links(lintRow())).toEqual([`code:${PAGE}`, 'page:pg_index']))
  })

  it('takes the links away when the model breaks', async () => {
    let served: () => unknown = modelGet
    await open('/health', failing, { model_get: () => served() })
    expect(qa(LINK)).not.toEqual([])
    served = brokenModel
    regenerated()
    await vi.waitFor(() => expect(qa(LINK)).toEqual([]))
  })

  it('keeps the newest model when an older answer arrives late', async () => {
    let answerLate: (answer: unknown) => void = () => undefined
    const late = new Promise<unknown>((resolve) => {
      answerLate = resolve
    })
    const stale = structuredClone(world.model)
    stale.modules.blog!.pages.find(page => page.id === 'pg_index')!.name = 'stale'
    let asked = 0
    // The first answer is slow: the one asked for by a later report arrives first.
    await open('/health', failing, { model_get: () => ++asked === 1 ? late : modelGet() })
    await vi.waitFor(() => expect(labels(lintRow())).toEqual(['Open file in Code', 'Open page “index”']))
    answerLate({ ok: true, model: stale, files: modelGet().files, database: false })
    await settle()
    expect(asked).toBeGreaterThan(1)
    expect(labels(lintRow())).toEqual(['Open file in Code', 'Open page “index”'])
  })

  it('does not run the generator for each link, only for each model', async () => {
    vi.mocked(generate).mockClear()
    await open('/health', failing)
    // Four generated files link, a poll and an event each read the report and the model again: the model is the same, so it is generated once.
    expect(qa(LINK).length).toBeGreaterThan(4)
    regenerated()
    await settle()
    expect(generate).toHaveBeenCalledTimes(1)
    indexPage().name = 'home'
    regenerated()
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
  })
})

describe('when the links cannot be made', () => {
  const REFUSAL = 'Two collections share the plural “posts”'

  it('says so, instead of showing no links with no reason, and keeps the links that do not need the generator', async () => {
    vi.mocked(generate).mockImplementationOnce(() => {
      throw new Error(REFUSAL)
    })
    const problems = [{ path: INDEX_FILE, message: 'bad' }]
    await open('/health', () => ({ ...failing(), model: { ok: false, problems } }))
    expect(text(q('[data-testid="links-unavailable"]'))).toBe(`Links unavailable: ${REFUSAL}`)
    expect(links(drift())).toEqual([])
    expect(links(q('[data-testid="check-lint"]'))).toEqual([])
    expect(links(model())).toEqual(['page:pg_index'])
  })

  it('says nothing when the generator is fine', async () => {
    await open('/health', failing)
    expect(q('[data-testid="links-unavailable"]')).toBeNull()
  })
})

describe('the links of the model problems on the Data and Design screens', () => {
  const problems = [{ path: INDEX_FILE, message: 'Unknown node type "Wat"' }]
  const broken = { model_get: () => ({ ok: false, problems, files: modelGet().files, database: false }) }

  it('links each problem on the Data screen to its file in All model files, which opens on that file', async () => {
    const { router } = await open('/data/advanced', passing, broken)
    const list = q('[data-testid="data-problems"]')
    expect(labels(list)).toEqual(['Open in All model files'])
    expect(text(list)).not.toContain('(Model screen)')
    await click(link(`files:${INDEX_FILE}`))
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'files', file: INDEX_FILE }))
    expect(router.currentRoute.value.path).toBe('/data/advanced')
    await vi.waitFor(() => expect(q('[data-testid="raw-content"]')).not.toBeNull())
  })

  it('links each problem on the Design screen to its file in All model files', async () => {
    const { router } = await open('/design', passing, broken)
    const list = q('[data-testid="design-problems"]')
    expect(labels(list)).toEqual(['Open in All model files'])
    expect(text(list)).not.toContain('(Model screen)')
    await click(link(`files:${INDEX_FILE}`))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query).toEqual({ item: 'files', file: INDEX_FILE })
  })

  it('keeps the Open model files button beside them', async () => {
    await open('/data/advanced', passing, broken)
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
