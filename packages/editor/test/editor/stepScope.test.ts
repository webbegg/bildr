import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { ActionFile, Model } from '@bildr/codegen/model'
import { defaultLiteral, exprOf, inputRoots, literalOf, repositoriesOf, scopeAt, valueOfExpr, varRoots } from '../../src/editor/stepScope.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/** What a step of an action may read (S10, D10c): the expression model, the values in scope at a step, and the repositories its steps may call. */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model
const action = (id: string): ActionFile => model.modules.blog!.actions.find(entry => entry.id === id)!
const paths = (entries: Array<{ path: string }>) => entries.map(entry => entry.path)

describe('exprOf and valueOfExpr', () => {
  it('reads a stored value as what the picker shows, and writes it back as it was', () => {
    const values: Array<[unknown, ReturnType<typeof exprOf>]> = [
      [{ $input: 'slug' }, { kind: 'input', path: 'slug' }],
      [{ $var: 'post.title' }, { kind: 'var', path: 'post.title' }],
      [{ $now: true }, { kind: 'now' }],
      [null, { kind: 'empty' }],
      ['hello', { kind: 'literal', value: 'hello' }],
      [3, { kind: 'literal', value: 3 }],
      [false, { kind: 'literal', value: false }],
      [undefined, { kind: 'none' }],
      [{ if: { $input: 'published' }, then: { $now: true }, else: null }, { kind: 'computed', value: { if: { $input: 'published' }, then: { $now: true }, else: null } }]
    ]
    for (const [value, expr] of values) {
      expect(exprOf(value)).toEqual(expr)
      expect(valueOfExpr(expr)).toEqual(value)
    }
  })

  it('keeps an expression the form does not know as it is', () => {
    expect(exprOf({ $param: 'limit' })).toEqual({ kind: 'computed', value: { $param: 'limit' } })
    expect(exprOf([1, 2])).toEqual({ kind: 'computed', value: [1, 2] })
  })
})

describe('literals typed by the field type', () => {
  it('turns the text of a number field into a number, and keeps what is not one as text for the problem to name', () => {
    expect(literalOf('integer', '12')).toBe(12)
    expect(literalOf('number', '1.5')).toBe(1.5)
    expect(literalOf('integer', '1.5')).toBe('1.5')
    expect(literalOf('integer', '')).toBe('')
    expect(literalOf('text', '12')).toBe('12')
    expect(literalOf(undefined, '12')).toBe('12')
    expect(literalOf('boolean', 'true')).toBe(true)
    expect(literalOf('boolean', 'false')).toBe(false)
  })

  it('starts a value of each type empty in its own way', () => {
    expect(defaultLiteral('integer')).toBe(0)
    expect(defaultLiteral('number')).toBe(0)
    expect(defaultLiteral('boolean')).toBe(false)
    expect(defaultLiteral('text')).toBe('')
    expect(defaultLiteral(undefined)).toBe('')
  })
})

describe('the roots a value reads', () => {
  it('lists the variables and the inputs a value tree mentions, by their first name', () => {
    const value = { if: { $var: 'post.published' }, then: { $input: 'slug' }, else: [{ $var: 'other' }, { $input: 'body.x' }] }
    expect(varRoots(value)).toEqual(['post', 'other'])
    expect(inputRoots(value)).toEqual(['slug', 'body'])
    expect(varRoots({ $var: 'undefined' })).toEqual(['undefined'])
    expect(varRoots('plain')).toEqual([])
  })
})

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
