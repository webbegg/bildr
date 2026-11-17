import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { RESULTS, composableOf, queryFields, stepSummary, usageKey, usageKindLabel, usesOfArtifact } from '../../src/shared/dataArtifacts.ts'
import { actionsOf, entityById, queriesOf, repositoryEntity } from '../../src/shared/dataModel.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/** What the Queries and Actions of the Data workspace read of the model (S10): the blog fixture, as the module loads it. */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model

describe('the lookups the tree and the sentences share', () => {
  it('finds an entity by its id, and a repository\'s entity', () => {
    expect(entityById(model, 'ent_post')?.name).toBe('Post')
    expect(entityById(model, 'ent_gone')).toBeUndefined()
    expect(repositoryEntity(model, 'repo_post')).toBe('ent_post')
    expect(repositoryEntity(model, 'repo_gone')).toBeUndefined()
  })

  it('names the collection of each query and action the tree lists', () => {
    expect(queriesOf(model).map(query => [query.id, query.collectionName])).toContainEqual(['q_featured_posts', 'Post'])
    expect(actionsOf(model).map(action => [action.id, action.collectionName])).toContainEqual(['act_create_post', 'Post'])
  })
})

describe('stepSummary', () => {
  const steps = model.modules.blog!.actions.find(action => action.id === 'act_create_post')!.steps

  it('says what each kind of step does', () => {
    expect(stepSummary({ kind: 'validate' }, model)).toBe('Checks the input')
    expect(stepSummary({ kind: 'assert', error: 'slug_taken' }, model)).toContain('slug_taken')
    expect(stepSummary(steps.find(step => step.kind === 'repository')!, model)).toBe('Repository: create on Post')
    expect(stepSummary({ kind: 'load', as: 'post', op: 'get', repository: 'repo_post', orError: 'not_found' }, model)).toBe('Loads “post” (get on Post), refusing with “not_found” when there is none')
  })

  it('says an assert refuses when its lookup finds a row (the generated check is `if (await lookup) return err`)', () => {
    expect(stepSummary(steps.find(step => step.kind === 'assert')!, model)).toBe('Refuses with “slug_taken” when Post (findBySlug) finds a row')
    expect(stepSummary({ kind: 'assert', error: 'slug_taken' }, model)).toBe('Refuses with “slug_taken” when a lookup finds a row')
  })

  it('says a step that is not generated yet is not', () => {
    expect(stepSummary({ kind: 'call', service: 'mail' }, model)).toBe('Calls a service. Not generated yet')
    expect(stepSummary({ kind: 'custom' }, model)).toBe('Runs custom code. Not generated yet')
  })

  it('says a bare return ends the action, and a return with a value or a condition says so', () => {
    expect(stepSummary({ kind: 'return', if: true, value: { $var: 'undefined' } }, model)).toBe('Ends the action')
    expect(stepSummary({ kind: 'return' }, model)).toBe('Ends the action')
    expect(stepSummary({ kind: 'return', if: true, value: { $var: 'post' } }, model)).toBe('Returns a value')
    expect(stepSummary({ kind: 'return', if: { $var: 'post' }, value: { $var: 'post' } }, model)).toBe('Returns early when a condition holds')
    expect(stepSummary({ kind: 'return', if: { $var: 'post' }, value: { $var: 'undefined' } }, model)).toBe('Ends the action early when a condition holds')
  })
})

describe('queryFields', () => {
  it('lists the key, the collection\'s own fields and, with timestamps, createdAt and updatedAt', () => {
    expect(queryFields(model, 'ent_post').map(field => field.name)).toEqual(['id', 'title', 'slug', 'body', 'published', 'publishedAt', 'createdAt', 'updatedAt'])
    expect(queryFields(model, 'ent_post').find(field => field.name === 'id')?.type).toBe('uuid')
    expect(queryFields(model, 'ent_gone')).toEqual([])
    expect(queryFields(null, 'ent_post')).toEqual([])
  })
})

describe('who uses a query or an action', () => {
  it('lists each place once, with a sentence for each way it uses the query', () => {
    const uses = usesOfArtifact(model, 'q_featured_posts', 'query')
    expect(uses.map(use => usageKey(use))).toEqual(['page:pg_index'])
    expect(uses[0]!.what).toContain('Reads it as “featured”')
  })

  it('says an action is run, not read', () => {
    const uses = usesOfArtifact(model, 'act_create_post', 'action')
    expect(uses.find(use => use.id === 'pg_new_post')?.what).toContain('Runs it as “createPost”')
  })

  it('names the kinds of place, and the generated composable of a name', () => {
    expect(usageKindLabel('page')).toBe('Page')
    expect(usageKindLabel('component')).toBe('Component')
    expect(composableOf('featuredPosts')).toBe('useFeaturedPosts')
    expect(usesOfArtifact(null, 'q_featured_posts', 'query')).toEqual([])
  })
})

describe('the shared words of a query', () => {
  it('has one list of the results a query returns', () => {
    expect(RESULTS.map(result => result.value)).toEqual(['one', 'many'])
  })
})
