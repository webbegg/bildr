import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { usageKindLabel } from '../../src/shared/dataArtifacts.ts'
import { collectionUses, fieldUseIndex, fieldUses, outsideOf, usedInWords } from '../../src/shared/dataUsage.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/** Who uses a collection and a field, in the words the Data workspace shows (S5): the blog fixture, as the module loads it. */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model

const entry = (entries: ReturnType<typeof collectionUses>, key: string) => entries.find(use => `${use.kind}:${use.id}` === key)

describe('usedInWords', () => {
  it('counts places', () => {
    expect(usedInWords(1)).toBe('Used in 1 place')
    expect(usedInWords(3)).toBe('Used in 3 places')
  })
})

describe('collectionUses', () => {
  const uses = collectionUses(model, 'ent_post')

  it('lists each place once, with a sentence for each way it uses the collection', () => {
    expect(uses.map(use => `${use.kind}:${use.id}`)).toEqual(expect.arrayContaining(['page:pg_index', 'page:pg_post_detail', 'page:pg_new_post', 'component:cmp_post_card']))
    expect(uses.filter(use => use.id === 'pg_index')).toHaveLength(1)
    expect(entry(uses, 'page:pg_index')!.what).toEqual(expect.arrayContaining([
      'Reads “Featured posts” as “featured”',
      'n_list lists its rows as “post”'
    ]))
  })

  it('says a page that reads one row by a route parameter is a detail page, and what a form and a component do', () => {
    expect(entry(uses, 'page:pg_post_detail')!.what).toContain('Detail page: reads “Post by slug” as “post”')
    expect(entry(uses, 'page:pg_new_post')!.what).toEqual(expect.arrayContaining(['The form n_form runs “Create post”', 'n_title is a form field for it']))
    expect(entry(uses, 'component:cmp_post_card')!.what).toContain('Has a property for it')
  })

  it('marks the actions the collection takes along as following it, and counts only the places outside', () => {
    expect(entry(uses, 'action:act_create_post')).toMatchObject({ follows: true })
    expect(entry(uses, 'action:act_create_post')!.what).toEqual(expect.arrayContaining(['Takes it as its input', 'Writes to it in its steps']))
    expect(outsideOf(uses).map(use => `${use.kind}:${use.id}`)).toEqual(expect.arrayContaining(['page:pg_index']))
    expect(outsideOf(uses).some(use => use.kind === 'action')).toBe(false)
  })

  it('is empty for a collection that is gone, and without a model', () => {
    expect(collectionUses(model, 'ent_gone')).toEqual([])
    expect(collectionUses(null, 'ent_post')).toEqual([])
  })

  it('names the new kind of place', () => {
    expect(usageKindLabel('query')).toBe('Query')
  })
})

describe('fieldUses', () => {
  it('says how a page binds the field, through the alias it reads the row as', () => {
    const title = fieldUses(model, 'ent_post', 'title')
    expect(entry(title, 'page:pg_post_detail')!.what).toEqual(expect.arrayContaining(['n_title shows “post.title”', 'The SEO fields show “post.title”']))
    expect(entry(title, 'component:cmp_post_card')!.what).toContain('n_title shows “post.title”')
  })

  it('says how a query filters and sorts, what an action picks and sets, and the form fields and route parameter', () => {
    expect(entry(fieldUses(model, 'ent_post', 'published'), 'query:q_featured_posts')!.what).toEqual(['Filters by it'])
    expect(entry(fieldUses(model, 'ent_post', 'createdAt'), 'query:q_all_posts')!.what).toEqual(['Sorts by it'])
    expect(entry(fieldUses(model, 'ent_post', 'publishedAt'), 'action:act_publish_post')!.what).toEqual(['Sets it in its steps'])
    const title = fieldUses(model, 'ent_post', 'title')
    expect(entry(title, 'action:act_create_post')).toMatchObject({ follows: true, what: ['Takes it as input'] })
    expect(entry(title, 'page:pg_new_post')!.what).toContain('n_title is a form field for it')
    expect(entry(fieldUses(model, 'ent_post', 'slug'), 'page:pg_post_detail')!.what).toContain('Checks a route parameter with it')
  })

  it('gives every field in one scan, and nothing for a field nothing uses', () => {
    const index = fieldUseIndex(model, 'ent_post')
    expect(index.get('title')).toEqual(fieldUses(model, 'ent_post', 'title'))
    expect(fieldUses(model, 'ent_post', 'nope')).toEqual([])
    expect(fieldUses(null, 'ent_post', 'title')).toEqual([])
    expect(fieldUseIndex(null, 'ent_post').size).toBe(0)
  })
})
