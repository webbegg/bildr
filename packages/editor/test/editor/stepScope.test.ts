import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { ActionFile, Model } from '@bildr/codegen/model'
import { scopeAt } from '../../src/editor/stepScope.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/** What a step of an action may read at its place (S10, D10c). */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model
const action = (id: string): ActionFile => model.modules.blog!.actions.find(entry => entry.id === id)!
const paths = (entries: Array<{ path: string }>) => entries.map(entry => entry.path)

describe('scopeAt', () => {
  it('offers the fields the action takes, typed, as $input', () => {
    const scope = scopeAt(model, action('act_create_post'), action('act_create_post').steps, 0)
    expect(scope.input).toEqual([
      { path: 'id', type: 'uuid' },
      { path: 'title', type: 'text' },
      { path: 'slug', type: 'text' },
      { path: 'body', type: 'text' },
      { path: 'published', type: 'boolean' }
    ])
    expect(scope.vars).toEqual([])
  })

  it('offers the route parameters of an action with no body as $input too', () => {
    expect(scopeAt(model, action('act_publish_post'), action('act_publish_post').steps, 0).input).toEqual([{ path: 'id', type: 'uuid' }])
  })

  it('offers a variable only to the steps after the load that defines it, with its row and each field', () => {
    const publish = action('act_publish_post')
    expect(scopeAt(model, publish, publish.steps, 0).vars).toEqual([])
    const after = scopeAt(model, publish, publish.steps, 1)
    expect(paths(after.vars)).toEqual(['post', 'post.id', 'post.title', 'post.slug', 'post.body', 'post.published', 'post.publishedAt', 'post.createdAt', 'post.updatedAt'])
    expect(after.vars[0]).toEqual({ path: 'post', row: 'ent_post' })
    expect(after.vars.find(entry => entry.path === 'post.published')).toEqual({ path: 'post.published', type: 'boolean' })
    expect(scopeAt(model, publish, publish.steps, 2).vars).toEqual(after.vars)
  })

  it('does not offer the variable of the step itself, nor of a later one', () => {
    const steps = [
      { kind: 'load', as: 'first', repository: 'repo_post', op: 'get', args: {} },
      { kind: 'load', as: 'second', repository: 'repo_post', op: 'get', args: {} }
    ]
    expect(paths(scopeAt(model, action('act_publish_post'), steps, 1).vars).filter(path => !path.includes('.'))).toEqual(['first'])
    expect(paths(scopeAt(model, action('act_publish_post'), steps, 0).vars)).toEqual([])
  })

  it('skips a load that has no name yet', () => {
    const steps = [{ kind: 'load', as: '', repository: 'repo_post', op: 'get', args: {} }, { kind: 'return', if: true }]
    expect(scopeAt(model, action('act_publish_post'), steps, 1).vars).toEqual([])
  })
})
