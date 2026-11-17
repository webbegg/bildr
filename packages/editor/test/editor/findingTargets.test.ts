import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { findingTarget, problemTarget, targetKey } from '../../src/editor/findingTargets.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * Where a Health finding, a drift item or a model problem leads (S8): the findings are shaped as `@bildr/nuxt`'s
 * checks give them (`packages/nuxt/test/health.test.ts`: `file` relative to the project with `/`, `line`, `rule`), over the paths
 * the blog golden fixture generates; the owner of a generated file is the model file it is generated from.
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model

const POST = '.bildr/modules/blog/entities/post.json'
const code = (path: string, file: string) => ({ kind: 'code', id: file, label: 'Open in Code', to: { path: '/code', query: { path, file } } })

describe('where a finding leads: the generated file in Code, and the item it comes from', () => {
  it('links a lint finding in a generated page to Code and to the page, which opens on the canvas', () => {
    const finding = { file: 'layers/blog/app/pages/index.vue', line: 3, message: 'Import of server code from the app', rule: 'no-restricted-imports', boundary: true }
    expect(findingTarget(finding, model)).toEqual([
      code('.bildr/modules/blog/pages/index.json', 'layers/blog/app/pages/index.vue'),
      { kind: 'page', id: 'pg_index', label: 'Open Page index' }
    ])
  })

  it('links a type error in a generated collection file to Code and to the collection in the Data workspace', () => {
    const finding = { file: 'layers/blog/shared/domain/post.ts', line: 1, rule: 'TS2322', message: 'Type \'string\' is not assignable to type \'number\'.' }
    expect(findingTarget(finding, model)).toEqual([
      code(POST, 'layers/blog/shared/domain/post.ts'),
      { kind: 'collection', id: 'ent_post', label: 'Open Collection Post', to: { path: '/data', query: { item: 'collection:ent_post' } } }
    ])
  })

  it('links the generated files of a query, an action, a component and a layout to Code and to that item', () => {
    const owners = (file: string) => findingTarget({ file, message: 'x' }, model).map(target => [target.kind, target.id, target.label])
    expect(owners('layers/blog/app/composables/blog/useFeaturedPosts.ts')).toEqual([
      ['code', 'layers/blog/app/composables/blog/useFeaturedPosts.ts', 'Open in Code'],
      ['query', 'q_featured_posts', 'Open Query Featured posts']
    ])
    expect(owners('layers/blog/server/application/actions/create-post.ts')).toEqual([
      ['code', 'layers/blog/server/application/actions/create-post.ts', 'Open in Code'],
      ['action', 'act_create_post', 'Open Action Create post']
    ])
    expect(owners('layers/blog/app/components/blog/Tip.vue')).toEqual([
      ['code', 'layers/blog/app/components/blog/Tip.vue', 'Open in Code'],
      ['component', 'cmp_tip', 'Open Component Tip']
    ])
    expect(owners('layers/core/app/layouts/main.vue')).toEqual([
      ['code', 'layers/core/app/layouts/main.vue', 'Open in Code'],
      ['layout', 'lay_main', 'Open Layout main']
    ])
  })

  it('links the files of a collection\'s repository to the collection it stores', () => {
    const targets = findingTarget({ file: 'layers/blog/server/infrastructure/repositories/quote.rest.ts', line: 12, message: 'x' }, model)
    expect(targets.map(target => target.kind)).toEqual(['code', 'collection'])
    expect(targets[1]).toMatchObject({ id: 'ent_quote', label: 'Open Collection Quote', to: { path: '/data', query: { item: 'collection:ent_quote' } } })
  })

  it('links a drift item the same way: a file edited by hand opens in Code', () => {
    // A drift item is `{ path, state }`: its file is the path.
    expect(findingTarget({ file: 'layers/blog/app/pages/index.vue' }, model)[0]).toEqual(code('.bildr/modules/blog/pages/index.json', 'layers/blog/app/pages/index.vue'))
  })

  it('links to Code alone when the model file has no item of its own (the theme)', () => {
    expect(findingTarget({ file: 'layers/core/app/assets/css/theme.css', message: 'x' }, model)).toEqual([code('.bildr/theme.json', 'layers/core/app/assets/css/theme.css')])
  })

  it('links nothing for a file Code cannot show: hand-written, or generated from a whole folder', () => {
    expect(findingTarget({ file: 'layers/main/app/utils/reach.ts', line: 1, message: 'x' }, model)).toEqual([])
    expect(findingTarget({ file: 'layers/blog/server/infrastructure/db/schema.ts', message: 'x' }, model)).toEqual([])
    expect(findingTarget({ message: 'The build failed' }, model)).toEqual([])
  })

  it('links nothing without a model, which is how the owner of a generated file is known', () => {
    expect(findingTarget({ file: 'layers/blog/app/pages/index.vue' }, null)).toEqual([])
  })

  it('names a target by its kind and id', () => {
    const [first, second] = findingTarget({ file: 'layers/blog/shared/domain/post.ts' }, model)
    expect([targetKey(first!), targetKey(second!)]).toEqual(['code:layers/blog/shared/domain/post.ts', 'collection:ent_post'])
  })
})

describe('where a model problem leads: its file in All model files, or its item once the model loads', () => {
  const files = (path: string) => ({ kind: 'files', id: path, label: 'Open in All model files', to: { path: '/data', query: { item: 'files', file: path } } })

  it('links a problem to its file in All model files while the model does not load', () => {
    const problem = { path: '.bildr/modules/blog/pages/index.json', message: 'Unknown node type "Wat"' }
    expect(problemTarget(problem, null)).toEqual([files(problem.path)])
  })

  it('links a problem to the item its file holds when the model loads: a collection, a connection, a query, an action or a page', () => {
    const at = (path: string) => problemTarget({ path, message: 'x' }, model).map(target => [target.kind, target.id])
    expect(at(POST)).toEqual([['collection', 'ent_post']])
    expect(at('.bildr/datasources/quotes.json')).toEqual([['connection', 'ds_quotes']])
    expect(at('.bildr/modules/blog/queries/featured-posts.json')).toEqual([['query', 'q_featured_posts']])
    expect(at('.bildr/modules/blog/actions/create-post.json')).toEqual([['action', 'act_create_post']])
    expect(at('.bildr/modules/blog/pages/index.json')).toEqual([['page', 'pg_index']])
    expect(at('.bildr/modules/blog/repositories/quote.json')).toEqual([['collection', 'ent_quote']])
    expect(at('.bildr/modules/blog/fixtures/post.json')).toEqual([['collection', 'ent_post']])
  })

  it('links a problem to its file when the item is not one the Data workspace lists (a sqlite storage, the project)', () => {
    expect(problemTarget({ path: '.bildr/datasources/main.json', message: 'x' }, model)).toEqual([files('.bildr/datasources/main.json')])
    expect(problemTarget({ path: '.bildr/bildr.json', message: 'x' }, model)).toEqual([files('.bildr/bildr.json')])
  })

  it('links nothing for a problem that is not in a model file (the manifest, the cache)', () => {
    expect(problemTarget({ path: '.bildr/manifest.json', message: 'x' }, model)).toEqual([])
    expect(problemTarget({ path: '.bildr/.cache/health.json', message: 'x' }, model)).toEqual([])
    expect(problemTarget({ path: 'package.json', message: 'x' }, null)).toEqual([])
  })
})
