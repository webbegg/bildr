import { describe, expect, it } from 'vitest'
import { planLosesData } from '../../src/editor/migrationConfirm.ts'

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
