import { describe, expect, it, vi } from 'vitest'
import { Failure, click, mockActions, mountWithApp, settle } from '../helpers.ts'
import App from '../../src/App.vue'
import { healthReport, pendingPlan } from '../fixtures.ts'
import { baseHandlers, setupHarness } from '../design/harness.ts'
import { q, qa, text } from './dataKit.ts'

/**
 * Migrations in context (S6): a pending plan is a banner on each collection it changes, with Review and Apply, and an entry of the
 * Data tree (only while a plan waits, and only with a database) that shows the plan in the workspace. Mounted as the whole App over the
 * mocked actions, so the status the screens share, the global banner and the Data screen run together.
 */

setupHarness()

const DROP = 'ALTER TABLE `blog_posts` DROP COLUMN `body`;'
const ADD = 'ALTER TABLE `blog_posts` ADD `subtitle` text;'
/** What confirming loses: Post's `body`. The blog fixture stores Post as `blog_posts`. */
const losingPlan = () => ({ ...pendingPlan(), destructive: [DROP], losing: ['the data of blog_posts.body'], statements: [DROP] })
/** A plan that loses nothing (the module only holds destructive plans, so this is the shape a banner must still handle). */
const safePlan = () => ({ ...pendingPlan(), hash: 'safe42', destructive: [], losing: [], statements: [ADD] })

interface Options {
  path?: string
  pending?: unknown
  database?: boolean
  /** What `migration_confirm` answers (default: the plan was written and applied, and nothing waits any more). */
  confirm?: () => unknown
}

const open = async ({ path = '/data/advanced', pending = losingPlan(), database = true, confirm }: Options = {}) => {
  let waiting = pending
  const actions = mockActions({
    ...baseHandlers(),
    env_status: () => ({ variables: [] }),
    health_get: healthReport,
    migration_pending_get: () => ({ pending: waiting, database }),
    migration_confirm: confirm ?? (() => {
      waiting = null
      return { migration: { kind: 'written', tag: '0003_bildr', statements: ['x'], applied: true } }
    }),
    code_view: () => ({ files: [] })
  })
  const mounted = await mountWithApp(App, path)
  /** The plan changes on the module's side, and the status reads it (as its poll does). */
  const change = async (next: unknown) => {
    waiting = next
    await mounted.status.refreshPending()
    await settle()
  }
  return { actions, change, ...mounted }
}

const entry = () => q('[data-tree-item="migrations"]')
const banner = () => q('[data-testid="collection-migration-banner"]')
const apply = () => q('[data-testid="collection-migration-apply"]')
const globalBanner = () => q('[data-testid="migration-banner"]')
const UPDATED = 'The changes were updated: review them'

describe('the tree\'s Migrations entry', () => {
  it('is listed while a plan is pending, above All model files, with the number of collections it changes', async () => {
    await open({ pending: { ...losingPlan(), statements: [DROP, 'DROP TABLE `blog_gone`;'] } })
    const keys = qa('[data-tree-item]').map(item => item.dataset.treeItem)
    expect(keys.at(-2)).toBe('migrations')
    expect(keys.at(-1)).toBe('files')
    expect(text(entry())).toContain('Migrations')
    // One collection (Post) and one change no collection owns: only the collection is counted.
    expect(text(q('[data-migrations-count]'))).toBe('1')
    expect(q('[data-migrations-count]')?.title).toBe('Changes to 1 collection')
  })

  it('has no number when the plan changes no collection, only what none owns', async () => {
    await open({ pending: { ...losingPlan(), statements: ['DROP TABLE `blog_gone`;'] } })
    expect(entry()).not.toBeNull()
    expect(q('[data-migrations-count]')).toBeNull()
  })

  it('is not listed when nothing is pending', async () => {
    await open({ pending: null })
    expect(entry()).toBeNull()
  })

  it('is not listed without a database, even with a plan on file', async () => {
    await open({ database: false })
    expect(entry()).toBeNull()
  })

  it('shows the plan in the Data workspace, with ?item=migrations in the URL: the changes, what is lost and the confirmation', async () => {
    const { router } = await open()
    await click(entry())
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'migrations' }))
    expect(router.currentRoute.value.path).toBe('/data/advanced')
    expect(q('[data-data-workspace] [data-testid="statements"]')?.textContent).toContain(DROP)
    expect(q('[data-testid="confirm"]')).not.toBeNull()
    expect(q('[role="tablist"]')).toBeNull()
    expect(entry()?.getAttribute('aria-selected')).toBe('true')
    expect(q('[data-tree-item="collection:ent_post"]')?.getAttribute('aria-selected')).not.toBe('true')
  })

  it('opens from a deep link, and gives way to a collection chosen', async () => {
    const { router } = await open({ path: '/data?item=migrations' })
    expect(q('[data-testid="statements"]')).not.toBeNull()
    await click(q('[data-tree-item="collection:ent_post"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.query.item).toBe('collection:ent_post'))
    expect(q('[data-testid="statements"]')).toBeNull()
    expect(q('[role="tablist"]')).not.toBeNull()
  })
})

describe('the plan in the Data workspace', () => {
  it('tells what is lost by the collection and the field, not by the table and the column', async () => {
    await open({ path: '/data?item=migrations' })
    expect(text(q('[data-testid="losing"]'))).toBe('Post · body')
  })

  it('names the collections the plan changes, and says in words what else it changes', async () => {
    await open({ path: '/data?item=migrations', pending: { ...losingPlan(), statements: [DROP, 'DROP TABLE `blog_gone`;', 'DROP TABLE `blog_old`;'] } })
    expect(text(q('[data-testid="plan-summary"]'))).toBe('Collections changed: Post. Other database changes: 2.')
  })

  it('names no other change when there is none', async () => {
    await open({ path: '/data?item=migrations' })
    expect(text(q('[data-testid="plan-summary"]'))).toBe('Collections changed: Post.')
  })

  it('says a loss it only knows from the statements, when the module listed none (fail closed)', async () => {
    await open({ path: '/data?item=migrations', pending: { ...safePlan(), statements: [DROP] } })
    expect(text(q('[data-testid="losing"]'))).toContain('Some data may be lost')
    expect(q('[data-testid="confirm"]')).not.toBeNull()
  })

  it('has no confirmation of losses, nor a loss list, for a plan that loses nothing', async () => {
    await open({ path: '/data?item=migrations', pending: safePlan() })
    expect(q('[data-testid="losing"]')).toBeNull()
  })

  it('points at where a database is added when the link is opened without one (V7), and shows no plan', async () => {
    await open({ path: '/data?item=migrations', pending: null, database: false })
    expect(text(q('[data-testid="no-database"]'))).toBe('This project has no database yet, so there is nothing to migrate. A collection stored in a database gets changes to review here. A database is added in All model files, under Connections and storage.')
    expect(q('[data-testid="confirm"]')).toBeNull()
    expect(entry()).toBeNull()
  })

  it('confirms by the plan hash after the modal, and the entry goes with the plan', async () => {
    const { actions } = await open({ path: '/data?item=migrations' })
    await click(q('[data-testid="confirm"]'))
    expect(actions.named('migration_confirm')).toHaveLength(0)
    expect(text(document.body.querySelector('[role="dialog"]'))).toContain('Apply these changes? Some data will be lost')
    expect(text(document.body.querySelector('[data-testid="confirm-migration"]'))).toBe('Apply')
    await click(document.body.querySelector<HTMLElement>('[data-testid="confirm-migration"]'))
    expect(actions.named('migration_confirm')[0]?.input).toEqual({ hash: 'abc123' })
    expect(q('[data-testid="migration-outcome"]')?.textContent).toContain('0003_bildr')
    expect(entry()).toBeNull()
    expect(globalBanner()).toBeNull()
  })

  it('applies a plan that loses nothing at once, with no confirmation of losses', async () => {
    const { actions } = await open({ path: '/data?item=migrations', pending: safePlan() })
    expect(text(q('[data-testid="confirm"]'))).toBe('Apply')
    await click(q('[data-testid="confirm"]'))
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(actions.named('migration_confirm')[0]?.input).toEqual({ hash: 'safe42' })
  })

  it('confirms nothing when the plan changed while the confirmation of losses was open: the new plan is shown, with a note', async () => {
    const { actions, change } = await open({ path: '/data?item=migrations' })
    await click(q('[data-testid="confirm"]'))
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    await change({ ...losingPlan(), hash: 'abc124', statements: [DROP, 'ALTER TABLE `blog_posts` DROP COLUMN `title`;'] })
    await click(document.body.querySelector<HTMLElement>('[data-testid="confirm-migration"]'))
    expect(actions.named('migration_confirm')).toHaveLength(0)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(text(q('[data-testid="migration-note"]'))).toBe(UPDATED)
    expect(q('[data-testid="statements"]')?.textContent).toContain('DROP COLUMN `title`')
    // What is shown now is confirmed by a new confirmation, by the new hash.
    await click(q('[data-testid="confirm"]'))
    await click(document.body.querySelector<HTMLElement>('[data-testid="confirm-migration"]'))
    expect(actions.named('migration_confirm').map(call => call.input)).toEqual([{ hash: 'abc124' }])
  })

  it('applies the plan it shows by its hash, a plan that loses nothing included', async () => {
    const { actions, change } = await open({ path: '/data?item=migrations', pending: safePlan() })
    await change({ ...safePlan(), hash: 'safe43' })
    await click(q('[data-testid="confirm"]'))
    expect(actions.named('migration_confirm').map(call => call.input)).toEqual([{ hash: 'safe43' }])
  })

  it('sends one migration_confirm when the banner\'s Apply is under way and the Review\'s Apply is clicked', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { actions } = await open({
      pending: safePlan(),
      confirm: async () => {
        await gate
        return { migration: { kind: 'written', tag: '0003_bildr', statements: ['x'], applied: true } }
      }
    })
    await click(apply())
    expect(actions.named('migration_confirm')).toHaveLength(1)
    // Review opens while the banner's confirmation is still under way.
    await click(q('[data-testid="collection-migration-review"]'))
    expect(q('[data-testid="statements"]')).not.toBeNull()
    await click(q('[data-testid="confirm"]'))
    expect(actions.named('migration_confirm')).toHaveLength(1)
    release()
    await settle()
    expect(actions.named('migration_confirm')).toHaveLength(1)
  })

  it('shows the note the banner left when the changes were updated under it, and drops it once it is gone from the screen', async () => {
    const { change } = await open({ pending: safePlan() })
    await change({ ...safePlan(), hash: 'safe43' })
    await click(apply())
    expect(text(q('[data-testid="migration-note"]'))).toBe(UPDATED)
    await click(q('[data-tree-item="collection:ent_post"]'))
    await click(entry())
    expect(q('[data-testid="migration-note"]')).toBeNull()
  })
})

describe('the route /migrations', () => {
  it('redirects to the plan in the Data workspace, and the old screen is gone', async () => {
    const { router } = await open({ path: '/migrations' })
    expect(router.currentRoute.value.path).toBe('/data/advanced')
    expect(router.currentRoute.value.query).toEqual({ item: 'migrations' })
    expect(q('[data-testid="statements"]')).not.toBeNull()
    expect(text(q('[data-view-menu]'))).toBe('Data')
    expect(router.hasRoute('migrations')).toBe(false)
  })
})

describe('the banner on a collection', () => {
  it('shows on the collection the plan changes, above its tabs, and says what it loses there', async () => {
    await open()
    expect(text(banner())).toContain('This collection has a database change that loses data: Post · body')
    expect(banner()!.compareDocumentPosition(q('[role="tablist"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(text(q('[data-testid="collection-migration-review"]'))).toBe('Review')
  })

  it('says only that there is a change when it loses nothing', async () => {
    await open({ pending: safePlan() })
    expect(text(banner())).toContain('This collection has a database change')
    expect(text(banner())).not.toContain('loses data')
  })

  it('says another collection loses data, when this one does not', async () => {
    await open({ pending: { ...pendingPlan(), statements: [ADD, 'DROP TABLE `blog_gone`;'], destructive: ['DROP TABLE `blog_gone`;'], losing: ['the table blog_gone'] } })
    expect(text(banner())).toContain('This collection has a database change')
    expect(text(banner())).not.toContain('loses data:')
    expect(text(banner())).toContain('Other changes in the same plan lose data')
  })

  it('is on each collection the plan changes, and on none it does not', async () => {
    await open({ pending: { ...losingPlan(), statements: [DROP] } })
    await click(q('[data-tree-item="collection:ent_quote"]'))
    expect(banner()).toBeNull()
    await click(q('[data-tree-item="collection:ent_post"]'))
    expect(banner()).not.toBeNull()
  })

  it('is not on a connection\'s or a query\'s screen: only a collection is changed by a plan', async () => {
    await open()
    await click(q('[data-tree-item="connection:ds_quotes"]'))
    expect(banner()).toBeNull()
    await click(q('[data-tree-item="query:q_all_posts"]'))
    expect(banner()).toBeNull()
  })

  it('is not shown when nothing is pending', async () => {
    await open({ pending: null })
    expect(banner()).toBeNull()
  })

  it('is not shown without a database, even with a plan on file (V7)', async () => {
    await open({ database: false })
    expect(banner()).toBeNull()
  })

  it('opens the plan on Review', async () => {
    const { router } = await open()
    await click(q('[data-testid="collection-migration-review"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'migrations' }))
    expect(q('[data-testid="statements"]')?.textContent).toContain(DROP)
  })

  it('leaves the banner and the entry when the plan is applied from the review', async () => {
    await open()
    await click(q('[data-testid="collection-migration-review"]'))
    await click(q('[data-testid="confirm"]'))
    await click(document.body.querySelector<HTMLElement>('[data-testid="confirm-migration"]'))
    await click(q('[data-tree-item="collection:ent_post"]'))
    expect(banner()).toBeNull()
    expect(entry()).toBeNull()
  })
})

describe('Apply on the banner', () => {
  it('is offered only when the plan loses nothing: a plan that loses data has Review alone', async () => {
    await open()
    expect(apply()).toBeNull()
    expect(q('[data-testid="collection-migration-review"]')).not.toBeNull()
  })

  it('is not offered when a statement loses data though the module listed nothing (fail closed)', async () => {
    await open({ pending: { ...safePlan(), statements: [DROP] } })
    expect(banner()).not.toBeNull()
    expect(apply()).toBeNull()
  })

  it('is not offered when a collection other than this one loses data: the plan is one, Apply would confirm all of it', async () => {
    await open({ pending: { ...pendingPlan(), statements: [ADD, 'DROP TABLE `blog_gone`;'] } })
    expect(apply()).toBeNull()
  })

  it('says Apply when the plan changes only this collection', async () => {
    await open({ pending: safePlan() })
    expect(text(apply())).toBe('Apply')
  })

  it('says Apply all changes when the plan changes more than this collection', async () => {
    const { change } = await open({ pending: { ...safePlan(), statements: [ADD, 'CREATE TABLE `blog_notes` (`id` text);'] } })
    expect(text(apply())).toBe('Apply all changes')
    await change(safePlan())
    expect(text(apply())).toBe('Apply')
  })

  it('applies a plan that loses nothing straight away, by the hash it was rendered with', async () => {
    const { actions, router } = await open({ pending: safePlan() })
    await click(apply())
    expect(actions.named('migration_confirm')).toHaveLength(1)
    expect(actions.named('migration_confirm')[0]?.input).toEqual({ hash: 'safe42' })
    expect(document.body.querySelector('[data-testid="confirm-migration"]')).toBeNull()
    expect(router.currentRoute.value.query.item).toBe('collection:ent_post')
    expect(banner()).toBeNull()
  })

  it('confirms nothing when the plan changed between the banner and the click: it opens Review, with a note', async () => {
    const { actions, router, change } = await open({ pending: safePlan() })
    await change({ ...safePlan(), hash: 'safe43', statements: [ADD, 'ALTER TABLE `blog_posts` ADD `summary` text;'] })
    await click(apply())
    expect(actions.named('migration_confirm')).toHaveLength(0)
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'migrations' }))
    expect(text(q('[data-testid="migration-note"]'))).toBe(UPDATED)
  })

  it('takes the new plan\'s hash when the collection is shown again after the stale bounce to Review', async () => {
    const { actions, change } = await open({ pending: safePlan() })
    await change({ ...safePlan(), hash: 'safe43' })
    await click(apply())
    expect(actions.named('migration_confirm')).toHaveLength(0)
    expect(text(q('[data-testid="migration-note"]'))).toBe(UPDATED)
    await click(q('[data-tree-item="collection:ent_post"]'))
    await click(apply())
    expect(actions.named('migration_confirm').map(call => call.input)).toEqual([{ hash: 'safe43' }])
  })

  it('confirms nothing when the plan came to lose data between the banner and the click', async () => {
    const { actions, router, change } = await open({ pending: safePlan() })
    await change(losingPlan())
    expect(apply()).toBeNull()
    expect(actions.named('migration_confirm')).toHaveLength(0)
    await click(q('[data-testid="collection-migration-review"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'migrations' }))
    expect(q('[data-testid="migration-note"]')).toBeNull()
  })

  it('sends exactly one migration_confirm for a double click', async () => {
    const { actions } = await open({
      pending: safePlan(),
      confirm: async () => {
        await new Promise(resolve => setTimeout(resolve, 30))
        return { migration: { kind: 'written', tag: '0003_bildr', statements: ['x'], applied: true } }
      }
    })
    const button = apply()!
    button.click()
    button.click()
    await settle()
    await new Promise(resolve => setTimeout(resolve, 60))
    await settle()
    expect(actions.named('migration_confirm')).toHaveLength(1)
  })

  it('says it was not applied when the confirmation failed, keeps the banner and can be tried again', async () => {
    const { actions, router } = await open({ pending: safePlan(), confirm: () => new Failure(500, 'internal', 'The database is locked') })
    await click(apply())
    expect(actions.named('migration_confirm')).toHaveLength(1)
    expect(document.body.textContent).toContain('Not applied')
    expect(document.body.textContent).toContain('The database is locked')
    expect(banner()).not.toBeNull()
    expect(router.currentRoute.value.query.item).toBe('collection:ent_post')
    await click(apply())
    expect(actions.named('migration_confirm')).toHaveLength(2)
  })

  it('opens Review, with a note, when the module answers that the plan changed since it was shown (pending)', async () => {
    const { router, actions } = await open({
      pending: safePlan(),
      confirm: () => ({ migration: { kind: 'pending', hash: 'safe99', destructive: [], losing: [], statements: [ADD] } })
    })
    await click(apply())
    expect(actions.named('migration_confirm')).toHaveLength(1)
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ item: 'migrations' }))
    expect(text(q('[data-testid="migration-note"]'))).toBe(UPDATED)
  })
})

describe('the global banner', () => {
  it('stays on the other screens, and its Review goes to the plan in the Data workspace', async () => {
    const { router } = await open({ path: '/health' })
    expect(text(globalBanner())).toContain('1 loss')
    await click(q('[data-testid="migration-banner"] a'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query).toEqual({ item: 'migrations' })
  })

  it('is shown on the Canvas', async () => {
    await open({ path: '/design' })
    expect(globalBanner()).not.toBeNull()
  })

  it('comes back when the Data screen, which showed the plan in a collection\'s banner, is left for the Canvas', async () => {
    const { router } = await open()
    expect(banner()).not.toBeNull()
    expect(globalBanner()).toBeNull()
    await router.push('/design')
    await settle()
    expect(router.currentRoute.value.path).toBe('/design')
    expect(globalBanner()).not.toBeNull()
  })

  it('is not shown on the Data screen while the collection\'s banner is', async () => {
    await open()
    expect(banner()).not.toBeNull()
    expect(globalBanner()).toBeNull()
  })

  it('is not shown on the Data screen while the Migrations entry shows the plan', async () => {
    await open({ path: '/data?item=migrations' })
    expect(globalBanner()).toBeNull()
  })

  it('is shown on the Data screen when what it shows is not the plan nor a collection the plan changes', async () => {
    await open()
    await click(q('[data-tree-item="collection:ent_quote"]'))
    await settle()
    expect(banner()).toBeNull()
    expect(globalBanner()).not.toBeNull()
  })

  it('is shown on All model files, where nothing else shows the plan', async () => {
    await open({ path: '/data?item=files' })
    expect(q('[data-data-workspace]')).not.toBeNull()
    expect(banner()).toBeNull()
    expect(globalBanner()).not.toBeNull()
  })

  it('comes back when the plan is left for All model files, and goes again when the collection is chosen', async () => {
    await open()
    expect(globalBanner()).toBeNull()
    await click(q('[data-raw-model]'))
    expect(globalBanner()).not.toBeNull()
    await click(q('[data-tree-item="collection:ent_post"]'))
    expect(globalBanner()).toBeNull()
  })

  it('is not shown without a database', async () => {
    await open({ path: '/health', database: false })
    expect(globalBanner()).toBeNull()
  })
})
