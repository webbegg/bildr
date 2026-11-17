import { describe, expect, it } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { Model } from '@bildr/codegen/model'
import { blogModelFiles } from '../canvas/fixture.ts'
import { collectionsOf, connectionsOf, detailPagesOf, entityProposal, fieldLabel, fieldTypeItems, fixtureRowsOf, restDefaults, sourceNameOf } from '../../src/shared/dataModel.ts'

/**
 * What the Data view reads of the model (U7): the hosted `Collection`/`Connection` as a read-only
 * view over entities, repositories and data sources. The blog fixture has `Post` (sqlite, with
 * fixtures and a detail page) and `Quote` (a REST entity over `ds_quotes`).
 */

const load = (): Model => {
  const loaded = loadModel(blogModelFiles())
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return loaded.model
}

describe('collectionsOf', () => {
  it('lists each entity with its fields, data source and what its repository does', () => {
    const [post, quote] = collectionsOf(load())
    expect(post).toMatchObject({ id: 'ent_post', name: 'Post', plural: 'posts', module: 'blog', kind: 'sqlite', datasource: 'ds_main', datasourceName: 'main', repository: 'repo_post', exposed: true, createAction: 'act_create_post' })
    expect(post!.fields.map(field => [field.id, field.name, field.type, field.label])).toEqual([
      ['fld_title', 'title', 'text', 'Title'],
      ['fld_slug', 'slug', 'text', 'Slug'],
      ['fld_body', 'body', 'text', 'Body'],
      ['fld_published', 'published', 'boolean', 'Published'],
      ['fld_published_at', 'publishedAt', 'datetime', 'Published at']
    ])
    expect(quote).toMatchObject({ id: 'ent_quote', name: 'Quote', kind: 'rest', datasource: 'ds_quotes', repository: 'repo_quote', exposed: true })
  })

  it('reads a REST entity\'s endpoints, paging and field map', () => {
    const quote = collectionsOf(load()).find(entry => entry.id === 'ent_quote')!
    expect(quote.endpoints).toEqual([{ op: 'list', method: 'GET', path: '/quotes', itemsPath: 'quotes', totalPath: 'total' }])
    expect(quote.paging).toEqual({ style: 'offset', limitParam: 'limit', offsetParam: 'skip' })
    expect(quote.fields.map(field => [field.name, field.remote])).toEqual([['id', 'id'], ['text', 'quote'], ['author', 'author']])
  })

  it('has no endpoints or remote keys for an entity the app stores', () => {
    const post = collectionsOf(load()).find(entry => entry.id === 'ent_post')!
    expect(post.endpoints).toEqual([])
    expect(post.paging).toBeUndefined()
    expect(post.fields.every(field => field.remote === undefined)).toBe(true)
  })

  it('gives REST operations their default verbs when the endpoint has none', () => {
    const model = load()
    const repository = model.modules.blog!.repositories.find(entry => entry.id === 'repo_quote')!
    repository.operations = ['list', 'get', 'create', 'update', 'delete']
    repository.rest = { ...repository.rest, get: { path: '/quotes/:id' }, create: { path: '/quotes' }, update: { path: '/quotes/:id' }, delete: { path: '/quotes/:id', method: 'DELETE' } }
    const quote = collectionsOf(model).find(entry => entry.id === 'ent_quote')!
    expect(quote.endpoints.map(endpoint => `${endpoint.op} ${endpoint.method} ${endpoint.path}`)).toEqual([
      'list GET /quotes', 'get GET /quotes/:id', 'create POST /quotes', 'update PUT /quotes/:id', 'delete DELETE /quotes/:id'
    ])
  })

  it('has no create action for an entity without one', () => {
    const model = load()
    model.modules.blog!.actions = model.modules.blog!.actions.filter(action => action.id !== 'act_create_post')
    expect(collectionsOf(model).find(entry => entry.id === 'ent_post')!.createAction).toBeUndefined()
  })
})

describe('connectionsOf', () => {
  it('is the REST data sources, with the base URL, its env var and the auth', () => {
    expect(connectionsOf(load())).toEqual([{
      id: 'ds_quotes',
      name: 'quotes',
      baseUrl: 'https://dummyjson.com',
      baseUrlEnv: 'NUXT_DATASOURCES_QUOTES_BASE_URL',
      auth: { type: 'bearer', secret: 'apiKey', env: 'NUXT_DATASOURCES_QUOTES_API_KEY' }
    }])
  })
})

describe('fixtureRowsOf', () => {
  it('reads the rows an entity\'s fixtures hold', () => {
    const rows = fixtureRowsOf(load(), 'ent_post')
    expect(rows.map(row => row.slug)).toEqual(['hello-bildr', 'a-draft'])
    expect(fixtureRowsOf(load(), 'ent_quote')).toEqual([])
  })
})

describe('detailPagesOf', () => {
  it('finds the pages that show one row of an entity through a route parameter', () => {
    expect(detailPagesOf(load(), 'ent_post').map(page => page.id)).toEqual(['pg_post_detail'])
    expect(detailPagesOf(load(), 'ent_quote')).toEqual([])
  })
})

describe('fieldLabel and the type menu', () => {
  it('spaces a camelCased name, capitalizing the first word', () => {
    expect(fieldLabel('publishedAt')).toBe('Published at')
    expect(fieldLabel('id')).toBe('Id')
    expect(fieldLabel('servedFrom')).toBe('Served from')
  })

  it('offers every field type of the model with an icon', () => {
    expect(fieldTypeItems.map(item => item.value)).toEqual(['text', 'integer', 'number', 'boolean', 'datetime', 'date', 'image', 'uuid'])
    expect(fieldTypeItems.every(item => item.label && item.icon.startsWith('i-lucide-'))).toBe(true)
  })
})

describe('entityProposal', () => {
  it('proposes a singular PascalCased entity and its plural from a list path', () => {
    expect(entityProposal('/characters')).toEqual({ name: 'Character', plural: 'characters' })
    expect(entityProposal('/posts?_limit=10')).toEqual({ name: 'Post', plural: 'posts' })
    expect(entityProposal('/v1/blog-posts/')).toEqual({ name: 'BlogPost', plural: 'blogPosts' })
    expect(entityProposal('/categories')).toEqual({ name: 'Category', plural: 'categories' })
  })

  it('keeps a name that is not plural, without a plural of its own', () => {
    expect(entityProposal('/status')).toEqual({ name: 'Status' })
    expect(entityProposal('/')).toEqual({ name: 'Item' })
  })
})

describe('restDefaults', () => {
  it('derives the other operations from the list path, with :id for the key', () => {
    expect(restDefaults('get', '/posts')).toEqual({ method: 'GET', path: '/posts/:id' })
    expect(restDefaults('create', '/posts?x=1')).toEqual({ method: 'POST', path: '/posts' })
    expect(restDefaults('update', '/posts/')).toEqual({ method: 'PUT', path: '/posts/:id' })
    expect(restDefaults('delete', '/v1/posts')).toEqual({ method: 'DELETE', path: '/v1/posts/:id' })
  })
})

describe('sourceNameOf', () => {
  it('names a data source after the host of its URL, kebab-cased and starting with a letter', () => {
    expect(sourceNameOf('dummyjson.com', [])).toBe('dummyjson-com')
    expect(sourceNameOf('API.Example.com', [])).toBe('api-example-com')
    expect(sourceNameOf('127.0.0.1', [])).toBe('api-127-0-0-1')
    expect(sourceNameOf('', [])).toBe('api')
  })

  it('numbers the name until no data source has it', () => {
    expect(sourceNameOf('dummyjson.com', ['dummyjson-com', 'dummyjson-com-2'])).toBe('dummyjson-com-3')
  })
})
