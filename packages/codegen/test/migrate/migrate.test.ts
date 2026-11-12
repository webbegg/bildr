import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyRenames, isDestructive, renamesBetween, renameSql, schemaIds, withoutAdditions } from '../../src/migrate/index'
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
