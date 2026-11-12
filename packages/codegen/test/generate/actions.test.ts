import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateActions } from '../../src/generate/actions'
import { loadModel } from '../../src/model/load'
import type { Model } from '../../src/model/load'
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

describe('generateActions rules', () => {
  it('a module without actions still gets its error type and composition root', () => {
    const model = fixtureModel()
    model.modules.blog!.actions = []
    const files = generateActions(model)
    expect(files.find(file => file.path.endsWith('domain/errors.ts'))!.content).toContain('export type BlogError = never\n')
    expect(files.find(file => file.path.endsWith('utils/blog.ts'))!.content).toContain('export const blogErrorStatus: ErrorStatusMap = {}\n')
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
