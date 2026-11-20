import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateActions } from '../../src/generate/actions'
import { loadModel } from '../../src/model/load'
import type { Model } from '../../src/model/load'
import { project } from '../edit/helpers'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

const fixtureModel = (): Model => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}

/** What the blog module's actions generate (T6). */
const ACTION_FILES = [
  'layers/blog/app/composables/blog/useCreatePost.ts',
  'layers/blog/app/composables/blog/usePublishPost.ts',
  'layers/blog/server/api/blog/posts/[id]/publish.post.ts',
  'layers/blog/server/api/blog/posts/index.post.ts',
  'layers/blog/server/application/actions/create-post.ts',
  'layers/blog/server/application/actions/publish-post.ts',
  'layers/blog/server/utils/blog.ts',
  'layers/blog/shared/domain/errors.ts',
  'layers/blog/test/application/create-post.test.ts',
  'layers/blog/test/application/publish-post.test.ts'
]

describe('generateActions on the golden fixture', () => {
  const files = generateActions(fixtureModel())
  const manifest = JSON.parse(readFileSync(join(fixtureRoot, '.bildr/manifest.json'), 'utf8')).files as Record<string, { source?: string }>

  it('emits exactly the action files', () => {
    expect(files.map(file => file.path)).toEqual(ACTION_FILES)
  })

  it.each(ACTION_FILES)('%s matches the fixture byte for byte', (path) => {
    expect(files.find(file => file.path === path)?.content).toBe(readFileSync(join(fixtureRoot, path), 'utf8'))
  })

  it('records each file as managed with the model file it comes from', () => {
    for (const file of files) {
      expect(file.owner, file.path).toBe('managed')
      expect(file.source, file.path).toBe(manifest[file.path]!.source)
    }
  })
})

/** The golden blog plus actions with no `client.optimistic`: an update, a delete on an unlisted entity, a blank one over an entity, and one with no input. */
const withDirectActions = () => {
  const p = project()
  p.edit('datasource_create', { name: 'scratch', kind: 'memory' })
  p.edit('entity_create', { name: 'note', source: 'ds_scratch', fields: [{ name: 'title', type: 'text', required: true }] })
  p.files['.bildr/modules/blog/fixtures/note.json'] = `${JSON.stringify({ entity: 'ent_note', rows: [{ id: '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b01', title: 'First note' }] }, null, 2)}\n`
  p.edit('action_create', { entity: 'ent_note', template: 'update', name: 'editNote' })
  p.edit('action_create', { entity: 'ent_note', template: 'blank', name: 'tidyNotes' })
  p.edit('entity_create', { name: 'secret', source: 'ds_scratch', expose: false, fields: [{ name: 'code', type: 'text', required: true }] })
  p.edit('action_create', { entity: 'ent_secret', template: 'delete', name: 'removeSecret' })
  p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
  p.edit('action_update', { action: 'act_tidy_posts', input: {} })
  return generateActions(p.model())
}

// TanStack DB doesn't call a transaction's mutationFn when nothing was mutated (optimistic-action-contract.test.ts), so an action with
// nothing to show ahead of the server calls it directly: $fetch, then a refetch of what it invalidates.
describe('the composable of an action with no optimistic update', () => {
  const files = withDirectActions()
  const composable = (name: string) => files.find(file => file.path === `layers/blog/app/composables/blog/${name}.ts`)!.content

  it('an update posts to its route with the id and refetches what it invalidates', () => {
    const source = composable('useEditNote')
    expect(source).not.toContain('createOptimisticAction')
    expect(source).not.toContain('onMutate')
    expect(source).toContain('const execute = async (id: string): Promise<boolean> => {')
    expect(source).toContain('await $fetch<Note>(`/api/blog/notes/${id}`, { method: \'PATCH\' })')
    expect(source).toContain('await notesCollection.utils.refetch()')
    expect(source).toContain('return { execute, pending, error }')
  })

  it('a delete on an entity the app doesn\'t list posts and has nothing to refetch', () => {
    const source = composable('useRemoveSecret')
    expect(source).not.toContain('createOptimisticAction')
    expect(source).toContain('const execute = async (id: string): Promise<boolean> => {')
    expect(source).toContain('await $fetch(`/api/blog/secrets/${id}`, { method: \'DELETE\' })')
    expect(source).not.toContain('Collection')
  })

  it('a blank action over an entity sends the entity as the body, with a client-made id', () => {
    const source = composable('useTidyNotes')
    expect(source).not.toContain('createOptimisticAction')
    expect(source).toContain('import { newId } from \'#core/kernel/ids\'')
    expect(source).toContain('type TidyNotesInput = Omit<NewNote, \'id\'>')
    expect(source).toContain('const execute = async (input: TidyNotesInput): Promise<boolean> => {')
    expect(source).toContain('await $fetch(\'/api/blog/notes/tidy-notes\', { method: \'POST\', body: { ...input, id: newId() } })')
  })

  it('an action with no input still posts with nothing', () => {
    const source = composable('useTidyPosts')
    expect(source).toContain('const execute = async (): Promise<boolean> => {')
    expect(source).toContain('await $fetch(\'/api/blog/posts/tidy-posts\', { method: \'POST\' })')
  })

  it('an action with an optimistic update keeps createOptimisticAction', () => {
    expect(composable('usePublishPost')).toContain('createOptimisticAction<string>({')
    expect(composable('useCreatePost')).toContain('createOptimisticAction<NewPost>({')
  })
})

describe('generateActions rules', () => {
  it('a module without actions still gets its error type and composition root', () => {
    const model = fixtureModel()
    model.modules.blog!.actions = []
    const files = generateActions(model)
    expect(files.find(file => file.path.endsWith('domain/errors.ts'))!.content).toContain('export type BlogError = never\n')
    expect(files.find(file => file.path.endsWith('utils/blog.ts'))!.content).toContain('export const blogErrorStatus: ErrorStatusMap = {}\n')
    // A module with nothing to wire: no blank line inside an empty object.
    model.modules.blog!.repositories = []
    const empty = generateActions(model).find(file => file.path.endsWith('utils/blog.ts'))!.content
    expect(empty).toContain('  return {}\n')
    expect(empty).not.toContain('{\n\n')
  })

  it('wires only the repositories some use-case consumes, so the root has no unused binding or import', () => {
    const model = fixtureModel()
    const blog = model.modules.blog!
    // Posts: a repository with no action and no exposed list. Quotes: still listed.
    blog.actions = []
    delete blog.repositories.find(entry => entry.id === 'repo_post')!.expose
    const root = generateActions(model).find(file => file.path.endsWith('utils/blog.ts'))!.content
    expect(root).not.toContain('const posts')
    expect(root).not.toContain('drizzlePostRepository')
    expect(root).toContain('  const quotes = restQuoteRepository(useRemote(\'quotes\'))\n')
    expect(root).toContain('/** The blog module\'s use-cases, wired to the "quotes" data source. */\n')
    // Nothing consumed at all: no adapter, no wiring claim.
    delete blog.repositories.find(entry => entry.id === 'repo_quote')!.expose
    const bare = generateActions(model).find(file => file.path.endsWith('utils/blog.ts'))!.content
    expect(bare).not.toMatch(/Repository|^ {2}const /m)
    expect(bare).toContain('/** The blog module\'s use-cases. */\nexport const useBlog = () => {\n  return {}\n}\n')
  })

  it('refuses steps it cannot generate yet with the action and step', () => {
    const model = fixtureModel()
    model.modules.blog!.actions[0]!.steps.push({ kind: 'custom', name: 'notify' })
    expect(() => generateActions(model)).toThrow('act_create_post: step 4 ("custom") is not generated yet')
  })

  it('escapes error messages', () => {
    const model = fixtureModel()
    model.modules.blog!.actions[1]!.errors[0]!.message = 'Post `x` ${gone} not found.'
    const errors = generateActions(model).find(file => file.path.endsWith('domain/errors.ts'))!.content
    expect(errors).toContain('message: \'Post `x` ${gone} not found.\'')
  })
})
