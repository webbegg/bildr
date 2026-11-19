import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { primOf, valueChoices } from '../../src/shared/interactionValues.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * What a step's value can be at a node (B3, S2): the names the node can read, typed by what each is in the generated app, and
 * only the ones the target takes. Read against the blog fixture: its index page uses the state `preferences` and three queries,
 * lists `posts` (a computed value) as `post`, and its detail page has the route parameter `slug`.
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model

const at = (file: string, nodeId: string, kind: 'page' | 'layout' | 'component' = 'page') => ({ file, kind, nodeId })
const paths = (choices: Array<{ path: string }>) => choices.map(choice => choice.path)

describe('primOf', () => {
  it('says what each field type is in the generated app: text, a number, true or false', () => {
    expect(['text', 'image', 'date', 'datetime', 'uuid'].map(type => primOf(type as never))).toEqual(['string', 'string', 'string', 'string', 'string'])
    expect(['integer', 'number'].map(type => primOf(type as never))).toEqual(['number', 'number'])
    expect(primOf('boolean')).toBe('boolean')
  })
})

describe('valueChoices on a page', () => {
  it('offers the true-or-false fields the page uses for a toggle, and nothing the target does not take', () => {
    const choices = valueChoices(model, at('pg_index', 'n_toggle'), { prims: ['boolean'], undef: true })
    expect(paths(choices)).toEqual(['preferences.showDrafts'])
    expect(choices[0]).toEqual({ kind: 'bind', path: 'preferences.showDrafts', label: 'preferences.showDrafts' })
  })

  it('offers the List item\'s fields, the query results\' lengths and the state for text or a number, never a whole row', () => {
    const found = paths(valueChoices(model, at('pg_index', 'n_read_more'), { prims: ['string', 'number'] }))
    expect(found).toEqual(expect.arrayContaining(['post.slug', 'post.title', 'post.id', 'post.createdAt', 'featured.length', 'all.length', 'quotes.length', 'posts.length']))
    expect(found).not.toContain('post')
    expect(found).not.toContain('featured')
    expect(found).not.toContain('post.published')
    expect(found).not.toContain('preferences.showDrafts')
  })

  it('leaves out a field that can be empty unless the target takes that, and a quote\'s item outside its List', () => {
    const strict = paths(valueChoices(model, at('pg_index', 'n_read_more'), { prims: ['string'] }))
    expect(strict).not.toContain('post.publishedAt')
    expect(strict).not.toContain('quote.text')
    expect(paths(valueChoices(model, at('pg_index', 'n_read_more'), { prims: ['string'], null: true }))).toContain('post.publishedAt')
  })

  it('offers the quote item only inside the quotes List', () => {
    expect(paths(valueChoices(model, at('pg_index', 'n_quote'), { prims: ['string'] }))).toEqual(expect.arrayContaining(['quote.text', 'quote.author']))
  })

  it('offers a number only where a number goes, and true or false only where it goes', () => {
    const numbers = paths(valueChoices(model, at('pg_index', 'n_read_more'), { prims: ['number'] }))
    expect(numbers).toEqual(['featured.length', 'all.length', 'quotes.length', 'posts.length'])
    const flags = paths(valueChoices(model, at('pg_index', 'n_read_more'), { prims: ['boolean'], undef: true }))
    expect(flags).toEqual(['post.published', 'preferences.showDrafts'])
  })

  it('offers an action\'s pending and error to the page that uses it', () => {
    const found = valueChoices(model, at('pg_post_detail', 'n_publish'), { prims: ['boolean'] })
    expect(paths(found)).toContain('publish.pending')
    expect(paths(valueChoices(model, at('pg_post_detail', 'n_publish'), { prims: ['string'], undef: true }))).toContain('publish.error')
    expect(paths(valueChoices(model, at('pg_post_detail', 'n_publish'), { prims: ['string'] }))).not.toContain('publish.error')
  })

  it('offers the page\'s route parameters, as route values, where text goes', () => {
    const choices = valueChoices(model, at('pg_post_detail', 'n_publish'), { prims: ['string', 'number'] })
    expect(choices.filter(choice => choice.kind === 'route')).toEqual([{ kind: 'route', path: 'slug', label: 'slug' }])
    expect(valueChoices(model, at('pg_index', 'n_toggle'), { prims: ['string'], undef: true }).some(choice => choice.kind === 'route')).toBe(false)
    expect(valueChoices(model, at('pg_post_detail', 'n_publish'), { prims: ['boolean'] }).some(choice => choice.kind === 'route')).toBe(false)
  })

  it('does not offer the site: only a layout reads it', () => {
    expect(paths(valueChoices(model, at('pg_index', 'n_toggle'), { prims: ['string'], undef: true }))).not.toContain('site.name')
  })
})

describe('valueChoices in a layout and a component', () => {
  it('offers a layout its variables and the site', () => {
    const found = paths(valueChoices(model, at('lay_main', 'n_header', 'layout'), { prims: ['string'] }))
    expect(found).toEqual(expect.arrayContaining(['layout.title', 'site.name']))
  })

  it('offers a component its properties, typed', () => {
    const card = model.modules.blog!.components.find(component => component.id === 'cmp_post_card')!
    const found = valueChoices(model, at('cmp_post_card', card.root.id, 'component'), { prims: ['string', 'number'] })
    expect(paths(found).length).toBeGreaterThan(0)
    expect(found.every(choice => choice.kind === 'bind')).toBe(true)
  })
})
