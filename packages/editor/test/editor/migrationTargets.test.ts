import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { migrationTargets } from '../../src/editor/migrationTargets.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * A pending plan → the collections it changes, and what it loses in their words (S6). The statements are the ones drizzle-kit writes
 * for SQLite (the module's own tests, `packages/codegen/test/migrate` and `packages/nuxt/test/migrations.test.ts`, hold the same
 * ones), over the blog fixture: Post is stored in sqlite as `blog_posts` (its repository names the table), Quote is read through a
 * REST connection (no table), and a Note is added whose repository names no table, so it is `blog_notes` (the module's name, then the plural).
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

/** A plan as the module writes it: the statements, which of them lose data, and what that loses (its own lines, by table and column). */
const plan = (statements: string[], losing: string[] = [], destructive: string[] = []) => ({ statements, losing, destructive })

describe('which collections a pending plan changes', () => {
  it('maps a created table to its collection, which loses nothing', () => {
    const targets = migrationTargets(withNotes(), plan(['CREATE TABLE `blog_notes` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`title` text NOT NULL\n);\n']))
    expect(targets.collections).toEqual({ ent_note: { name: 'Note', losesData: false, losing: [] } })
    expect(targets.other).toBe(0)
  })

  it('maps an added column to an altered collection', () => {
    const targets = migrationTargets(withNotes(), plan(['ALTER TABLE `blog_posts` ADD `subtitle` text;']))
    expect(targets.collections).toEqual({ ent_post: { name: 'Post', losesData: false, losing: [] } })
  })

  it('says a dropped column loses data, and only for the collection that loses it', () => {
    const drop = 'ALTER TABLE `blog_posts` DROP COLUMN `body`;'
    const targets = migrationTargets(withNotes(), plan([drop, 'ALTER TABLE `blog_notes` ADD `body` text;'], ['the data of blog_posts.body'], [drop]))
    expect(targets.collections.ent_post).toEqual({ name: 'Post', losesData: true, losing: ['Post · body'] })
    expect(targets.collections.ent_note?.losesData).toBe(false)
    expect(targets.collections.ent_note?.losing).toEqual([])
  })

  it('maps a rename by the name the table has now, and a renamed column by its table', () => {
    const targets = migrationTargets(withNotes(), plan(['ALTER TABLE `blog_articles` RENAME TO `blog_posts`;', 'ALTER TABLE `blog_posts` RENAME COLUMN `title` TO `heading`;']))
    expect(Object.keys(targets.collections)).toEqual(['ent_post'])
    expect(targets.collections.ent_post).toMatchObject({ losesData: false })
    expect(targets.other).toBe(0)
  })

  it('maps an index to the table it is on, and a dropped index (which names no table) by the table its name starts with', () => {
    const targets = migrationTargets(withNotes(), plan([
      'DROP INDEX `blog_notes_title_unique`;',
      'CREATE UNIQUE INDEX `blog_posts_slug_unique` ON `blog_posts` (`slug`);'
    ]))
    expect(Object.keys(targets.collections).sort()).toEqual(['ent_note', 'ent_post'])
    expect(targets.collections.ent_note?.losesData).toBe(false)
    expect(targets.collections.ent_post?.losesData).toBe(false)
    expect(targets.other).toBe(0)
  })

  it('reads drizzle-kit\'s table rebuild as one collection that loses data, with its PRAGMAs belonging to nothing', () => {
    const rebuild = [
      'PRAGMA foreign_keys=OFF;',
      'CREATE TABLE `__new_blog_posts` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n',
      'INSERT INTO `__new_blog_posts`(`id`) SELECT `id` FROM `blog_posts`;',
      'DROP TABLE `blog_posts`;',
      'ALTER TABLE `__new_blog_posts` RENAME TO `blog_posts`;',
      'PRAGMA foreign_keys=ON;'
    ]
    const targets = migrationTargets(withNotes(), plan(rebuild, ['a rebuild of blog_posts to change its columns: values that don\'t fit the new types or constraints are lost or refused']))
    expect(Object.keys(targets.collections)).toEqual(['ent_post'])
    expect(targets.collections.ent_post).toEqual({ name: 'Post', losesData: true, losing: ['Post · values that don\'t fit its changed fields are lost or refused'] })
    expect(targets.other).toBe(0)
  })

  it('counts what maps to no collection (a table of a collection that is gone, moved-aside tables), not the PRAGMAs', () => {
    const targets = migrationTargets(withNotes(), plan(['DROP TABLE `blog_gone`;', 'DROP TABLE `__bildr_replaced_0`;', 'ALTER TABLE `blog_posts` ADD `subtitle` text;', 'PRAGMA foreign_keys=ON;']))
    expect(targets.other).toBe(2)
    expect(Object.keys(targets.collections)).toEqual(['ent_post'])
  })

  it('never maps a collection that is not stored in the database (a REST one has no table)', () => {
    const targets = migrationTargets(withNotes(), plan(['ALTER TABLE `blog_quotes` ADD `x` text;']))
    expect(targets.collections).toEqual({})
    expect(targets.other).toBe(1)
  })

  it('has nothing to map without a model, and says what is lost by the names the module used', () => {
    const targets = migrationTargets(null, plan(['ALTER TABLE `blog_posts` DROP COLUMN `body`;'], ['the data of blog_posts.body']))
    expect(targets.collections).toEqual({})
    expect(targets.other).toBe(1)
    expect(targets.losing).toEqual(['blog_posts · body'])
  })

  it('flags a collection as losing data by the module\'s own list of destructive statements too, not only by the SQL it recognises', () => {
    const odd = 'ALTER TABLE `blog_posts` MODIFY `body` text;'
    const targets = migrationTargets(withNotes(), plan([odd], [], [odd]))
    expect(targets.collections.ent_post?.losesData).toBe(true)
  })
})

describe('what a pending plan loses, in the words of the collections', () => {
  it('names the collection and the field of a dropped column, and falls back to the table and column when no collection owns them', () => {
    const targets = migrationTargets(withNotes(), plan([], ['the data of blog_posts.body', 'the data of blog_gone.notes']))
    expect(targets.losing).toEqual(['Post · body', 'blog_gone · notes'])
  })

  it('says all the rows of a dropped table are lost, by the collection\'s name when it has one', () => {
    const targets = migrationTargets(withNotes(), plan([], ['the table blog_notes', 'the table blog_gone']))
    expect(targets.losing).toEqual(['Note · all its rows', 'blog_gone · all its rows'])
  })

  it('keeps a line it does not know as the module wrote it, owned by no collection', () => {
    const targets = migrationTargets(withNotes(), plan([], ['Table "blog_notes" and all its rows']))
    expect(targets.losing).toEqual(['Table "blog_notes" and all its rows'])
    expect(targets.collections).toEqual({})
  })

  it('lists, for a collection, only what it loses', () => {
    const targets = migrationTargets(withNotes(), plan(
      ['ALTER TABLE `blog_posts` DROP COLUMN `body`;', 'ALTER TABLE `blog_notes` DROP COLUMN `text`;'],
      ['the data of blog_posts.body', 'the data of blog_notes.text'],
      ['ALTER TABLE `blog_posts` DROP COLUMN `body`;', 'ALTER TABLE `blog_notes` DROP COLUMN `text`;']
    ))
    expect(targets.losing).toEqual(['Post · body', 'Note · text'])
    expect(targets.collections.ent_post?.losing).toEqual(['Post · body'])
    expect(targets.collections.ent_note?.losing).toEqual(['Note · text'])
  })
})
