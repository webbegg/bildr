import { describe, expect, it, vi } from 'vitest'
import { click, mockActions, mountWithApp, settle } from '../helpers.ts'
import App from '../../src/App.vue'
import { healthReport } from '../fixtures.ts'
import { baseHandlers, setupHarness } from '../design/harness.ts'
import { q, qa, text } from './dataKit.ts'

/**
 * Migrations in context (S6): a pending plan is a banner on each collection it changes, with Review and Apply, and an entry of the
 * Data tree (only while a plan waits, and only with a database) that shows the plan in the workspace. Mounted as the whole App over the
 * mocked actions, so the status the screens share, the global banner and the Data screen run together.
 */

setupHarness()

const DROP = 'ALTER TABLE `blog_posts` DROP COLUMN `body`;'
/** What confirming loses: Post's `body`. The blog fixture stores Post as `blog_posts`. */
const losingPlan = () => ({ hash: 'abc123', destructive: [DROP], losing: ['the data of blog_posts.body'], statements: [DROP] })
/** A plan that loses nothing (the module only holds destructive plans, so this is the shape a banner must still handle). */
const safePlan = () => ({ hash: 'safe42', destructive: [], losing: [], statements: ['ALTER TABLE `blog_posts` ADD `subtitle` text;'] })

const open = async (path: string, pending: unknown = losingPlan(), database = true) => {
  let waiting = pending
  const actions = mockActions({
    ...baseHandlers(),
    env_status: () => ({ variables: [] }),
    health_get: healthReport,
    migration_pending_get: () => ({ pending: waiting, database }),
    migration_confirm: () => {
      waiting = null
      return { migration: { kind: 'written', tag: '0003_bildr', statements: ['x'], applied: true } }
    },
    code_view: () => ({ files: [] })
  })
  const mounted = await mountWithApp(App, path)
  return { actions, ...mounted }
}

const entry = () => q('[data-tree-item="migrations"]')
const banner = () => q('[data-testid="collection-migration-banner"]')
const globalBanner = () => q('[data-testid="migration-banner"]')

describe('the tree\'s Migrations entry', () => {
  it('is listed while a plan is pending, above All model files, with the number of changes', async () => {
    await open('/data', { ...losingPlan(), statements: [DROP, 'DROP TABLE `blog_gone`;'] })
    const keys = qa('[data-tree-item]').map(item => item.dataset.treeItem)
    expect(keys.at(-2)).toBe('migrations')
    expect(keys.at(-1)).toBe('files')
    expect(text(entry())).toContain('Migrations')
    expect(text(q('[data-migrations-count]'))).toBe('2')
  })

  it('is not listed when nothing is pending', async () => {
    await open('/data', null)
    expect(entry()).toBeNull()
  })

  it('is not listed without a database, even with a plan on file', async () => {
    await open('/data', losingPlan(), false)
    expect(entry()).toBeNull()
  })

  it('shows the plan in the Data workspace, with ?item=migrations in the URL: the statements, what is lost and the confirmation', async () => {
    const { router } = await open('/data')
    await click(entry())
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'migrations' }))
    expect(router.currentRoute.value.path).toBe('/data')
    expect(q('[data-data-workspace] [data-testid="statements"]')?.textContent).toContain(DROP)
    expect(q('[data-testid="losing"]')?.textContent).toContain('the data of blog_posts.body')
    expect(q('[data-testid="confirm"]')).not.toBeNull()
    expect(q('[role="tablist"]')).toBeNull()
    expect(entry()?.getAttribute('aria-selected')).toBe('true')
    expect(q('[data-tree-item="collection:ent_post"]')?.getAttribute('aria-selected')).not.toBe('true')
  })

  it('opens from a deep link, and gives way to a collection chosen', async () => {
    const { router } = await open('/data?item=migrations')
    expect(q('[data-testid="statements"]')).not.toBeNull()
    await click(q('[data-tree-item="collection:ent_post"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.query.item).toBe('collection:ent_post'))
    expect(q('[data-testid="statements"]')).toBeNull()
    expect(q('[role="tablist"]')).not.toBeNull()
  })

  it('says there is no database, not the plan, when the link is opened without one (V7)', async () => {
    await open('/data?item=migrations', null, false)
    expect(q('[data-testid="no-database"]')?.textContent).toContain('This project has no database')
    expect(q('[data-testid="confirm"]')).toBeNull()
    expect(entry()).toBeNull()
  })

  it('confirms by the plan hash after the modal, as the Migrations screen did, and the entry goes with the plan', async () => {
    const { actions } = await open('/data?item=migrations')
    await click(q('[data-testid="confirm"]'))
    expect(actions.named('migration_confirm')).toHaveLength(0)
    await click(document.body.querySelector<HTMLElement>('[data-testid="confirm-migration"]'))
    expect(actions.named('migration_confirm')[0]?.input).toEqual({ hash: 'abc123' })
    expect(q('[data-testid="migration-outcome"]')?.textContent).toContain('0003_bildr')
    expect(entry()).toBeNull()
    expect(globalBanner()).toBeNull()
  })
})

describe('the route /migrations', () => {
  it('redirects to the plan in the Data workspace', async () => {
    const { router } = await open('/migrations')
    expect(router.currentRoute.value.path).toBe('/data')
    expect(router.currentRoute.value.query).toEqual({ item: 'migrations' })
    expect(q('[data-testid="statements"]')).not.toBeNull()
    expect(router.hasRoute('migrations')).toBe(false)
  })
})

describe('the banner on a collection', () => {
  it('shows on the collection the plan changes, above its tabs, and says it loses data', async () => {
    await open('/data')
    expect(text(banner())).toContain('This collection has a pending database change and it loses data')
    expect(banner()!.compareDocumentPosition(q('[role="tablist"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(text(q('[data-testid="collection-migration-review"]'))).toBe('Review')
    expect(text(q('[data-testid="collection-migration-apply"]'))).toBe('Apply')
  })

  it('says only that there is a change when it loses nothing', async () => {
    await open('/data', safePlan())
    expect(text(banner())).toContain('This collection has a pending database change')
    expect(text(banner())).not.toContain('loses data')
  })

  it('is on each collection the plan changes, and on none it does not', async () => {
    await open('/data', { ...losingPlan(), statements: [DROP] })
    await click(q('[data-tree-item="collection:ent_quote"]'))
    expect(banner()).toBeNull()
    await click(q('[data-tree-item="collection:ent_post"]'))
    expect(banner()).not.toBeNull()
  })

  it('is on a connection\'s or a query\'s screen never: only a collection is changed by a plan', async () => {
    await open('/data')
    await click(q('[data-tree-item="connection:ds_quotes"]'))
    expect(banner()).toBeNull()
  })

  it('is not shown when nothing is pending', async () => {
    await open('/data', null)
    expect(banner()).toBeNull()
  })

  it('is not shown without a database, even with a plan on file (V7)', async () => {
    await open('/data', losingPlan(), false)
    expect(banner()).toBeNull()
  })

  it('applies a plan that loses nothing straight away, by its hash', async () => {
    const { actions, router } = await open('/data', safePlan())
    await click(q('[data-testid="collection-migration-apply"]'))
    expect(actions.named('migration_confirm')).toHaveLength(1)
    expect(actions.named('migration_confirm')[0]?.input).toEqual({ hash: 'safe42' })
    expect(document.body.querySelector('[data-testid="confirm-migration"]')).toBeNull()
    expect(router.currentRoute.value.query.item).toBe('collection:ent_post')
    expect(banner()).toBeNull()
  })

  it('never applies a plan that loses data without the review: Apply opens Review instead', async () => {
    const { actions, router } = await open('/data')
    await click(q('[data-testid="collection-migration-apply"]'))
    expect(actions.named('migration_confirm')).toHaveLength(0)
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'migrations' }))
    expect(q('[data-testid="losing"]')).not.toBeNull()
  })

  it('applies a collection\'s banner only when the whole plan loses nothing: a loss on another collection sends it to Review', async () => {
    const { actions, router } = await open('/data', { hash: 'mixed', destructive: ['DROP TABLE `blog_gone`;'], losing: ['the table blog_gone'], statements: ['ALTER TABLE `blog_posts` ADD `subtitle` text;', 'DROP TABLE `blog_gone`;'] })
    expect(text(banner())).not.toContain('loses data')
    await click(q('[data-testid="collection-migration-apply"]'))
    expect(actions.named('migration_confirm')).toHaveLength(0)
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'migrations' }))
  })

  it('opens the plan on Review', async () => {
    const { router } = await open('/data')
    await click(q('[data-testid="collection-migration-review"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'migrations' }))
    expect(q('[data-testid="statements"]')?.textContent).toContain(DROP)
  })

  it('leaves the banner and the entry when the plan is applied from the review', async () => {
    await open('/data')
    await click(q('[data-testid="collection-migration-review"]'))
    await click(q('[data-testid="confirm"]'))
    await click(document.body.querySelector<HTMLElement>('[data-testid="confirm-migration"]'))
    await click(q('[data-tree-item="collection:ent_post"]'))
    expect(banner()).toBeNull()
    expect(entry()).toBeNull()
  })
})

describe('the global banner', () => {
  it('stays on the other screens, and its Review goes to the plan in the Data workspace', async () => {
    const { router } = await open('/health')
    expect(text(globalBanner())).toContain('1 loss')
    await click(q('[data-testid="migration-banner"] a'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    expect(router.currentRoute.value.query).toEqual({ item: 'migrations' })
  })

  it('is not shown on the Data screen while the collection\'s banner is', async () => {
    await open('/data')
    expect(banner()).not.toBeNull()
    expect(globalBanner()).toBeNull()
  })

  it('is not shown on the Data screen while the Migrations entry shows the plan', async () => {
    await open('/data?item=migrations')
    expect(globalBanner()).toBeNull()
  })

  it('is shown on the Data screen when what it shows is not the plan nor a collection the plan changes', async () => {
    await open('/data')
    await click(q('[data-tree-item="collection:ent_quote"]'))
    await settle()
    expect(banner()).toBeNull()
    expect(globalBanner()).not.toBeNull()
  })

  it('is not shown without a database', async () => {
    await open('/health', losingPlan(), false)
    expect(globalBanner()).toBeNull()
  })
})
