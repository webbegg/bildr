import { describe, expect, it } from 'vitest'
import { planLosesData, useMigrationConfirm } from '../../src/editor/migrationConfirm.ts'
import { createStatus } from '../../src/status.ts'
import { pendingPlan } from '../fixtures.ts'
import { mockActions } from '../helpers.ts'

/** Whether confirming a plan can lose data (S6): it fails closed, so a plan is safe only when nothing in it says otherwise. */

const plan = (parts: { losing?: string[], destructive?: string[], statements?: string[] }) => ({ losing: [], destructive: [], statements: [], ...parts })

describe('whether a plan loses data', () => {
  it('does not, when nothing in it says it can', () => {
    expect(planLosesData(plan({ statements: ['ALTER TABLE `blog_posts` ADD `subtitle` text;', 'CREATE TABLE `blog_notes` (`id` text);'] }))).toBe(false)
  })

  it('does, when it lists what it loses', () => {
    expect(planLosesData(plan({ losing: ['the data of blog_posts.body'] }))).toBe(true)
  })

  it('does, when the module lists destructive statements', () => {
    expect(planLosesData(plan({ destructive: ['DROP TABLE `blog_notes`;'] }))).toBe(true)
  })

  it('does, when a statement is destructive even though the module listed none (fail closed)', () => {
    expect(planLosesData(plan({ statements: ['ALTER TABLE `blog_posts` ADD `a` text;', 'ALTER TABLE `blog_posts` DROP COLUMN `body`;'] }))).toBe(true)
    expect(planLosesData(plan({ statements: ['DROP TABLE `blog_notes`;'] }))).toBe(true)
    expect(planLosesData(plan({ statements: ['CREATE TABLE `__new_blog_posts` (`id` text);'] }))).toBe(true)
  })
})

/** Confirming is one at a time per status (S6): the banner's Apply and the Review's Apply are askers of the same plan. */
describe('confirming the plan', () => {
  const written = { migration: { kind: 'written', tag: '0003_bildr', statements: ['x'], applied: true } }

  it('runs one migration_confirm at a time across every asker of the same status', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const actions = mockActions({
      migration_confirm: async () => {
        await gate
        return written
      },
      migration_pending_get: () => ({ pending: null, database: true })
    })
    const status = createStatus()
    status.pending.value = pendingPlan()
    const banner = useMigrationConfirm(status)
    const review = useMigrationConfirm(status)
    const first = banner.confirm('abc123')
    expect(review.confirming.value).toBe(true)
    expect(await review.confirm('abc123')).toBe('nothing')
    release()
    expect(await first).toBe('confirmed')
    expect(actions.named('migration_confirm')).toHaveLength(1)
    expect(review.confirming.value).toBe(false)
  })

  it('does not share the guard between statuses', async () => {
    const actions = mockActions({
      migration_confirm: () => written,
      migration_pending_get: () => ({ pending: null, database: true })
    })
    const one = createStatus()
    const other = createStatus()
    one.pending.value = pendingPlan()
    other.pending.value = pendingPlan()
    await Promise.all([useMigrationConfirm(one).confirm('abc123'), useMigrationConfirm(other).confirm('abc123')])
    expect(actions.named('migration_confirm')).toHaveLength(2)
  })

  it('refuses a hash that is not the plan\'s, and confirms nothing', async () => {
    const actions = mockActions({ migration_confirm: () => written, migration_pending_get: () => ({ pending: null, database: true }) })
    const status = createStatus()
    status.pending.value = pendingPlan()
    expect(await useMigrationConfirm(status).confirm('other')).toBe('stale')
    expect(actions.named('migration_confirm')).toHaveLength(0)
  })
})
