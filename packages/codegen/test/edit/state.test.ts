import { describe, expect, it } from 'vitest'
import { project } from './helpers'
import { expectGenerates, generated, PREFERENCES } from './behaviour-helpers'

/**
 * B1 (S1, S6): the state module actions. A state is `.bildr/modules/<module>/state/<name>.json`; it generates a
 * collection and the composable use<Module><Name>, which pages read through `uses.state`.
 */

const READING = '.bildr/modules/blog/state/reading.json'

describe('state_create', () => {
  it('creates a single, in-memory state with its fields and returns its id', () => {
    const p = project()
    const result = p.edit('state_create', { name: 'reading', label: 'Reading progress', fields: [{ name: 'page', type: 'integer', default: 1 }, { name: 'dark', type: 'boolean', default: false }] })
    expect(result.stateId).toBe('st_reading')
    expect(result.filePath).toBe(READING)
    expect(p.json(READING)).toEqual({
      id: 'st_reading',
      name: 'reading',
      label: 'Reading progress',
      persist: 'memory',
      shape: 'single',
      fields: [
        { id: 'fld_page', name: 'page', type: 'integer', default: 1 },
        { id: 'fld_dark', name: 'dark', type: 'boolean', default: false }
      ]
    })
    expect(p.model().modules.blog!.state.map(state => state.id)).toContain('st_reading')
  })

  it('writes only the new file, and the app it generates has the state\'s collection and composable', () => {
    const p = project()
    const result = p.edit('state_create', { name: 'reading', fields: [{ name: 'page', type: 'integer', default: 1 }] })
    expect((result.changes as Array<{ path: string }>).map(change => change.path)).toEqual([READING])
    const files = generated(p.files)
    expect(files['layers/blog/app/composables/blog/useBlogReading.ts']).toContain('useBlogReading')
    expect(files['layers/blog/app/data/reading.collection.ts']).toContain('localOnlyCollectionOptions')
  })

  it('takes the persistence and defaults to the label in words', () => {
    const p = project()
    p.edit('state_create', { name: 'readingList', persist: 'session', fields: [{ name: 'page', type: 'integer' }] })
    const file = p.json('.bildr/modules/blog/state/reading-list.json')
    expect(file.persist).toBe('session')
    expect(file.label).toBe('Reading list')
    expect(generated(p.files)['layers/blog/app/data/reading-list.collection.ts']).toContain('sessionStorage')
  })

  it('camelCases a spoken name and puts the state in the given module', () => {
    const p = project()
    const result = p.edit('state_create', { module: 'blog', name: 'Dark mode', fields: [{ name: 'On or off', type: 'boolean', default: false }] })
    expect(result.stateId).toBe('st_dark_mode')
    expect(result.filePath).toBe('.bildr/modules/blog/state/dark-mode.json')
    expect(p.json('.bildr/modules/blog/state/dark-mode.json')).toMatchObject({ name: 'darkMode', fields: [{ id: 'fld_on_or_off', name: 'onOrOff' }] })
  })

  it('starts with one text field called value when fields are left out', () => {
    const p = project()
    p.edit('state_create', { name: 'reading' })
    expect(p.json(READING).fields).toEqual([{ id: 'fld_value', name: 'value', type: 'text', default: '' }])
    expectGenerates(p)
  })

  it('refuses a name that is taken, ignoring case, in the module', () => {
    const p = project()
    expect(p.refuse('state_create', { name: 'preferences', fields: [{ name: 'a', type: 'text' }] }, 'invalid').message).toContain('st_preferences')
    p.refuse('state_create', { name: 'Preferences', fields: [{ name: 'a', type: 'text' }] }, 'invalid')
  })

  it.each(['data', 'set', 'computed', 'useLiveQuery', 'class', 'delete', 'undefined'])('refuses the name %s, which the generated composable or the language uses', (name) => {
    project().refuse('state_create', { name }, 'invalid')
  })

  it('refuses a name that is not a name', () => {
    project().refuse('state_create', { name: '1st' }, 'invalid')
    project().refuse('state_create', { name: '!!' }, 'invalid')
  })

  it('refuses a name whose composable a query or action of the module already has', () => {
    const p = project()
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'blogReading' })
    expect(p.refuse('state_create', { name: 'reading' }, 'invalid').message).toContain('useBlogReading')
  })

  it('refuses a name whose collection file an entity of the module already has (posts.collection.ts)', () => {
    expect(project().refuse('state_create', { name: 'posts' }, 'invalid').message).toContain('posts')
  })

  it('refuses a field called id (the row\'s key), two fields of one name, and a required field with no default', () => {
    const p = project()
    p.refuse('state_create', { name: 'reading', fields: [{ name: 'id', type: 'text' }] }, 'invalid')
    p.refuse('state_create', { name: 'reading', fields: [{ name: 'a', type: 'text' }, { name: 'a', type: 'text' }] }, 'invalid')
    expect(p.refuse('state_create', { name: 'reading', fields: [{ name: 'a', type: 'text', required: true }] }, 'invalid').message).toContain('default')
  })

  it('refuses a default that does not fit the type, or is an expression', () => {
    const p = project()
    p.refuse('state_create', { name: 'reading', fields: [{ name: 'page', type: 'integer', default: 'one' }] }, 'invalid')
    p.refuse('state_create', { name: 'reading', fields: [{ name: 'page', type: 'integer', default: 1.5 }] }, 'invalid')
    p.refuse('state_create', { name: 'reading', fields: [{ name: 'page', type: 'text', default: { $bind: 'x' } }] }, 'invalid')
    p.refuse('state_create', { name: 'reading', fields: [{ name: 'day', type: 'date', default: 'tomorrow' }] }, 'invalid')
  })

  it('refuses an unknown module (404) and input of the wrong shape (invalid_input)', () => {
    project().refuse('state_create', { module: 'nope', name: 'reading' }, 'not_found')
    project().refuse('state_create', { name: 'reading', persist: 'cloud' }, 'invalid_input')
    project().refuse('state_create', { name: 'reading', fields: [{ name: 'a', type: 'nope' }] }, 'invalid_input')
    project().refuse('state_create', { name: 'reading', fields: [] }, 'invalid_input')
    project().refuse('state_create', {}, 'invalid_input')
  })

  it('does not create shape many (the generator only builds single)', () => {
    expect(project().refuse('state_create', { name: 'reading', shape: 'many' }, 'invalid').message).toContain('not generated yet')
    project().refuse('state_create', { name: 'reading', shape: 'few' }, 'invalid_input')
  })
})

describe('state_update', () => {
  it('replaces the label, the persistence and the whole list of fields', () => {
    const p = project()
    p.edit('state_create', { name: 'reading', fields: [{ name: 'page', type: 'integer', default: 1 }] })
    p.edit('state_update', { state: 'st_reading', label: 'Where I am', persist: 'localStorage', fields: [{ name: 'chapter', type: 'text', default: 'one' }] })
    const file = p.json(READING)
    expect(file.label).toBe('Where I am')
    expect(file.persist).toBe('localStorage')
    expect(file.fields).toEqual([{ id: 'fld_chapter', name: 'chapter', type: 'text', default: 'one' }])
    expectGenerates(p)
  })

  it('keeps the id of a field it is given by id, and mints one for a new name', () => {
    const p = project()
    p.edit('state_create', { name: 'reading', fields: [{ name: 'page', type: 'integer', default: 1 }, { name: 'dark', type: 'boolean', default: false }] })
    p.edit('state_update', { state: 'st_reading', fields: [{ id: 'fld_dark', name: 'dark', type: 'boolean', default: true }, { id: 'fld_page', name: 'pageNumber', type: 'integer', default: 1 }, { name: 'zoom', type: 'number', default: 1 }] })
    expect(p.json(READING).fields).toEqual([
      { id: 'fld_dark', name: 'dark', type: 'boolean', default: true },
      { id: 'fld_page', name: 'pageNumber', type: 'integer', default: 1 },
      { id: 'fld_zoom', name: 'zoom', type: 'number', default: 1 }
    ])
  })

  it('changes nothing it is not given', () => {
    const p = project()
    p.edit('state_update', { state: 'st_preferences', label: 'Preferences' })
    const file = p.json(PREFERENCES)
    expect(file.label).toBe('Preferences')
    expect(file.persist).toBe('localStorage')
    expect(file.fields).toHaveLength(1)
  })

  it('refuses a field it is given the id of that the state does not have, and an unknown state', () => {
    const p = project()
    p.refuse('state_update', { state: 'st_preferences', fields: [{ id: 'fld_nope', name: 'a', type: 'text' }] }, 'not_found')
    p.refuse('state_update', { state: 'st_nope', label: 'x' }, 'not_found')
  })

  it('refuses a field the page binds or a step sets losing its name, going away or changing type, naming the uses', () => {
    const p = project()
    // showDrafts is bound by the checkbox and the computed list source of pg_index, and set by n_toggle.
    const removed = p.refuse('state_update', { state: 'st_preferences', fields: [{ name: 'other', type: 'boolean', default: false }] }, 'invalid')
    expect(removed.message).toContain('showDrafts')
    expect(removed.message).toContain('pg_index')
    const retyped = p.refuse('state_update', { state: 'st_preferences', fields: [{ name: 'showDrafts', type: 'text', default: '' }] }, 'invalid')
    expect(retyped.message).toContain('pg_index')
    const renamed = p.refuse('state_update', { state: 'st_preferences', fields: [{ id: 'fld_show_drafts', name: 'drafts', type: 'boolean', default: false }] }, 'invalid')
    expect(renamed.message).toContain('pg_index')
  })

  it('lets a used field change its default and whether it is required, and an unused field go away', () => {
    const p = project()
    p.edit('state_update', { state: 'st_preferences', fields: [{ name: 'showDrafts', type: 'boolean', default: true, required: true }, { name: 'spare', type: 'text' }] })
    expect(p.json(PREFERENCES).fields[0]).toEqual({ id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', required: true, default: true })
    p.edit('state_update', { state: 'st_preferences', fields: [{ name: 'showDrafts', type: 'boolean', default: false }] })
    expect(p.json(PREFERENCES).fields.map((field: { name: string }) => field.name)).toEqual(['showDrafts'])
    expectGenerates(p)
  })

  it('validates defaults against the types, and refuses a required field without a default', () => {
    const p = project()
    p.refuse('state_update', { state: 'st_preferences', fields: [{ name: 'showDrafts', type: 'boolean', default: 'yes' }] }, 'invalid')
    p.refuse('state_update', { state: 'st_preferences', fields: [{ name: 'showDrafts', type: 'boolean', required: true }] }, 'invalid')
    p.refuse('state_update', { state: 'st_preferences', fields: [{ name: 'showDrafts', type: 'boolean', default: false }, { name: 'showDrafts', type: 'boolean', default: false }] }, 'invalid')
    p.refuse('state_update', { state: 'st_preferences', fields: [{ name: 'id', type: 'text' }] }, 'invalid')
    p.refuse('state_update', { state: 'st_preferences', fields: [] }, 'invalid_input')
  })

  it('refuses to edit a state of shape many, which the generator does not build yet', () => {
    const p = project()
    const many = { ...p.json(PREFERENCES), id: 'st_many', name: 'many', shape: 'many' }
    const files = { ...p.files, '.bildr/modules/blog/state/many.json': `${JSON.stringify(many, null, 2)}\n` }
    const q = project(files)
    expect(q.refuse('state_update', { state: 'st_many', label: 'x' }, 'invalid').message).toContain('not generated yet')
  })
})

describe('state_rename', () => {
  it('renames the state, and says which composable it generates now', () => {
    const p = project()
    const result = p.edit('state_rename', { state: 'st_preferences', name: 'settings' })
    expect(result).toMatchObject({ stateId: 'st_preferences', name: 'settings', previousName: 'preferences', composable: 'useBlogSettings', previousComposable: 'useBlogPreferences' })
    expect(p.json(PREFERENCES).name).toBe('settings')
    const files = generated(p.files)
    expect(files['layers/blog/app/composables/blog/useBlogSettings.ts']).toBeDefined()
    expect(files['layers/blog/app/composables/blog/useBlogPreferences.ts']).toBeUndefined()
    // The page uses it by id and reads it by its own alias: it still renders.
    expect(files['layers/blog/app/pages/index.vue']).toContain('useBlogSettings()')
  })

  it('refuses a taken name, a reserved one, a clash with a query composable or an entity collection file', () => {
    const p = project()
    p.edit('state_create', { name: 'reading' })
    p.refuse('state_rename', { state: 'st_preferences', name: 'reading' }, 'invalid')
    p.refuse('state_rename', { state: 'st_preferences', name: 'data' }, 'invalid')
    p.refuse('state_rename', { state: 'st_preferences', name: 'posts' }, 'invalid')
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'blogSettings' })
    p.refuse('state_rename', { state: 'st_preferences', name: 'settings' }, 'invalid')
    p.refuse('state_rename', { state: 'st_nope', name: 'x' }, 'not_found')
  })

  it('may keep its own name in another case', () => {
    const p = project()
    p.edit('state_rename', { state: 'st_preferences', name: 'preferencesTwo' })
    expect(p.json(PREFERENCES).name).toBe('preferencesTwo')
  })
})

describe('state_delete', () => {
  it('refuses while a page uses the state, naming it, and writes nothing', () => {
    const p = project()
    const refusal = p.refuse('state_delete', { state: 'st_preferences' }, 'invalid')
    expect(refusal.message).toContain('pg_index')
    expect(p.refuse('state_delete', { state: 'st_nope' }, 'not_found').message).toContain('st_nope')
  })

  it('deletes an unused state: its file goes and the app still generates', () => {
    const p = project()
    p.edit('state_create', { name: 'reading' })
    const result = p.edit('state_delete', { state: 'st_reading' })
    expect(result.deleted).toEqual(['st_reading'])
    expect(p.files[READING]).toBeUndefined()
    expect((result.changes as Array<{ path: string, content: unknown }>)).toEqual([{ path: READING, content: null }])
    expectGenerates(p)
  })
})
