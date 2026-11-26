import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { apiPaths, corePaths, importPath, modulePaths } from '../../src/generate/paths'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'

describe('importPath', () => {
  it('is the relative specifier from one generated file to another, without the .ts extension', () => {
    expect(importPath('layers/blog/server/utils/blog.ts', 'layers/blog/server/application/actions/create-post.ts'))
      .toBe('../application/actions/create-post')
    expect(importPath('layers/apis/app/data/weather.ts', 'layers/apis/app/data/browser-client.ts')).toBe('./browser-client')
    expect(importPath('layers/blog/test/application/x.test.ts', 'layers/blog/server/infrastructure/db/seed.ts'))
      .toBe('../../server/infrastructure/db/seed')
  })

  it('keeps dotted file names: only the .ts extension goes', () => {
    expect(importPath('layers/blog/app/composables/blog/usePosts.ts', 'layers/blog/app/data/posts.collection.ts'))
      .toBe('../../data/posts.collection')
  })
})

describe('output paths', () => {
  it('names the core, module and API-source artifacts', () => {
    expect(corePaths.layout('main')).toBe('layers/core/app/layouts/main.vue')
    expect(modulePaths('blog').repository('post', 'drizzle')).toBe('layers/blog/server/infrastructure/repositories/post.drizzle.ts')
    // An API source in the rings of a module, all under shared/ (codegen-architecture T3d).
    expect(apiPaths('catalog').port('catalog-repository')).toBe('layers/apis/shared/application/catalog/ports/catalog-repository.ts')
    expect(apiPaths('catalog').useCase('query', 'products')).toBe('layers/apis/shared/application/catalog/queries/products.ts')
    expect(apiPaths('catalog').useCase('action', 'create-product')).toBe('layers/apis/shared/application/catalog/actions/create-product.ts')
    expect(apiPaths('catalog').adapter('catalog-repository.http')).toBe('layers/apis/shared/infrastructure/catalog/repositories/catalog-repository.http.ts')
  })
})

// Every relative import of the generated app points at a file the generator emits: a guard for moving
// paths around, independent of the golden fixture's bytes.
describe('relative imports on the golden fixture', () => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  const files = generate(result.model)
  const paths = new Set(files.map(file => file.path))

  const resolve = (from: string, specifier: string): string => {
    const parts = from.split('/').slice(0, -1)
    for (const part of specifier.split('/')) {
      if (part === '..') parts.pop()
      else if (part !== '.') parts.push(part)
    }
    return parts.join('/')
  }

  it('resolves to a generated file', () => {
    const missing = files.filter(file => /\.(ts|vue)$/.test(file.path)).flatMap(file =>
      [...file.content.matchAll(/(?:from|import\() ?'(\.\.?\/[^']+)'/g)]
        .map(match => resolve(file.path, match[1]!))
        .filter(target => !['', '.ts', '.vue', '/index.ts', '.d.ts'].some(ext => paths.has(target + ext)))
        .map(target => `${file.path} -> ${target}`))
    expect(missing).toEqual([])
  })
})
