import { describe, expect, it } from 'vitest'
import { bindingPaths, bindingScope } from '../../src/edit/scope'
import { project } from './helpers'

/** P5: the names a node can bind (`$bind`, `$template`), as the generator resolves them. */

const model = () => project().model()
const names = (scope: ReturnType<typeof bindingScope>) => scope.map(entry => `${entry.source}:${entry.name}`)

describe('bindingScope', () => {
  it('lists, inside a List, its item (with the entity\'s fields), then what the page uses, then site', () => {
    const scope = bindingScope(model(), 'pg_index', 'n_card')
    expect(names(scope)).toEqual(['item:post', 'query:featured', 'query:all', 'query:quotes', 'computed:posts', 'state:preferences', 'site:site'])
    expect(scope[0]).toMatchObject({ name: 'post', entity: 'ent_post', many: false })
    expect(scope[0]!.fields).toEqual(['id', 'title', 'slug', 'body', 'published', 'publishedAt', 'createdAt', 'updatedAt'])
    expect(scope.find(entry => entry.name === 'featured')).toMatchObject({ many: true, entity: 'ent_post' })
    expect(scope.find(entry => entry.name === 'preferences')!.fields).toEqual(['showDrafts'])
  })

  it('has no item outside the List, and the List\'s own item only for what goes inside it', () => {
    expect(names(bindingScope(model(), 'pg_index', 'n_h1'))).not.toContain('item:post')
    expect(names(bindingScope(model(), 'pg_index', 'n_list'))).not.toContain('item:post')
    expect(names(bindingScope(model(), 'pg_index', 'n_list', { within: true }))[0]).toBe('item:post')
  })

  it('names an action\'s pending and error, and a one-record query as one record', () => {
    const scope = bindingScope(model(), 'pg_post_detail', 'n_page')
    expect(scope.find(entry => entry.name === 'publish')).toMatchObject({ source: 'action', fields: ['pending', 'error'], many: false })
    expect(scope.find(entry => entry.name === 'post')).toMatchObject({ source: 'query', many: false, entity: 'ent_post' })
  })

  it('gives a component its properties (an entity one with its picked fields; slots are not values), and a layout its variables', () => {
    const card = bindingScope(model(), 'cmp_post_card')
    expect(names(card)).toEqual(['prop:post', 'prop:cover', 'prop:draftLabel', 'site:site'])
    expect(card[0]).toMatchObject({ name: 'post', entity: 'ent_post', fields: ['title', 'slug', 'body', 'published'] })
    const layout = bindingScope(model(), 'lay_main')
    expect(layout.find(entry => entry.source === 'layout')).toMatchObject({ name: 'layout', fields: ['title'] })
  })

  it('flattens to the paths a binding picks: each name, its fields, and `length` of a list', () => {
    const paths = bindingPaths(bindingScope(model(), 'pg_index', 'n_card'))
    expect(paths).toContain('post')
    expect(paths).toContain('post.title')
    expect(paths).toContain('featured.length')
    expect(paths).not.toContain('featured.title')
    expect(paths).toContain('preferences.showDrafts')
    expect(paths).toContain('site.name')
  })
})
