import { describe, expect, it } from 'vitest'
import type { StateFile } from '@bildr/codegen/model'
import { changedOutside, changesOf, draftOf, fieldOfRefusal, moveField, newField, rebaseDraft } from '../../src/editor/stateDraft.ts'

/**
 * The State Fields form's draft (B2, S1): a state's fields as the form holds them (a text in every default box) and what saving
 * them asks of `state_update`: the whole list, each field with its id, so the module matches it to the field it is.
 */

const state = (): StateFile => ({
  id: 'st_preferences',
  name: 'preferences',
  label: 'Preferences',
  persist: 'memory',
  shape: 'single',
  fields: [
    { id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false },
    { id: 'fld_per_page', name: 'perPage', type: 'integer', required: true, default: 10 },
    { id: 'fld_search', name: 'search', type: 'text', default: '' }
  ]
})

describe('draftOf', () => {
  it('holds each field as text: its default as typed, and whether it is required', () => {
    expect(draftOf(state()).fields.map(field => [field.id, field.name, field.type, field.required, field.default])).toEqual([
      ['fld_show_drafts', 'showDrafts', 'boolean', false, 'false'],
      ['fld_per_page', 'perPage', 'integer', true, '10'],
      ['fld_search', 'search', 'text', false, '']
    ])
  })

  it('gives a field with no default an empty box', () => {
    const given = state()
    delete given.fields[0]!.default
    expect(draftOf(given).fields[0]!.default).toBe('')
  })
})

describe('changesOf', () => {
  it('sends nothing for a draft nobody touched', () => {
    expect(changesOf(draftOf(state()), state())).toEqual({ fields: null, problems: [] })
  })

  it('sends the whole list with every field\'s id, the untouched ones as stored', () => {
    const draft = draftOf(state())
    draft.fields[1]!.default = '25'
    expect(changesOf(draft, state())).toEqual({
      fields: [
        { id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false },
        { id: 'fld_per_page', name: 'perPage', type: 'integer', required: true, default: 25 },
        { id: 'fld_search', name: 'search', type: 'text', default: '' }
      ],
      problems: []
    })
  })

  it('types a default by the field\'s type: a toggle, a number, a date and a date and time', () => {
    const draft = draftOf(state())
    draft.fields.push(
      { ...newField(), name: 'ratio', type: 'number', default: '0.5' },
      { ...newField(), name: 'since', type: 'date', default: '2026-11-18' },
      { ...newField(), name: 'at', type: 'datetime', default: '2026-11-18T10:30' },
      { ...newField(), name: 'open', type: 'boolean', default: 'true' }
    )
    const sent = changesOf(draft, state()).fields!.slice(3)
    expect(sent).toEqual([
      { name: 'ratio', type: 'number', default: 0.5 },
      { name: 'since', type: 'date', default: '2026-11-18' },
      { name: 'at', type: 'datetime', default: '2026-11-18T10:30:00Z' },
      { name: 'open', type: 'boolean', default: true }
    ])
  })

  it('sends a new field with no id, and no default when its box is empty', () => {
    const draft = draftOf(state())
    draft.fields.push({ ...newField(), name: 'tag', type: 'text' })
    expect(changesOf(draft, state()).fields!.at(-1)).toEqual({ name: 'tag', type: 'text' })
  })

  it('leaves out a field removed, and sends the order the draft has', () => {
    const draft = draftOf(state())
    draft.fields.splice(0, 1)
    expect(changesOf(draft, state()).fields!.map(field => field.name)).toEqual(['perPage', 'search'])
    const moved = moveField(draftOf(state()), 2, 0)
    expect(changesOf(moved, state()).fields!.map(field => field.name)).toEqual(['search', 'showDrafts', 'perPage'])
  })

  it('keeps a renamed field\'s id so the module matches it', () => {
    const draft = draftOf(state())
    draft.fields[2]!.name = 'query'
    expect(changesOf(draft, state()).fields![2]).toEqual({ id: 'fld_search', name: 'query', type: 'text', default: '' })
  })

  it('says what a box holds that cannot be sent: a default that is not a number, a field without a name', () => {
    const draft = draftOf(state())
    draft.fields[1]!.default = 'lots'
    draft.fields.push({ ...newField(), name: '  ' })
    expect(changesOf(draft, state())).toEqual({ fields: null, problems: ['perPage: its default is a whole number', 'Name every field'] })
  })
})

describe('a state that changed under the draft', () => {
  it('counts a change of the fields, not of the label or the persistence', () => {
    const stored = state()
    stored.label = 'Settings'
    stored.persist = 'localStorage'
    expect(changedOutside(state(), stored)).toBe(false)
    stored.fields[0]!.default = true
    expect(changedOutside(state(), stored)).toBe(true)
  })

  it('keeps what the user touched, and takes what they did not from the stored state, with what was added', () => {
    const draft = draftOf(state())
    draft.fields[1]!.default = '25'
    const stored = state()
    stored.fields[0]!.default = true
    stored.fields.push({ id: 'fld_tag', name: 'tag', type: 'text' })
    const rebased = rebaseDraft(draft, state(), stored)
    expect(rebased.fields.map(field => [field.name, field.default])).toEqual([['showDrafts', 'true'], ['perPage', '25'], ['search', ''], ['tag', '']])
  })

  it('drops a field removed elsewhere that the user did not touch, and keeps one the user removed removed', () => {
    const draft = draftOf(state())
    draft.fields.splice(2, 1)
    const stored = state()
    stored.fields.splice(0, 1)
    expect(rebaseDraft(draft, state(), stored).fields.map(field => field.name)).toEqual(['perPage'])
  })
})

describe('fieldOfRefusal', () => {
  const fields = draftOf(state()).fields
  const key = (name: string) => fields.find(field => field.name === name)!.key

  it('finds the field the module names in its refusal', () => {
    expect(fieldOfRefusal('The field showDrafts of the state preferences (st_preferences) is still used: page "index" (pg_index) binds "prefs". It can\'t be removed: change them first', fields)).toBe(key('showDrafts'))
    expect(fieldOfRefusal('perPage: the default "x" doesn\'t fit integer', fields)).toBe(key('perPage'))
    expect(fieldOfRefusal('Two fields are named "search"', fields)).toBe(key('search'))
  })

  it('finds a saved field by the name it has saved, when the draft renamed it', () => {
    const renamed = draftOf(state()).fields.map(field => field.name === 'showDrafts' ? { ...field, name: 'showAll' } : field)
    const refusal = 'The field showDrafts of the state preferences (st_preferences) is still used: page "index" (pg_index) binds "prefs". It can\'t be renamed to showAll: change them first'
    expect(fieldOfRefusal(refusal, renamed)).toBeNull()
    expect(fieldOfRefusal(refusal, renamed, state().fields)).toBe('fld_show_drafts')
  })

  it('finds none for a refusal about something else', () => {
    expect(fieldOfRefusal('No state "st_gone"', fields)).toBeNull()
    expect(fieldOfRefusal('The field other of the state preferences is still used', fields)).toBeNull()
  })
})
