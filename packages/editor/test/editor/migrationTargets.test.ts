import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { migrationTargets } from '../../src/editor/migrationTargets.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * A pending plan → the collections it changes (S6). The statements are the ones drizzle-kit writes for SQLite (the module's own tests,
 * `packages/codegen/test/migrate` and `packages/nuxt/test/migrations.test.ts`, hold the same ones), over the blog fixture: Post is
 * stored in sqlite as `blog_posts` (its repository names the table), Quote is read through a REST connection (no table), and a Note
 * is added whose repository names no table, so it is `blog_notes` (the module's name, then the plural).
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))

const withNotes = (): Model => {
  const model = structuredClone(loaded.model)
  const blog = model.modules.blog!
  blog.entities.push({ ...structuredClone(blog.entities[0]!), id: 'ent_note', name: 'Note', plural: 'notes' })
  blog.repositories.push({ id: 'repo_note', entity: 'ent_note', datasource: 'ds_main', operations: ['list'] } as Model['modules'][string]['repositories'][number])
  return model
}

const plan = (...statements: string[]) => ({ statements })

describe('which collections a pending plan changes', () => {
  it('maps a created table to its collection, which loses nothing', () => {
    const targets = migrationTargets(withNotes(), plan('CREATE TABLE `blog_notes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`title` text NOT NULL\n);\n'))
    expect(targets.collections).toEqual({
      ent_note: { kinds: ['create'], statements: ['CREATE TABLE `blog_notes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`title` text NOT NULL\n);\n'], losesData: false }
    })
    expect(targets.other).toEqual([])
  })

  it('maps an added column to an altered collection', () => {
    const targets = migrationTargets(withNotes(), plan('ALTER TABLE `blog_posts` ADD `subtitle` text;'))
    expect(targets.collections).toEqual({ ent_post: { kinds: ['alter'], statements: ['ALTER TABLE `blog_posts` ADD `subtitle` text;'], losesData: false } })
  })

  it('says a dropped column loses data, and only for the collection that loses it', () => {
    const targets = migrationTargets(withNotes(), plan('ALTER TABLE `blog_posts` DROP COLUMN `body`;', 'ALTER TABLE `blog_notes` ADD `body` text;'))
    expect(targets.collections.ent_post).toEqual({ kinds: ['alter'], statements: ['ALTER TABLE `blog_posts` DROP COLUMN `body`;'], losesData: true })
    expect(targets.collections.ent_note?.losesData).toBe(false)
  })

  it('maps a rename by the name the table has now, and a renamed column by its table', () => {
    const targets = migrationTargets(withNotes(), plan('ALTER TABLE `blog_articles` RENAME TO `blog_posts`;', 'ALTER TABLE `blog_posts` RENAME COLUMN `title` TO `heading`;'))
    expect(Object.keys(targets.collections)).toEqual(['ent_post'])
    expect(targets.collections.ent_post).toMatchObject({ kinds: ['alter'], losesData: false })
    expect(targets.collections.ent_post!.statements).toHaveLength(2)
    expect(targets.other).toEqual([])
  })

  it('maps an index to the table it is on, and a dropped index (which names no table) by the table its name starts with', () => {
    const targets = migrationTargets(withNotes(), plan(
      'DROP INDEX `blog_notes_title_unique`;',
      'CREATE UNIQUE INDEX `blog_posts_slug_unique` ON `blog_posts` (`slug`);'
    ))
    expect(targets.collections.ent_note).toEqual({ kinds: ['alter'], statements: ['DROP INDEX `blog_notes_title_unique`;'], losesData: false })
    expect(targets.collections.ent_post).toEqual({ kinds: ['alter'], statements: ['CREATE UNIQUE INDEX `blog_posts_slug_unique` ON `blog_posts` (`slug`);'], losesData: false })
  })

  it('reads drizzle-kit\'s table rebuild as one altered collection that loses data, with its PRAGMAs belonging to no collection', () => {
    const rebuild = [
      'PRAGMA foreign_keys=OFF;',
      'CREATE TABLE `__new_blog_posts` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n',
      'INSERT INTO `__new_blog_posts`(`id`) SELECT `id` FROM `blog_posts`;',
      'DROP TABLE `blog_posts`;',
      'ALTER TABLE `__new_blog_posts` RENAME TO `blog_posts`;',
      'PRAGMA foreign_keys=ON;'
    ]
    const targets = migrationTargets(withNotes(), plan(...rebuild))
    expect(Object.keys(targets.collections)).toEqual(['ent_post'])
    expect(targets.collections.ent_post).toMatchObject({ kinds: ['alter'], losesData: true })
    expect(targets.collections.ent_post!.statements).toEqual(rebuild.slice(1, 5))
    expect(targets.other).toEqual([])
  })

  it('keeps what maps to no collection as "other": a table of a collection that is gone, and moved-aside tables', () => {
    const targets = migrationTargets(withNotes(), plan('DROP TABLE `blog_gone`;', 'DROP TABLE `__bildr_replaced_0`;', 'ALTER TABLE `blog_posts` ADD `subtitle` text;'))
    expect(targets.other).toEqual(['DROP TABLE `blog_gone`;', 'DROP TABLE `__bildr_replaced_0`;'])
    expect(Object.keys(targets.collections)).toEqual(['ent_post'])
  })

  it('never maps a collection that is not stored in the database (a REST one has no table)', () => {
    const targets = migrationTargets(withNotes(), plan('ALTER TABLE `blog_quotes` ADD `x` text;'))
    expect(targets.collections).toEqual({})
    expect(targets.other).toEqual(['ALTER TABLE `blog_quotes` ADD `x` text;'])
  })

  it('counts the changes: each collection once, and each statement of "other"', () => {
    const targets = migrationTargets(withNotes(), plan(
      'ALTER TABLE `blog_posts` ADD `a` text;',
      'ALTER TABLE `blog_posts` ADD `b` text;',
      'CREATE TABLE `blog_notes` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n',
      'DROP TABLE `blog_gone`;',
      'PRAGMA foreign_keys=ON;'
    ))
    expect(targets.count).toBe(3)
  })

  it('has nothing to map without a model', () => {
    expect(migrationTargets(null, plan('ALTER TABLE `blog_posts` ADD `a` text;'))).toEqual({ collections: {}, other: ['ALTER TABLE `blog_posts` ADD `a` text;'], count: 1 })
  })
})
