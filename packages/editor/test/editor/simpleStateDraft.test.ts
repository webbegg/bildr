import { describe, expect, it } from 'vitest'
import type { StateFile } from '@bildr/codegen/model'
import { newField, setDefault, setFieldType } from '../../src/editor/stateDraft.ts'
import { storeChangedOutside, storeChangesOf, storeDirty, storeDraftOf, storeRebase } from '../../src/editor/simpleStateDraft.ts'

/**
 * The simple store form's draft (simple data, S3): a store's fields (`stateDraft.ts` owns how a field is held) and how long it keeps its
 * values as one draft, and what saving it asks of `state_update`: the whole list of fields when any field changed, `persist` when it
 * did, both in one call when both did.
 */

const state = (): StateFile => ({
  id: 'st_preferences',
  name: 'preferences',
  label: 'Preferences',
  persist: 'memory',
  shape: 'single',
  fields: [
    { id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false },
    { id: 'fld_per_page', name: 'perPage', type: 'integer', default: 10 }
  ]
})

const added = (name: string) => ({ ...newField(), name })

describe('storeDraftOf and storeDirty', () => {
  it('holds the fields and how long the store keeps its values', () => {
    const draft = storeDraftOf(state())
    expect(draft.persist).toBe('memory')
    expect(draft.fields.map(field => [field.id, field.name, field.type])).toEqual([['fld_show_drafts', 'showDrafts', 'boolean'], ['fld_per_page', 'perPage', 'integer']])
  })

  it('is not dirty as opened, and is dirty when the persistence or a field changed', () => {
    const saved = state()
    expect(storeDirty(storeDraftOf(saved), saved)).toBe(false)
    expect(storeDirty({ ...storeDraftOf(saved), persist: 'session' }, saved)).toBe(true)
    const edited = storeDraftOf(saved)
    edited.fields.push(added('search'))
    expect(storeDirty(edited, saved)).toBe(true)
  })
})

describe('storeChangesOf', () => {
  it('asks for nothing when nothing changed', () => {
    const saved = state()
    expect(storeChangesOf(storeDraftOf(saved), saved)).toEqual({ input: null, problems: [] })
  })

  it('sends the persistence alone when only it changed', () => {
    const saved = state()
    expect(storeChangesOf({ ...storeDraftOf(saved), persist: 'localStorage' }, saved)).toEqual({ input: { persist: 'localStorage' }, problems: [] })
  })

  it('sends the whole list of fields alone when only they changed, each saved field with its id', () => {
    const saved = state()
    const draft = storeDraftOf(saved)
    draft.fields.push(added('search'))
    expect(storeChangesOf(draft, saved).input).toEqual({
      fields: [
        { id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false },
        { id: 'fld_per_page', name: 'perPage', type: 'integer', default: 10 },
        { name: 'search', type: 'text' }
      ]
    })
  })

  it('sends the persistence and the fields together, in one input', () => {
    const saved = state()
    const draft = { ...storeDraftOf(saved), persist: 'session' as const }
    draft.fields.push(added('search'))
    const { input, problems } = storeChangesOf(draft, saved)
    expect(problems).toEqual([])
    expect(Object.keys(input ?? {}).sort()).toEqual(['fields', 'persist'])
    expect(input?.persist).toBe('session')
    expect((input?.fields as Array<{ name: string }>).map(field => field.name)).toEqual(['showDrafts', 'perPage', 'search'])
  })

  it('sends nothing, and says which field, when a default does not fit, even if the persistence changed too', () => {
    const saved = state()
    const draft = { ...storeDraftOf(saved), persist: 'session' as const }
    const field = added('total')
    setFieldType(field, 'integer')
    setDefault(field, '1.5')
    draft.fields.push(field)
    const changes = storeChangesOf(draft, saved)
    expect(changes.input).toBeNull()
    expect(changes.problems).toEqual(['total: its default is a whole number'])
  })
})

describe('storeChangedOutside', () => {
  it('is true when the persistence or a field changed under the draft', () => {
    const base = state()
    const persist = state()
    persist.persist = 'session'
    expect(storeChangedOutside(base, persist)).toBe(true)
    const field = state()
    field.fields[0]!.default = true
    expect(storeChangedOutside(base, field)).toBe(true)
  })

  it('is false for a part the form does not hold: the label or the name', () => {
    const base = state()
    const other = state()
    other.label = 'Settings'
    other.name = 'settings'
    expect(storeChangedOutside(base, other)).toBe(false)
  })
})

describe('storeRebase', () => {
  it('keeps what the user touched and shows the stored store for what they did not', () => {
    const base = state()
    const draft = { ...storeDraftOf(base), persist: 'session' as const }
    draft.fields.push(added('search'))
    const stored = state()
    stored.persist = 'localStorage'
    stored.fields[0]!.default = true
    const rebased = storeRebase(draft, base, stored)
    // They chose how long it keeps its values: theirs stays over the stored one.
    expect(rebased.persist).toBe('session')
    // The field they did not touch shows what changed elsewhere; the one they added stays.
    expect(rebased.fields.map(field => [field.name, field.default])).toEqual([['showDrafts', 'true'], ['perPage', '10'], ['search', '']])
  })

  it('takes the stored persistence when the user did not touch it', () => {
    const base = state()
    const draft = storeDraftOf(base)
    draft.fields.push(added('search'))
    const stored = state()
    stored.persist = 'localStorage'
    const rebased = storeRebase(draft, base, stored)
    expect(rebased.persist).toBe('localStorage')
    expect(rebased.fields.map(field => field.name)).toEqual(['showDrafts', 'perPage', 'search'])
  })

  it('adds a field that was added elsewhere at the end, and drops an untouched one removed elsewhere', () => {
    const base = state()
    const draft = { ...storeDraftOf(base), persist: 'session' as const }
    const stored = state()
    stored.fields = [stored.fields[1]!, { id: 'fld_search', name: 'search', type: 'text', default: '' }]
    expect(storeRebase(draft, base, stored).fields.map(field => field.name)).toEqual(['perPage', 'search'])
  })
})
