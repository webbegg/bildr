import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateData } from '../../src/generate/data'
import { loadModel } from '../../src/model/load'
import type { Model } from '../../src/model/load'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

const fixtureModel = (): Model => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}

/** The data layer of the golden fixture: what entities, repositories, queries, state and fixtures generate (T5). */
const DATA_FILES = [
  'layers/blog/app/composables/blog/useAllPosts.ts',
  'layers/blog/app/composables/blog/useBlogPreferences.ts',
  'layers/blog/app/composables/blog/useFeaturedPosts.ts',
  'layers/blog/app/composables/blog/useLatestQuotes.ts',
  'layers/blog/app/composables/blog/usePostBySlug.ts',
  'layers/blog/app/data/posts.collection.ts',
  'layers/blog/app/data/preferences.collection.ts',
  'layers/blog/app/data/quotes.collection.ts',
  'layers/blog/nuxt.config.ts',
  'layers/blog/server/api/blog/posts/index.get.ts',
  'layers/blog/server/api/blog/quotes/index.get.ts',
  'layers/blog/server/application/ports/post-repository.ts',
  'layers/blog/server/application/ports/quote-repository.ts',
  'layers/blog/server/application/queries/list-posts.ts',
  'layers/blog/server/application/queries/list-quotes.ts',
  'layers/blog/server/infrastructure/db/schema.ts',
  'layers/blog/server/infrastructure/db/seed.ts',
  'layers/blog/server/infrastructure/repositories/post.drizzle.ts',
  'layers/blog/server/infrastructure/repositories/post.memory.ts',
  'layers/blog/server/infrastructure/repositories/quote.rest.ts',
  'layers/blog/server/tasks/blog/seed.ts',
  'layers/blog/shared/domain/post.ts',
  'layers/blog/shared/domain/quote.ts',
  'layers/blog/test/infrastructure/quote.rest.test.ts'
]

describe('generateData on the golden fixture', () => {
  const files = generateData(fixtureModel())
  const manifest = JSON.parse(readFileSync(join(fixtureRoot, '.bildr/manifest.json'), 'utf8')).files as Record<string, { owner: string, source?: string }>

  it('emits exactly the data-layer files', () => {
    expect(files.map(file => file.path)).toEqual(DATA_FILES)
  })

  it.each(DATA_FILES)('%s matches the fixture byte for byte', (path) => {
    expect(files.find(file => file.path === path)?.content).toBe(readFileSync(join(fixtureRoot, path), 'utf8'))
  })

  it('records each file as managed with the model file it comes from', () => {
    for (const file of files) {
      expect(file.owner, file.path).toBe('managed')
      expect(file.source, file.path).toBe(manifest[file.path]!.source)
    }
  })

  it('is deterministic', () => {
    expect(generateData(fixtureModel())).toEqual(files)
  })
})

describe('generateData rules', () => {
  it('maps entity fields to zod and Drizzle (optional, nullable, unique, number types)', () => {
    const model = fixtureModel()
    const post = model.modules.blog!.entities.find(entity => entity.name === 'Post')!
    post.fields.push(
      { id: 'fld_views', name: 'views', type: 'integer', min: 0 },
      { id: 'fld_rating', name: 'rating', type: 'number', nullable: true },
      { id: 'fld_code', name: 'code', type: 'text', required: true, unique: true }
    )
    const files = generateData(model)
    const domain = files.find(file => file.path === 'layers/blog/shared/domain/post.ts')!.content
    expect(domain).toContain('  views: z.number().int().min(0).optional(),\n')
    expect(domain).toContain('  rating: z.number().nullable().default(null),\n')
    expect(domain).toContain('export const PostCodeSchema = PostSchema.shape.code\n')
    const schema = files.find(file => file.path === 'layers/blog/server/infrastructure/db/schema.ts')!.content
    expect(schema).toContain('  views: integer(\'views\'),\n')
    expect(schema).toContain('  rating: real(\'rating\'),\n')
    expect(schema).toContain('  code: text(\'code\').notNull().unique(),\n')
    expect(schema).toContain('import { integer, real, sqliteTable, text } from \'drizzle-orm/sqlite-core\'')
    const drizzle = files.find(file => file.path === 'layers/blog/server/infrastructure/repositories/post.drizzle.ts')!.content
    expect(drizzle).not.toContain('findByCode')
  })

  it('emits only the operations a repository declares', () => {
    const model = fixtureModel()
    model.modules.blog!.repositories.find(repo => repo.id === 'repo_post')!.operations = ['list', 'get']
    const files = generateData(model)
    const port = files.find(file => file.path === 'layers/blog/server/application/ports/post-repository.ts')!.content
    expect(port).toContain('  get(id: string): Promise<Post | undefined>\n')
    expect(port).not.toContain('create(')
    expect(port).not.toContain('delete(')
  })

  it('escapes model strings in generated code', () => {
    const model = fixtureModel()
    const query = model.modules.blog!.queries.find(entry => entry.name === 'allPosts')!
    query.description = 'it\'s */ done'
    const composable = generateData(model).find(file => file.path === 'layers/blog/app/composables/blog/useAllPosts.ts')!.content
    expect(composable).toContain('/** Query "All posts": it\'s *\\/ done */')
  })

  it('refuses REST paging styles it cannot generate yet', () => {
    const model = fixtureModel()
    const quotes = model.modules.blog!.repositories.find(repo => repo.id === 'repo_quote')!
    ;(quotes.rest as { paging: { style: string } }).paging.style = 'cursor'
    expect(() => generateData(model)).toThrow('repo_quote: REST paging style "cursor" is not generated yet (supported: offset)')
  })
})
