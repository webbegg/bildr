import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { ActionFile, Model } from '@bildr/codegen/model'
import { repositoriesOf } from '../../src/editor/stepRepos.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/** What a step may call (S10, D10c): the repositories of the action's module. */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model
const action = (id: string): ActionFile => model.modules.blog!.actions.find(entry => entry.id === id)!

describe('repositoriesOf', () => {
  it('lists the repositories of the action\'s module with what a step may do with each', () => {
    const [post] = repositoriesOf(model, action('act_create_post').id)
    expect(post).toMatchObject({ id: 'repo_post', name: 'Post', key: 'uuid', writes: ['create', 'update', 'delete'] })
    expect(post!.lookups).toEqual([
      { op: 'get', label: 'Get by id', arg: 'id', type: 'uuid' },
      { op: 'findBySlug', label: 'Find by slug', arg: 'slug', type: 'text' }
    ])
    expect(post!.fields.map(field => field.name)).toEqual(['title', 'slug', 'body', 'published', 'publishedAt'])
  })

  it('offers only the operations the repository has', () => {
    const copy = structuredClone(model)
    copy.modules.blog!.repositories.find(repository => repository.id === 'repo_post')!.operations = ['get', 'delete']
    const [post] = repositoriesOf(copy, 'act_create_post')
    expect(post!.writes).toEqual(['delete'])
    expect(post!.lookups.map(lookup => lookup.op)).toEqual(['get', 'findBySlug'])
    copy.modules.blog!.repositories.find(repository => repository.id === 'repo_post')!.operations = ['list']
    expect(repositoriesOf(copy, 'act_create_post')[0]!.lookups).toEqual([{ op: 'findBySlug', label: 'Find by slug', arg: 'slug', type: 'text' }])
  })

  it('is empty for an action the model does not have', () => {
    expect(repositoriesOf(model, 'act_gone')).toEqual([])
  })
})
