import { describe, expect, it } from 'vitest'
import ModelView from '../src/views/ModelView.vue'
import { MAIN_PATH, POST_PATH, modelResult, postFile } from './fixtures.ts'
import { Failure, byTestId, click, mockActions, mountWithApp, typeInto } from './helpers.ts'

describe('Model screen', () => {
  it('lists the artifacts grouped by module, plus the top-level data sources', async () => {
    mockActions({ model_get: modelResult })
    await mountWithApp(ModelView, '/model')

    const blog = byTestId('module-blog')
    expect(blog?.textContent).toContain('Blog')
    expect(blog?.querySelector(`[data-path="${POST_PATH}"]`)?.textContent).toContain('Post')
    expect(byTestId('datasources')?.querySelector(`[data-path="${MAIN_PATH}"]`)?.textContent).toContain('main')
    for (const kind of ['entity', 'repository', 'query', 'action']) expect(byTestId(`new-blog-${kind}`)).not.toBeNull()
  })

  it('saves an edited entity to its own path as canonical JSON', async () => {
    const actions = mockActions({ model_get: modelResult, model_file_put: () => ({ sha256: 'a'.repeat(64) }) })
    await mountWithApp(ModelView, '/model')

    await click(byTestId('module-blog')!.querySelector(`[data-path="${POST_PATH}"]`))
    await typeInto(byTestId('input-plural'), 'articles')
    await typeInto(byTestId('field-0-name'), 'headline')
    await click(byTestId('save'))

    const [put] = actions.named('model_file_put')
    expect(put?.input.path).toBe(POST_PATH)
    const expected = postFile()
    expected.plural = 'articles'
    expected.fields[0]!.name = 'headline'
    expect(put?.input.content).toBe(`${JSON.stringify(expected, null, 2)}\n`)
  })

  it('creates a new entity at .bildr/modules/<module>/entities/<kebab-name>.json', async () => {
    const actions = mockActions({ model_get: modelResult, model_file_put: () => ({ sha256: 'b'.repeat(64) }) })
    await mountWithApp(ModelView, '/model')

    await click(byTestId('new-blog-entity'))
    await typeInto(byTestId('input-id'), 'ent_blog_note')
    await typeInto(byTestId('input-name'), 'BlogNote')
    await typeInto(byTestId('input-plural'), 'blogNotes')
    await click(byTestId('save'))

    const [put] = actions.named('model_file_put')
    expect(put?.input.path).toBe('.bildr/modules/blog/entities/blog-note.json')
    const saved = JSON.parse(String(put?.input.content)) as Record<string, unknown>
    expect(saved).toMatchObject({ $schema: 'https://bildr.dev/schema/entity.v1.json', id: 'ent_blog_note', name: 'BlogNote', plural: 'blogNotes', idStrategy: 'uuid' })
    expect(String(put?.input.content).endsWith('}\n')).toBe(true)
  })

  it('creates a new data source at .bildr/datasources/<name>.json', async () => {
    const actions = mockActions({ model_get: modelResult, model_file_put: () => ({ sha256: 'c'.repeat(64) }) })
    await mountWithApp(ModelView, '/model')

    await click(byTestId('new-datasource'))
    await typeInto(byTestId('input-id'), 'ds_api')
    await typeInto(byTestId('input-name'), 'api')
    await click(byTestId('save'))

    expect(actions.named('model_file_put')[0]?.input.path).toBe('.bildr/datasources/api.json')
  })

  it('shows the invalid problems next to the form', async () => {
    const problems = [{ path: POST_PATH, message: 'Unknown entity "ent_missing" in relations' }]
    mockActions({ model_get: modelResult, model_file_put: () => new Failure(422, 'invalid', 'The model would be invalid', problems) })
    await mountWithApp(ModelView, '/model')

    await click(byTestId('module-blog')!.querySelector(`[data-path="${POST_PATH}"]`))
    await click(byTestId('save'))

    const shown = byTestId('form-problems')
    expect(shown?.textContent).toContain('The model would be invalid')
    expect(shown?.textContent).toContain('Unknown entity "ent_missing" in relations')
  })

  it('deletes the selected artifact after a confirmation', async () => {
    const actions = mockActions({ model_get: modelResult, model_file_delete: () => ({}) })
    await mountWithApp(ModelView, '/model')

    await click(byTestId('module-blog')!.querySelector(`[data-path="${POST_PATH}"]`))
    await click(byTestId('delete'))
    expect(actions.named('model_file_delete')).toHaveLength(0)
    await click(byTestId('confirm-delete'))

    expect(actions.named('model_file_delete')[0]?.input).toEqual({ path: POST_PATH })
  })

  it('shows the model problems when the model does not load, and still allows editing a file', async () => {
    const problems = [{ path: POST_PATH, message: 'fields: Too small' }]
    const actions = mockActions({ model_get: () => ({ ok: false, problems }), model_file_put: () => ({ sha256: 'd'.repeat(64) }) })
    await mountWithApp(ModelView, '/model')

    expect(byTestId('model-problems')?.textContent).toContain('fields: Too small')
    await typeInto(byTestId('raw-path'), POST_PATH)
    await typeInto(byTestId('raw-content'), JSON.stringify(postFile()))
    await click(byTestId('raw-save'))

    const [put] = actions.named('model_file_put')
    expect(put?.input).toEqual({ path: POST_PATH, content: `${JSON.stringify(postFile(), null, 2)}\n` })
  })
})
