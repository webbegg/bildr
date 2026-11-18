import { describe, expect, it, vi } from 'vitest'
import { generate } from '@bildr/codegen/generate'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { generatedOwners, targetKey, targetsOfFile, targetsOfFinding, targetsOfProblem } from '../../src/editor/findingTargets.ts'
import type { CheckFinding } from '../../src/types.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * Where a Health finding, a drift item or a model problem leads (S8): the findings are shaped as `@bildr/nuxt`'s
 * checks give them (`packages/nuxt/test/health.test.ts`: `file` relative to the project with `/`, `line`, `rule`), over the paths
 * the blog golden fixture generates; the owner of a generated file is the model file it is generated from.
 */

// Counts how often the generator runs, with its own behaviour.
vi.mock('@bildr/codegen/generate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bildr/codegen/generate')>()
  return { ...actual, generate: vi.fn(actual.generate) }
})

const modelOf = (): Model => {
  const loaded = loadModel(blogModelFiles())
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return loaded.model
}
const model = modelOf()

const POST = '.bildr/modules/blog/entities/post.json'
const finding = (file: string, extra: Partial<CheckFinding> = {}): CheckFinding => ({ file, message: 'x', ...extra })
const code = (path: string, file: string) => ({ kind: 'code', id: file, label: 'Open file in Code', to: { path: '/code', query: { path, file } } })
/** What a target says, as `[kind, id, label]`. */
const says = (targets: ReturnType<typeof targetsOfFile>) => targets.map(target => [target.kind, target.id, target.label])

describe('where a finding leads: the generated file in Code, and the item it comes from', () => {
  it('links a lint finding in a generated page to Code and to the page, which opens on the canvas', () => {
    const lint = finding('layers/blog/app/pages/index.vue', { line: 3, message: 'Import of server code from the app', rule: 'no-restricted-imports', boundary: true })
    expect(targetsOfFinding(lint, model)).toEqual([
      code('.bildr/modules/blog/pages/index.json', 'layers/blog/app/pages/index.vue'),
      { kind: 'page', id: 'pg_index', label: 'Open page “index”' }
    ])
  })

  it('links a type error in a generated collection file to Code and to the collection in the Data workspace', () => {
    const error = finding('layers/blog/shared/domain/post.ts', { line: 1, rule: 'TS2322', message: 'Type \'string\' is not assignable to type \'number\'.' })
    expect(targetsOfFinding(error, model)).toEqual([
      code(POST, 'layers/blog/shared/domain/post.ts'),
      { kind: 'collection', id: 'ent_post', label: 'Open collection “Post”' }
    ])
  })

  it('links the generated files of a query, an action, a component and a layout to Code and to that item', () => {
    expect(says(targetsOfFile('layers/blog/app/composables/blog/useFeaturedPosts.ts', model))).toEqual([
      ['code', 'layers/blog/app/composables/blog/useFeaturedPosts.ts', 'Open file in Code'],
      ['query', 'q_featured_posts', 'Open query “Featured posts”']
    ])
    expect(says(targetsOfFile('layers/blog/server/application/actions/create-post.ts', model))).toEqual([
      ['code', 'layers/blog/server/application/actions/create-post.ts', 'Open file in Code'],
      ['action', 'act_create_post', 'Open action “Create post”']
    ])
    expect(says(targetsOfFile('layers/blog/app/components/blog/Tip.vue', model))).toEqual([
      ['code', 'layers/blog/app/components/blog/Tip.vue', 'Open file in Code'],
      ['component', 'cmp_tip', 'Open component “Tip”']
    ])
    expect(says(targetsOfFile('layers/core/app/layouts/main.vue', model))).toEqual([
      ['code', 'layers/core/app/layouts/main.vue', 'Open file in Code'],
      ['layout', 'lay_main', 'Open layout “main”']
    ])
  })

  it('links the files of a collection\'s repository to the collection it stores', () => {
    const targets = targetsOfFinding(finding('layers/blog/server/infrastructure/repositories/quote.rest.ts', { line: 12 }), model)
    expect(targets.map(target => target.kind)).toEqual(['code', 'collection'])
    expect(targets[1]).toEqual({ kind: 'collection', id: 'ent_quote', label: 'Open collection “Quote”' })
  })

  it('links a drift item the same way: a file edited by hand opens in Code', () => {
    expect(targetsOfFile('layers/blog/app/pages/index.vue', model)[0]).toEqual(code('.bildr/modules/blog/pages/index.json', 'layers/blog/app/pages/index.vue'))
  })

  it('takes a path written as `./path` as the same file', () => {
    expect(targetsOfFile('./layers/blog/app/pages/index.vue', model)).toEqual(targetsOfFile('layers/blog/app/pages/index.vue', model))
  })

  it('links to Code alone when the model file has no item of its own (the theme)', () => {
    expect(targetsOfFile('layers/core/app/assets/css/theme.css', model)).toEqual([code('.bildr/theme.json', 'layers/core/app/assets/css/theme.css')])
  })

  it('links nothing for a file Code cannot show: hand-written, or generated from a whole folder', () => {
    expect(targetsOfFinding(finding('layers/main/app/utils/reach.ts', { line: 1 }), model)).toEqual([])
    expect(targetsOfFile('layers/blog/server/infrastructure/db/schema.ts', model)).toEqual([])
  })

  it('links nothing for a finding that names no file (a failed build)', () => {
    const build: CheckFinding = { message: 'The build failed' }
    expect(targetsOfFinding(build, model)).toEqual([])
  })

  it('links nothing without a model, which is how the owner of a generated file is known', () => {
    expect(targetsOfFile('layers/blog/app/pages/index.vue', null)).toEqual([])
  })

  it('names a target by its kind and id', () => {
    const [first, second] = targetsOfFile('layers/blog/shared/domain/post.ts', model)
    expect([targetKey(first!), targetKey(second!)]).toEqual(['code:layers/blog/shared/domain/post.ts', 'collection:ent_post'])
  })
})

describe('the generator is asked once for a model, not once for each link', () => {
  it('runs `generate` once for any number of files of the same model', () => {
    const fresh = modelOf()
    vi.mocked(generate).mockClear()
    for (const file of ['layers/blog/app/pages/index.vue', 'layers/blog/shared/domain/post.ts', 'layers/blog/app/components/blog/Tip.vue', 'layers/main/app/utils/reach.ts']) targetsOfFile(file, fresh)
    targetsOfFinding(finding('layers/blog/app/pages/index.vue'), fresh)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('runs it again for another model (the next version of it)', () => {
    vi.mocked(generate).mockClear()
    targetsOfFile('layers/blog/app/pages/index.vue', modelOf())
    targetsOfFile('layers/blog/app/pages/index.vue', modelOf())
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('says why there are no links when the generator refuses the model, and links nothing to a file', () => {
    const refused = modelOf()
    vi.mocked(generate).mockImplementationOnce(() => {
      throw new Error('Two collections share the plural “posts”')
    })
    expect(generatedOwners(refused).error).toBe('Two collections share the plural “posts”')
    expect(targetsOfFile('layers/blog/app/pages/index.vue', refused)).toEqual([])
    // The refusal is remembered with the model: the generator is not asked again.
    expect(vi.mocked(generate)).toHaveBeenCalledTimes(1)
  })

  it('says nothing is wrong for a model it generates, and while there is no model', () => {
    expect(generatedOwners(model).error).toBeNull()
    expect(generatedOwners(null)).toEqual({ owners: new Map(), error: null })
  })
})

describe('where a model problem leads: its file in All model files, or its item once the model loads', () => {
  const files = (path: string) => ({ kind: 'files', id: path, label: 'Open in All model files', to: { path: '/data', query: { item: 'files', file: path } } })

  it('links a problem to its file in All model files while the model does not load', () => {
    const problem = { path: '.bildr/modules/blog/pages/index.json', message: 'Unknown node type "Wat"' }
    expect(targetsOfProblem(problem, null)).toEqual([files(problem.path)])
  })

  it('links a problem to the item its file holds when the model loads: a collection, a connection, a query, an action or a page', () => {
    const at = (path: string) => targetsOfProblem({ path, message: 'x' }, model).map(target => [target.kind, target.id])
    expect(at(POST)).toEqual([['collection', 'ent_post']])
    expect(at('.bildr/datasources/quotes.json')).toEqual([['connection', 'ds_quotes']])
    expect(at('.bildr/modules/blog/queries/featured-posts.json')).toEqual([['query', 'q_featured_posts']])
    expect(at('.bildr/modules/blog/actions/create-post.json')).toEqual([['action', 'act_create_post']])
    expect(at('.bildr/modules/blog/pages/index.json')).toEqual([['page', 'pg_index']])
    expect(at('.bildr/modules/blog/repositories/quote.json')).toEqual([['collection', 'ent_quote']])
    expect(at('.bildr/modules/blog/fixtures/post.json')).toEqual([['collection', 'ent_post']])
  })

  it('names each item in the words of the workspace, quoted as the Used in lists quote', () => {
    const label = (path: string) => targetsOfProblem({ path, message: 'x' }, model)[0]?.label
    expect(label('.bildr/datasources/quotes.json')).toBe('Open connection “quotes”')
    expect(label('.bildr/modules/blog/entities/quote.json')).toBe('Open collection “Quote”')
  })

  it('links a problem to its file when the item is not one the Data workspace lists (a sqlite storage, the project)', () => {
    expect(targetsOfProblem({ path: '.bildr/datasources/main.json', message: 'x' }, model)).toEqual([files('.bildr/datasources/main.json')])
    expect(targetsOfProblem({ path: '.bildr/bildr.json', message: 'x' }, model)).toEqual([files('.bildr/bildr.json')])
  })

  it('links a problem to its file when the model loads but holds no item with that id (the file is what is broken)', () => {
    const path = '.bildr/modules/blog/pages/not-there.json'
    expect(targetsOfProblem({ path, message: 'x' }, model)).toEqual([files(path)])
  })

  it('links nothing for a problem that is not in a model file (the manifest, the cache)', () => {
    expect(targetsOfProblem({ path: '.bildr/manifest.json', message: 'x' }, model)).toEqual([])
    expect(targetsOfProblem({ path: '.bildr/.cache/health.json', message: 'x' }, model)).toEqual([])
    expect(targetsOfProblem({ path: 'package.json', message: 'x' }, null)).toEqual([])
  })
})
