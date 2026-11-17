import { describe, expect, it } from 'vitest'
import { applyEdit, entityUsesOf, fieldUsesOf } from '../../src/edit/index'
import { project } from './helpers'
import type { Json } from './helpers'

/**
 * Each kind of use the module refuses a field or a collection change for, one by one: removing any of them from the usage
 * index must fail here. The computed value, the `$input` a step's `set` reads, and an error message were refused before the
 * index took over; another action that names the collection is not one the delete takes along, so it does not follow.
 */

type Files = Record<string, string>

const POST = '.bildr/modules/blog/entities/post.json'
const DETAIL = '.bildr/modules/blog/pages/post-detail.json'
const CREATE = '.bildr/modules/blog/actions/create-post.json'
const PUBLISH = '.bildr/modules/blog/actions/publish-post.json'

const change = (files: Files, path: string, mutate: (json: Json) => void): Files => {
  const json = JSON.parse(files[path]!) as Json
  mutate(json)
  return { ...files, [path]: `${JSON.stringify(json, null, 2)}\n` }
}
const withField = (type: string) => {
  const p = project()
  p.edit('entity_field_add', { entity: 'ent_post', name: 'extra', type })
  return p.files
}
const fieldId = (files: Files) => (JSON.parse(files[POST]!) as Json).fields.find((field: Json) => field.name === 'extra').id as string

const FIELD_CASES: Array<{ name: string, build: () => Files }> = [
  { name: 'a computed value of a page that reads it', build: () => change(withField('boolean'), DETAIL, (page) => {
    page.uses.computed = [{ as: 'flag', if: { $bind: 'post.extra' }, then: 'yes', else: 'no' }]
    page.root.children.push({ id: 'n_flag', type: 'Text', props: { text: { $bind: 'flag' } } })
  }) },
  { name: 'a step that sets another field from the input it reads', build: () => change(withField('text'), CREATE, (action) => {
    action.steps[2].set.body = { $input: 'extra' }
  }) },
  { name: 'an error message of an action on the collection', build: () => change(withField('text'), CREATE, (action) => {
    action.errors[0].message = 'Taken: {extra}'
  }) }
]

describe('a field used in one way only is refused, and counted', () => {
  it.each(FIELD_CASES)('$name', ({ build }) => {
    const files = build()
    const id = fieldId(files)
    for (const outcome of [
      applyEdit(files, 'entity_field_remove', { entity: 'ent_post', field: id }),
      applyEdit(files, 'entity_field_update', { entity: 'ent_post', field: id, name: 'renamedField' })
    ]) {
      expect(outcome.ok, JSON.stringify(outcome)).toBe(false)
      if (!outcome.ok) expect(outcome.message).toMatch(/^extra is used by /)
    }
    const counted = fieldUsesOf(project(files).model(), 'ent_post', 'extra').filter(use => !use.follows)
    expect(counted.length).toBeGreaterThan(0)
  })
})

describe('a collection another action names', () => {
  const tagged = () => {
    const p = project()
    p.edit('entity_create', { name: 'Tag', source: 'ds_main', fields: [{ name: 'label', type: 'text' }] })
    return p.files
  }

  it('is refused while an action that is not its own invalidates it, and that action does not follow', () => {
    const files = change(tagged(), PUBLISH, (action) => {
      action.client.invalidates.push('ent_tag')
    })
    const outcome = applyEdit(files, 'entity_delete', { entity: 'ent_tag' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message).toBe('Entity Tag is still used by act_publish_post. Change them first')
    const uses = entityUsesOf(project(files).model(), 'ent_tag')
    expect(uses).toContainEqual({ kind: 'action', id: 'act_publish_post', name: 'publishPost', via: 'client', where: 'client' })
  })

  it('is not refused for an action that mentions only one of its own queries: the delete looks at pages for those', () => {
    const files = change(tagged(), PUBLISH, (action) => {
      action.steps.splice(1, 0, { kind: 'call', query: 'q_tags' })
    })
    expect(entityUsesOf(project(files).model(), 'ent_tag').filter(use => !use.follows)).toEqual([])
    expect(applyEdit(files, 'entity_delete', { entity: 'ent_tag' }).ok).toBe(true)
  })
})
