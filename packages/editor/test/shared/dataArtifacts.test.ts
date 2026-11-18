import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { ARTIFACT_KINDS, PERSISTENCE, RESULTS, composableOf, queryFields, stateComposableOf, stepSummary, usageKey, usageKindLabel, usesOfArtifact } from '../../src/shared/dataArtifacts.ts'
import { actionsOf, entityById, queriesOf, repositoryEntity, statesOf } from '../../src/shared/dataModel.ts'
import { stateFieldUses } from '../../src/shared/dataUsage.ts'
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
    expect(stepSummary(steps.find(step => step.kind === 'repository')!, model)).toBe('Creates a Post')
    expect(stepSummary({ kind: 'load', as: 'post', op: 'get', repository: 'repo_post', orError: 'not_found' }, model)).toBe('“post”: a Post by id, refusing with “not_found” if there is none')
  })

  it('says a write by what it does to the collection, as one name: Write', () => {
    const write = (op: string, repository = 'repo_post') => stepSummary({ kind: 'repository', repository, op }, model)
    expect([write('create'), write('update'), write('delete')]).toEqual(['Creates a Post', 'Updates a Post', 'Deletes a Post'])
    expect(write('update', 'repo_gone')).toBe('Updates a row')
    expect(stepSummary({ kind: 'repository' }, model)).toBe('Writes to a collection')
    expect(stepSummary({ kind: 'repository', repository: 'repo_post', op: 'create' }, null)).toBe('Creates a row')
  })

  it('says a load by the row it gives a name and how it is found, not by the lookup\'s code name', () => {
    const load = (op: string, extra: Record<string, unknown> = {}) => stepSummary({ kind: 'load', as: 'post', repository: 'repo_post', op, ...extra }, model)
    expect(load('get')).toBe('“post”: a Post by id')
    expect(load('findBySlug')).toBe('“post”: a Post by slug')
    expect(load('findByPublishedAt')).toBe('“post”: a Post by published at')
    expect(load('get', { orError: 'post_not_found' })).toBe('“post”: a Post by id, refusing with “post_not_found” if there is none')
    for (const op of ['get', 'findBySlug']) expect(load(op)).not.toMatch(/\b(get|findBySlug)\b/)
  })

  it('says an assert refuses if a row the lookup finds already exists, built from what it looks up by', () => {
    expect(stepSummary(steps.find(step => step.kind === 'assert')!, model)).toBe('Refuses with “slug_taken” if a Post with this slug already exists')
    const assert = (unless: Record<string, unknown>) => stepSummary({ kind: 'assert', error: 'slug_taken', unless }, model)
    expect(assert({ repository: 'repo_post', op: 'get', args: { id: { $input: 'id' } } })).toBe('Refuses with “slug_taken” if a Post with this id already exists')
    expect(assert({ repository: 'repo_post', op: 'get', args: {} })).toBe('Refuses with “slug_taken” if a Post with this id already exists')
    expect(assert({ repository: 'repo_post', op: 'findByPublishedAt', args: {} })).toBe('Refuses with “slug_taken” if a Post with this published at already exists')
    expect(stepSummary({ kind: 'assert', error: 'slug_taken' }, model)).toBe('Refuses with “slug_taken” if a row is found')
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

describe('State (B2, S1)', () => {
  it('lists the states of the model as the tree does: label, name and module, with no collection', () => {
    expect(statesOf(model)).toEqual([{ id: 'st_preferences', name: 'preferences', label: 'Blog preferences', module: 'blog', collectionId: '', collectionName: '' }])
  })

  it('says the persistence in the words of the workspace, never the storage\'s', () => {
    expect(PERSISTENCE.map(choice => [choice.value, choice.label])).toEqual([['memory', 'Forgotten on reload'], ['session', 'Kept for this tab'], ['localStorage', 'Kept in this browser']])
    expect(ARTIFACT_KINDS.state).toEqual({ label: 'State', plural: 'State', rename: 'state_rename', delete: 'state_delete' })
  })

  it('names the composable a state generates: the module first, then the name', () => {
    expect(stateComposableOf('blog', 'preferences')).toBe('useBlogPreferences')
    expect(stateComposableOf('my-shop', 'cartFilter')).toBe('useMyShopCartFilter')
  })

  it('lists each place that uses a state once, with a sentence for each way it does', () => {
    const uses = usesOfArtifact(model, 'st_preferences', 'state')
    expect(uses.map(use => usageKey(use))).toEqual(['page:pg_index'])
    const what = uses[0]!.what
    expect(what).toContain('Reads it as “preferences”')
    expect(what).toContain('A computed value reads “preferences”')
    expect(what.some(sentence => /^.+ shows “preferences”$/.test(sentence))).toBe(true)
    expect(what.some(sentence => /^.+ changes it on an interaction$/.test(sentence))).toBe(true)
  })

  it('lists who uses one field of a state, the way a collection\'s fields do', () => {
    const uses = stateFieldUses(model, 'st_preferences', 'showDrafts')
    expect(uses.map(use => usageKey(use))).toEqual(['page:pg_index'])
    const what = uses[0]!.what
    expect(what).toContain('A computed value reads “preferences.showDrafts”')
    expect(what.some(sentence => /^.+ shows “preferences.showDrafts”$/.test(sentence))).toBe(true)
    expect(what.some(sentence => /^.+ sets it on an interaction$/.test(sentence))).toBe(true)
    expect(stateFieldUses(model, 'st_preferences', 'nothing')).toEqual([])
    expect(stateFieldUses(null, 'st_preferences', 'showDrafts')).toEqual([])
  })
})
