import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { usageKey, usageKindLabel } from '../../src/shared/dataArtifacts.ts'
import { blockingUses, collectionUses, fieldUses, fieldUsesByName, them, usedInWords } from '../../src/shared/dataUsage.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/** Who uses a collection and a field, in the words the Data workspace shows: the blog fixture, as the module loads it. */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model

const entry = (entries: ReturnType<typeof collectionUses>, key: string) => entries.find(use => usageKey(use) === key)

describe('usedInWords and them', () => {
  it('counts places', () => {
    expect(usedInWords(1)).toBe('Used in 1 place')
    expect(usedInWords(3)).toBe('Used in 3 places')
  })

  it('says it for one place and them for more', () => {
    expect(them(1)).toBe('it')
    expect(them(2)).toBe('them')
  })
})

describe('collectionUses', () => {
  const uses = collectionUses(model, 'ent_post')

  it('lists each place once, with a sentence for each way it uses the collection', () => {
    expect(uses.map(usageKey)).toEqual(expect.arrayContaining(['page:pg_index', 'page:pg_post_detail', 'page:pg_new_post', 'component:cmp_post_card']))
    expect(uses.filter(use => use.id === 'pg_index')).toHaveLength(1)
    expect(entry(uses, 'page:pg_index')!.what).toEqual(expect.arrayContaining([
      'Reads “Featured posts” as “featured”',
      // The List is its type, in words, not its id (`n_list`).
      'The list shows its rows as “post”'
    ]))
  })

  it('says a page that reads one row by a route parameter is a detail page, and what a form and a component do', () => {
    expect(entry(uses, 'page:pg_post_detail')!.what).toContain('Detail page: reads “Post by slug” as “post”')
    expect(entry(uses, 'page:pg_new_post')!.what).toEqual(expect.arrayContaining(['The form runs “Create post”', 'An Input is a form field for it']))
    expect(entry(uses, 'component:cmp_post_card')!.what).toContain('Has a property for it')
  })

  it('names a node by its type or its layer name, never its id', () => {
    const said = uses.flatMap(use => use.what).join(' | ')
    expect(said).toContain('A Heading shows “post”')
    expect(said).not.toMatch(/\bn_[a-z_]+\b/)
    // A node with a name of its own is said by it, as the layers panel calls it.
    const named = loadModel(blogModelFiles())
    if (!named.ok) throw new Error('model')
    named.model.modules.blog!.pages.find(page => page.id === 'pg_post_detail')!.root.children!.find(node => node.id === 'n_title')!.name = 'Post title'
    expect(entry(collectionUses(named.model, 'ent_post'), 'page:pg_post_detail')!.what).toContain('“Post title” shows “post”')
  })

  it('marks the actions the collection takes along as following it, and counts only the places outside', () => {
    expect(entry(uses, 'action:act_create_post')).toMatchObject({ follows: true })
    // One meaning for "steps": the action works with the collection there, which may read it or write it.
    expect(entry(uses, 'action:act_create_post')!.what).toEqual(expect.arrayContaining(['Takes it as its input', 'Uses it in its steps']))
    expect(blockingUses(uses).map(usageKey)).toEqual(expect.arrayContaining(['page:pg_index']))
    expect(blockingUses(uses).some(use => use.kind === 'action')).toBe(false)
  })

  it('is empty for a collection that is gone, and without a model', () => {
    expect(collectionUses(model, 'ent_gone')).toEqual([])
    expect(collectionUses(null, 'ent_post')).toEqual([])
  })

  it('names the new kinds of place', () => {
    expect(usageKindLabel('query')).toBe('Query')
    expect(usageKindLabel('entity')).toBe('Collection')
  })
})

describe('fieldUses', () => {
  it('says how a page binds the field, through the alias it reads the row as', () => {
    const title = fieldUses(model, 'ent_post', 'title')
    expect(entry(title, 'page:pg_post_detail')!.what).toEqual(expect.arrayContaining(['A Heading shows “post.title”', 'The SEO fields show “post.title”']))
    expect(entry(title, 'component:cmp_post_card')!.what).toContain('A Heading shows “post.title”')
  })

  it('says how a query filters and sorts, what an action picks and sets, and the form fields and route parameter', () => {
    expect(entry(fieldUses(model, 'ent_post', 'published'), 'query:q_featured_posts')!.what).toEqual(['Filters by it'])
    expect(entry(fieldUses(model, 'ent_post', 'createdAt'), 'query:q_all_posts')!.what).toEqual(['Sorts by it'])
    expect(entry(fieldUses(model, 'ent_post', 'publishedAt'), 'action:act_publish_post')!.what).toEqual(['Sets it in its steps'])
    const title = fieldUses(model, 'ent_post', 'title')
    expect(entry(title, 'action:act_create_post')).toMatchObject({ follows: true, what: ['Takes it as its input'] })
    expect(entry(title, 'page:pg_new_post')!.what).toContain('An Input is a form field for it')
    expect(entry(fieldUses(model, 'ent_post', 'slug'), 'page:pg_post_detail')!.what).toContain('Checks a route parameter with it')
  })

  it('says what the collection\'s own repository does with the field, as the collection', () => {
    const slug = fieldUses(model, 'ent_post', 'slug')
    expect(entry(slug, 'entity:ent_post')).toMatchObject({ name: 'Post', what: ['Looks its rows up by it'] })
    expect(entry(fieldUses(model, 'ent_post', 'createdAt'), 'entity:ent_post')!.what).toEqual(['Sorts its list by it'])
  })

  it('gives every field in one pass, the same as one field alone, and nothing for a field nothing uses', () => {
    const index = fieldUsesByName(model, 'ent_post')
    expect(index.get('title')).toEqual(fieldUses(model, 'ent_post', 'title'))
    expect(fieldUses(model, 'ent_post', 'nope')).toEqual([])
    expect(fieldUses(null, 'ent_post', 'title')).toEqual([])
    expect(fieldUsesByName(null, 'ent_post').size).toBe(0)
  })
})
