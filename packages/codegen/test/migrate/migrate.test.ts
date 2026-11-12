import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyRenames, describeLosses, dropIndexesFirst, isDestructive, planRenames, renamesBetween, renameSql, schemaIds, unappliable, withoutAdditions } from '../../src/migrate/index'
import type { SchemaIds, Snapshot } from '../../src/migrate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

const fixtureModel = () => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}
const fixtureSnapshot = (): Snapshot => JSON.parse(readFileSync(join(fixtureRoot, 'server/database/migrations/meta/0000_snapshot.json'), 'utf8'))

describe('schemaIds', () => {
  it('maps each stored entity id to its table and each field id (implicit ones too) to its column', () => {
    expect(schemaIds(fixtureModel())).toEqual({
      tables: {
        ent_post: {
          table: 'blog_posts',
          columns: {
            fld_id: 'id', fld_title: 'title', fld_slug: 'slug', fld_body: 'body', fld_published: 'published',
            fld_published_at: 'published_at', fld_created_at: 'created_at', fld_updated_at: 'updated_at'
          }
        }
      }
    })
  })

  it('leaves out entities that are not stored in the app database (REST sources)', () => {
    expect(Object.keys(schemaIds(fixtureModel()).tables)).not.toContain('ent_quote')
  })
})

const ids = (table: string, columns: Record<string, string>): SchemaIds => ({ tables: { ent_post: { table, columns } } })

describe('renamesBetween and renameSql', () => {
  it('finds table and column renames by id, columns under the new table name', () => {
    const renames = renamesBetween(ids('blog_posts', { fld_title: 'title', fld_body: 'body' }), ids('blog_articles', { fld_title: 'headline', fld_body: 'body' }))
    expect(renames).toEqual({ tables: [{ from: 'blog_posts', to: 'blog_articles' }], columns: [{ table: 'blog_articles', from: 'title', to: 'headline' }] })
    expect(renameSql(renames)).toEqual([
      'ALTER TABLE `blog_posts` RENAME TO `blog_articles`;',
      'ALTER TABLE `blog_articles` RENAME COLUMN `title` TO `headline`;'
    ])
  })

  it('ignores added and removed ids: those are drizzle-kit\'s to diff', () => {
    expect(renamesBetween(ids('t', { a: 'a' }), { tables: { ent_other: { table: 'u', columns: { b: 'b' } } } })).toEqual({ tables: [], columns: [] })
    expect(renamesBetween(ids('t', { a: 'a' }), ids('t', { b: 'b' }))).toEqual({ tables: [], columns: [] })
  })

  it('refuses names that would break the SQL', () => {
    expect(() => renameSql({ tables: [{ from: 'a`; DROP TABLE x; --', to: 'b' }], columns: [] })).toThrow(/Unsafe SQL identifier/)
  })
})

describe('planRenames', () => {
  const post = (columns: Record<string, string>, table = 'blog_posts'): SchemaIds => ({ tables: { ent_post: { table, columns } } })

  it('renames directly when the new names are free', () => {
    const plan = planRenames(post({ fld_slug: 'slug' }), post({ fld_slug: 'handle' }), fixtureSnapshot())
    expect(plan).toEqual({
      renames: { tables: [], columns: [{ table: 'blog_posts', from: 'slug', to: 'handle' }] },
      sql: ['ALTER TABLE `blog_posts` RENAME COLUMN `slug` TO `handle`;'],
      conflicts: [],
      replaced: {}
    })
  })

  it('swaps two columns through temporary names, so each keeps its data (verification B2)', () => {
    const plan = planRenames(post({ fld_title: 'title', fld_body: 'body' }), post({ fld_title: 'body', fld_body: 'title' }), fixtureSnapshot())
    expect(plan.conflicts).toEqual([])
    expect(plan.sql).toEqual([
      'ALTER TABLE `blog_posts` RENAME COLUMN `title` TO `__bildr_rename_0`;',
      'ALTER TABLE `blog_posts` RENAME COLUMN `body` TO `__bildr_rename_1`;',
      'ALTER TABLE `blog_posts` RENAME COLUMN `__bildr_rename_0` TO `body`;',
      'ALTER TABLE `blog_posts` RENAME COLUMN `__bildr_rename_1` TO `title`;'
    ])
    // The old body column (the one with the '' default) is now called title, and the other way round.
    const columns = applyRenames(fixtureSnapshot(), plan.renames).tables.blog_posts!.columns
    expect(columns.title).toMatchObject({ name: 'title', default: '\'\'' })
    expect(columns.body).toMatchObject({ name: 'body' })
    expect(columns.body!.default).toBeUndefined()
  })

  it('moves a removed field\'s or entity\'s name out of the way when a rename takes it: drizzle-kit then drops it behind the gate (verification B2)', () => {
    const plan = planRenames(post({ fld_title: 'title', fld_body: 'body' }), post({ fld_body: 'title' }), fixtureSnapshot())
    expect(plan.conflicts).toEqual([])
    expect(plan.sql).toEqual([
      'ALTER TABLE `blog_posts` RENAME COLUMN `title` TO `__bildr_replaced_0`;',
      'ALTER TABLE `blog_posts` RENAME COLUMN `body` TO `title`;'
    ])
    const table = planRenames(
      { tables: { ent_post: { table: 'blog_posts', columns: {} }, ent_old: { table: 'blog_old', columns: {} } } },
      { tables: { ent_post: { table: 'blog_old', columns: {} } } },
      { tables: { blog_posts: fixtureSnapshot().tables.blog_posts!, blog_old: { ...fixtureSnapshot().tables.blog_posts!, name: 'blog_old' } } }
    )
    expect(table.sql).toEqual(['ALTER TABLE `blog_old` RENAME TO `__bildr_replaced_0`;', 'ALTER TABLE `blog_posts` RENAME TO `blog_old`;'])
  })

  it('refuses a rename onto a name bildr has no id for (a column added by hand)', () => {
    const plan = planRenames(post({ fld_body: 'body' }), post({ fld_body: 'title' }), fixtureSnapshot())
    expect(plan.conflicts).toEqual(['Column blog_posts.title exists but isn\'t in the model: remove it by hand, then rename blog_posts.body to title'])
  })

  it('moves a removed field\'s column out of the way when a new field takes its name, so the new field never inherits its data (verification A2)', () => {
    const plan = planRenames(post({ fld_body: 'body' }), post({ fld_other: 'body' }), fixtureSnapshot())
    expect(plan.conflicts).toEqual([])
    expect(plan.sql).toEqual(['ALTER TABLE `blog_posts` RENAME COLUMN `body` TO `__bildr_replaced_0`;'])
    expect(Object.keys(applyRenames(fixtureSnapshot(), plan.renames).tables.blog_posts!.columns)).toContain('__bildr_replaced_0')
  })

  it('does the same for a removed entity\'s table taken by a new entity', () => {
    const plan = planRenames({ tables: { ent_post: { table: 'blog_posts', columns: {} } } }, { tables: { ent_new: { table: 'blog_posts', columns: {} } } }, fixtureSnapshot())
    expect(plan.sql).toEqual(['ALTER TABLE `blog_posts` RENAME TO `__bildr_replaced_0`;'])
  })

  it('ignores renames of names the previous snapshot doesn\'t have (a hand-edited migrations folder)', () => {
    expect(planRenames(post({ fld_x: 'gone' }), post({ fld_x: 'other' }), fixtureSnapshot()).sql).toEqual([])
  })
})

describe('describeLosses', () => {
  it('says what confirming loses, by the names the user knows', () => {
    expect(describeLosses([
      'ALTER TABLE `main_notes` DROP COLUMN `body`;',
      'ALTER TABLE `main_notes` DROP COLUMN `__bildr_replaced_0`;',
      'DROP TABLE `main_old`;',
      'CREATE TABLE `__new_main_posts` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n',
      'DROP TABLE `main_posts`;'
    ], { __bildr_replaced_0: 'the data of main_notes.title (a removed field)' })).toEqual([
      'the data of main_notes.body',
      'the data of main_notes.title (a removed field)',
      'the table main_old',
      'a rebuild of main_posts to change its columns: values that don\'t fit the new types or constraints are lost or refused'
    ])
  })
})

describe('dropIndexesFirst', () => {
  it('runs every DROP INDEX before the rest, so a swapped table never meets the other\'s index name (verification N1)', () => {
    expect(dropIndexesFirst([
      'ALTER TABLE `a` RENAME TO `b`;',
      'DROP INDEX `a_code_unique`;',
      'CREATE UNIQUE INDEX `b_code_unique` ON `b` (`code`);',
      'DROP INDEX `b_code_unique`;',
      'CREATE UNIQUE INDEX `a_code_unique` ON `a` (`code`);'
    ])).toEqual([
      'DROP INDEX `a_code_unique`;',
      'DROP INDEX `b_code_unique`;',
      'ALTER TABLE `a` RENAME TO `b`;',
      'CREATE UNIQUE INDEX `b_code_unique` ON `b` (`code`);',
      'CREATE UNIQUE INDEX `a_code_unique` ON `a` (`code`);'
    ])
  })
})

describe('unappliable', () => {
  it('names the statements SQLite refuses on any table: a NOT NULL column added without a default (verification B1)', () => {
    expect(unappliable(['ALTER TABLE `main_notes` ADD `n` text NOT NULL;'])).toEqual(['main_notes.n is required: give the field a default value, so existing rows get one'])
    expect(unappliable(['ALTER TABLE `main_notes` ADD `n` text DEFAULT \'x\' NOT NULL;', 'ALTER TABLE `main_notes` ADD `m` text;'])).toEqual([])
  })
})

describe('snapshot transforms', () => {
  it('applyRenames renames tables, columns and index columns in the previous snapshot without touching the input', () => {
    const before = fixtureSnapshot()
    const copy = JSON.stringify(before)
    const renamed = applyRenames(before, { tables: [{ from: 'blog_posts', to: 'blog_articles' }], columns: [{ table: 'blog_articles', from: 'slug', to: 'handle' }] })
    expect(JSON.stringify(before)).toBe(copy)
    expect(Object.keys(renamed.tables)).toEqual(['blog_articles'])
    const table = renamed.tables.blog_articles!
    expect(table.name).toBe('blog_articles')
    expect(table.columns.handle).toMatchObject({ name: 'handle', type: 'text', notNull: true })
    expect(table.columns.slug).toBeUndefined()
    expect(Object.values(table.indexes).flatMap(index => index.columns)).toEqual(['handle'])
  })

  it('withoutAdditions keeps only the tables and columns the base already had, and drops indexes on new columns', () => {
    const base = fixtureSnapshot()
    const current = fixtureSnapshot()
    current.tables.blog_posts!.columns.views = { name: 'views', type: 'integer', primaryKey: false, notNull: false, autoincrement: false }
    current.tables.blog_posts!.indexes.blog_posts_views_unique = { name: 'blog_posts_views_unique', columns: ['views'], isUnique: true }
    current.tables.blog_tags = { ...current.tables.blog_posts!, name: 'blog_tags' }
    const step = withoutAdditions(current, base)
    expect(Object.keys(step.tables)).toEqual(['blog_posts'])
    expect(step.tables.blog_posts!.columns.views).toBeUndefined()
    expect(step.tables.blog_posts!.indexes.blog_posts_views_unique).toBeUndefined()
    expect(step.tables.blog_posts!.indexes.blog_posts_slug_unique).toBeDefined()
  })
})

describe('isDestructive', () => {
  it('flags statements that lose data: dropped tables and columns, table rebuilds', () => {
    expect(isDestructive('DROP TABLE `blog_posts`;')).toBe(true)
    expect(isDestructive('ALTER TABLE `blog_posts` DROP COLUMN `views`;')).toBe(true)
    expect(isDestructive('CREATE TABLE `__new_blog_posts` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n')).toBe(true)
  })

  it('lets additions, renames and index changes through', () => {
    expect(isDestructive('ALTER TABLE `blog_posts` ADD `views` integer;')).toBe(false)
    expect(isDestructive('CREATE TABLE `blog_tags` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n')).toBe(false)
    expect(isDestructive('ALTER TABLE `a` RENAME COLUMN `b` TO `c`;')).toBe(false)
    expect(isDestructive('DROP INDEX `blog_posts_slug_unique`;')).toBe(false)
    expect(isDestructive('CREATE UNIQUE INDEX `blog_posts_slug_unique` ON `blog_posts` (`slug`);')).toBe(false)
  })
})
