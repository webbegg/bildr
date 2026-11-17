import { describe, expect, it } from 'vitest'
import { applyEdit, entityUsesOf, fieldUsesOf } from '../../src/edit/index'
import type { EditName } from '../../src/edit/index'
import { project } from './helpers'
import type { Json } from './helpers'

/**
 * The usage index and the module's refusals are one list: whatever `entity_field_remove`, a field rename or `entity_delete` refuses
 * for is a counted use (one the module does not change by itself), so the editor never says "not used" and then gets a late refusal;
 * and where the module goes ahead, nothing is counted, so the editor never blocks what the module allows.
 */

type Files = Record<string, string>

const POST = '.bildr/modules/blog/entities/post.json'
const REPO = '.bildr/modules/blog/repositories/post.json'
const ALL_POSTS = '.bildr/modules/blog/queries/all-posts.json'
const DETAIL = '.bildr/modules/blog/pages/post-detail.json'
const PUBLISH = '.bildr/modules/blog/actions/publish-post.json'
const TOUCH = '.bildr/modules/blog/actions/touch-post.json'

const edit = (files: Files, name: EditName, input: unknown): Files => {
  const p = project(files)
  p.edit(name, input)
  return p.files
}
/** The files with the JSON file at `path` changed by `mutate`. */
const change = (files: Files, path: string, mutate: (json: Json) => void): Files => {
  const json = JSON.parse(files[path]!) as Json
  mutate(json)
  return { ...files, [path]: `${JSON.stringify(json, null, 2)}\n` }
}
const addField = (name: string) => (files: Files) => edit(files, 'entity_field_add', { entity: 'ent_post', name, type: 'text' })
/** A text of the detail page that binds `path`. */
const binds = (path: string) => (files: Files) => change(files, DETAIL, (page) => {
  page.root.children.push({ id: 'n_extra', type: 'Text', props: { text: { $bind: path } } })
})

interface FieldCase {
  name: string
  /** The field the case asks about, once `build` has made the files. */
  field: string
  build: (files: Files) => Files
  /** Whether the module refuses to remove or rename the field. */
  refused: boolean
}

const FIELD_CASES: FieldCase[] = [
  { name: 'a query that filters by it', field: 'published', build: files => files, refused: true },
  { name: 'a query that orders by it', field: 'rank', refused: true, build: files => change(addField('rank')(files), ALL_POSTS, (query) => {
    query.orderBy = [...query.orderBy ?? [], { field: 'rank', direction: 'asc' }]
  }) },
  { name: 'a finder of its repository', field: 'handle', refused: true, build: files => change(addField('handle')(files), REPO, (repository) => {
    repository.finders.push({ by: 'fld_handle' })
  }) },
  { name: 'the list order of its repository', field: 'rank', refused: true, build: files => change(addField('rank')(files), REPO, (repository) => {
    repository.list.orderBy.push({ field: 'rank', direction: 'asc' })
  }) },
  { name: 'a binding through the query a page reads it as', field: 'summary', refused: true, build: files => binds('post.summary')(addField('summary')(files)) },
  { name: 'a binding through the result of an action the page runs', field: 'summary', refused: true, build: files => binds('publish.data.summary')(addField('summary')(files)) },
  { name: 'a field named like a step key: kind', field: 'kind', refused: true, build: addField('kind') },
  { name: 'a field named like a step key: op', field: 'op', refused: true, build: addField('op') },
  { name: 'a field named like a step key: set', field: 'set', refused: true, build: addField('set') },
  { name: 'a field named like a step key: repository', field: 'repository', refused: true, build: addField('repository') },
  { name: 'a field only the create action picks, which the module updates itself', field: 'spare', refused: false, build: addField('spare') },
  { name: 'a field only an action with no entity of its own writes, through a repository step', field: 'spare', refused: false, build: files => ({ ...addField('spare')(files), [TOUCH]: `${JSON.stringify(touch(), null, 2)}\n` }) }
]

/** An action with no input or output entity that writes `spare` in a repository step: the module does not look at it for a field. */
function touch(): Json {
  const publish = JSON.parse(project().files[PUBLISH]!) as Json
  publish.id = 'act_touch_post'
  publish.name = 'touchPost'
  publish.http = { method: 'POST', path: '/posts/:id/touch' }
  delete publish.output
  delete publish.client.optimistic
  publish.client.invalidates = []
  publish.steps = [publish.steps[0], { kind: 'repository', repository: 'repo_post', op: 'update', id: { $input: 'id' }, from: { $var: 'post' }, set: { spare: 'x' } }]
  return publish
}

const fieldId = (files: Files, name: string) => (JSON.parse(files[POST]!) as Json).fields.find((field: Json) => field.name === name).id as string
const countedOf = (files: Files, name: string) => fieldUsesOf(project(files).model(), 'ent_post', name).filter(use => !use.follows)

describe('the index and the refusals of a field', () => {
  it.each(FIELD_CASES)('$name: the module and the index agree', ({ field, build, refused }) => {
    const files = build(project().files)
    const id = fieldId(files, field)
    const counted = countedOf(files, field)
    const removal = applyEdit(files, 'entity_field_remove', { entity: 'ent_post', field: id })
    const rename = applyEdit(files, 'entity_field_update', { entity: 'ent_post', field: id, name: 'renamedField' })
    // A refusal for another reason would prove nothing: it has to be the "is used by" one.
    for (const outcome of [removal, rename]) {
      expect(!outcome.ok, JSON.stringify(outcome)).toBe(refused)
      if (!outcome.ok) expect(outcome.message).toMatch(/is used by/)
    }
    expect(counted.length > 0, JSON.stringify(counted)).toBe(refused)
  })
})

describe('the index and the refusals of a collection', () => {
  /** A collection nothing but its own files uses, which the module deletes. */
  const tag = (files: Files) => edit(files, 'entity_create', { name: 'Tag', source: 'ds_main', fields: [{ name: 'label', type: 'text' }] })

  const COLLECTION_CASES: Array<{ name: string, build: (files: Files) => Files, refused: boolean }> = [
    { name: 'only its own queries, actions and repository', build: tag, refused: false },
    { name: 'a relation from another collection', refused: true, build: files => change(tag(files), POST, (post) => {
      post.relations.push({ name: 'tag', to: 'ent_tag', kind: 'one' })
    }) },
    { name: 'a page that validates a route parameter with one of its fields', refused: true, build: files => change(tag(files), DETAIL, (page) => {
      page.params.push({ name: 'label', validate: { field: 'fld_label' } })
    }) },
    { name: 'a page that reads its query', refused: true, build: files => change(tag(files), DETAIL, (page) => {
      page.uses.queries.push({ as: 'tags', query: 'q_tags' })
    }) }
  ]

  it.each(COLLECTION_CASES)('$name: the module and the index agree', ({ build, refused }) => {
    const files = build(project().files)
    const counted = entityUsesOf(project(files).model(), 'ent_tag').filter(use => !use.follows)
    const outcome = applyEdit(files, 'entity_delete', { entity: 'ent_tag' })
    expect(!outcome.ok, JSON.stringify(outcome)).toBe(refused)
    if (!outcome.ok) expect(outcome.message).toMatch(/is still used by/)
    expect(counted.length > 0, JSON.stringify(counted)).toBe(refused)
  })
})
