import { describe, expect, it } from 'vitest'
import type { StateFile } from '@bildr/codegen/model'
import { changedOutside, changesOf, draftOf, fieldOfRefusal, moveField, newField, rebaseDraft, setDefault, setFieldType, toggleEmptyDefault } from '../../src/editor/stateDraft.ts'

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

  it('tells a text field that starts empty from one with no default', () => {
    const given = state()
    delete given.fields[2]!.default
    expect(draftOf(state()).fields[2]).toMatchObject({ default: '', emptyDefault: true })
    expect(draftOf(given).fields[2]).toMatchObject({ default: '', emptyDefault: false })
  })

  it('shows a stored date and time in the box\'s minutes, whatever seconds or zone it has', () => {
    const given = state()
    given.fields.push({ id: 'fld_at', name: 'at', type: 'datetime', default: '2026-11-18T10:30:15+02:00' })
    expect(draftOf(given).fields[3]!.default).toBe('2026-11-18T10:30')
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

  it('sends a renamed saved field with its id, and a new field with the old name with none', () => {
    const draft = draftOf(state())
    draft.fields[2]!.name = 'query'
    draft.fields.push({ ...newField(), name: 'search', type: 'text' })
    expect(changesOf(draft, state()).fields!.slice(2)).toEqual([
      { id: 'fld_search', name: 'query', type: 'text', default: '' },
      { name: 'search', type: 'text' }
    ])
  })
})

describe('the default a box stands for', () => {
  /** What a draft of one new field of `type` with `text` in its default box sends, or its problems. */
  const sent = (type: Parameters<typeof setFieldType>[1], text: string, emptyDefault = false) => {
    const draft = draftOf(state())
    draft.fields.push({ ...newField(), name: 'x', type, default: text, emptyDefault })
    const changes = changesOf(draft, state())
    return changes.fields ? changes.fields.at(-1) : changes.problems
  }

  it('sends an empty text as the default for a text field that asked for it, and none otherwise', () => {
    expect(sent('text', '', true)).toEqual({ name: 'x', type: 'text', default: '' })
    expect(sent('text', '', false)).toEqual({ name: 'x', type: 'text' })
    expect(sent('text', '   ', false)).toEqual({ name: 'x', type: 'text' })
    expect(sent('text', '   ', true)).toEqual({ name: 'x', type: 'text', default: '' })
  })

  it('ignores the empty choice for a type with no empty value', () => {
    expect(sent('integer', '', true)).toEqual({ name: 'x', type: 'integer' })
    expect(sent('uuid', '', true)).toEqual({ name: 'x', type: 'uuid' })
  })

  it('trims every default, text included', () => {
    expect(sent('text', '  hello ')).toEqual({ name: 'x', type: 'text', default: 'hello' })
    expect(sent('integer', ' 12 ')).toEqual({ name: 'x', type: 'integer', default: 12 })
    expect(sent('number', ' 1.5 ')).toEqual({ name: 'x', type: 'number', default: 1.5 })
    expect(sent('boolean', ' true ')).toEqual({ name: 'x', type: 'boolean', default: true })
    expect(sent('date', ' 2026-11-18 ')).toEqual({ name: 'x', type: 'date', default: '2026-11-18' })
    expect(sent('datetime', ' 2026-11-18T10:30 ')).toEqual({ name: 'x', type: 'datetime', default: '2026-11-18T10:30:00Z' })
  })

  it('says a Toggle\'s default is on or off, in the words of the field type', () => {
    expect(sent('boolean', 'maybe')).toEqual(['x: its default is on or off'])
    expect(sent('boolean', 'false')).toEqual({ name: 'x', type: 'boolean', default: false })
  })

  it('refuses an integer the number type cannot hold exactly', () => {
    expect(sent('integer', '9007199254740991')).toEqual({ name: 'x', type: 'integer', default: 9007199254740991 })
    expect(sent('integer', '9007199254740993')).toEqual(['x: its default is a whole number'])
    expect(sent('integer', '-9007199254740993')).toEqual(['x: its default is a whole number'])
  })

  it('reads an exponent the same way for a number and a whole number, and nothing else the browser\'s Number would take', () => {
    expect(sent('number', '1e3')).toEqual({ name: 'x', type: 'number', default: 1000 })
    expect(sent('integer', '1e3')).toEqual({ name: 'x', type: 'integer', default: 1000 })
    expect(sent('integer', '1.5e1')).toEqual({ name: 'x', type: 'integer', default: 15 })
    expect(sent('integer', '1e-3')).toEqual(['x: its default is a whole number'])
    expect(sent('integer', '1.5')).toEqual(['x: its default is a whole number'])
    expect(sent('number', '0x10')).toEqual(['x: its default is a number'])
    expect(sent('number', 'Infinity')).toEqual(['x: its default is a number'])
    expect(sent('number', '1e999')).toEqual(['x: its default is a number'])
    expect(sent('number', '1_000')).toEqual(['x: its default is a number'])
    expect(sent('number', '.5')).toEqual({ name: 'x', type: 'number', default: 0.5 })
  })

  it('sends zero, never minus zero', () => {
    expect(Object.is((sent('number', '-0') as { default: number }).default, 0)).toBe(true)
    expect(Object.is((sent('integer', '-0') as { default: number }).default, 0)).toBe(true)
  })

  it('takes a date and time with seconds as typed, in UTC', () => {
    expect(sent('datetime', '2026-11-18T10:30:45')).toEqual({ name: 'x', type: 'datetime', default: '2026-11-18T10:30:45Z' })
  })

  describe('a stored date and time', () => {
    const withAt = (stored: string) => {
      const given = state()
      given.fields.push({ id: 'fld_at', name: 'at', type: 'datetime', default: stored })
      return given
    }

    it.each(['2026-11-18T10:30:15Z', '2026-11-18T10:30:00+02:00', '2026-11-18T10:30:15.250Z'])('is sent unchanged (%s) while its box is not edited, even when the field changes otherwise', (stored) => {
      const given = withAt(stored)
      const draft = draftOf(given)
      draft.fields[3]!.required = true
      expect(changesOf(draft, given).fields![3]).toEqual({ id: 'fld_at', name: 'at', type: 'datetime', required: true, default: stored })
      const renamed = draftOf(given)
      renamed.fields[3]!.name = 'when'
      expect(changesOf(renamed, given).fields![3]).toEqual({ id: 'fld_at', name: 'when', type: 'datetime', default: stored })
    })

    it('is sent unchanged when the box is typed over with what it showed', () => {
      const given = withAt('2026-11-18T10:30:15Z')
      const draft = draftOf(given)
      setDefault(draft.fields[3]!, '2026-11-18T10:31')
      setDefault(draft.fields[3]!, '2026-11-18T10:30')
      draft.fields[3]!.required = true
      expect(changesOf(draft, given).fields![3]).toMatchObject({ default: '2026-11-18T10:30:15Z' })
    })

    it('is sent as the box says once it is edited', () => {
      const given = withAt('2026-11-18T10:30:15+02:00')
      const draft = draftOf(given)
      setDefault(draft.fields[3]!, '2026-11-18T11:00')
      expect(changesOf(draft, given).fields![3]).toMatchObject({ default: '2026-11-18T11:00:00Z' })
    })
  })
})

describe('editing a default', () => {
  it('starts a toggle on no, and any other type empty, when the type changes', () => {
    const field = { ...newField(), name: 'x', default: 'abc', emptyDefault: true }
    setFieldType(field, 'boolean')
    expect(field).toMatchObject({ type: 'boolean', default: 'false', emptyDefault: false })
    setFieldType(field, 'integer')
    expect(field).toMatchObject({ type: 'integer', default: '', emptyDefault: false })
  })

  it('takes typing as a default, which is not the empty text any more', () => {
    const field = { ...newField(), emptyDefault: true }
    setDefault(field, 'hi')
    expect(field).toMatchObject({ default: 'hi', emptyDefault: false })
    setDefault(field, '')
    expect(field).toMatchObject({ default: '', emptyDefault: false })
  })

  it('toggles the empty text, which clears the box', () => {
    const field = { ...newField(), default: 'x' }
    toggleEmptyDefault(field)
    expect(field).toMatchObject({ default: '', emptyDefault: true })
    toggleEmptyDefault(field)
    expect(field).toMatchObject({ default: '', emptyDefault: false })
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

  // Pinned, not endorsed (RELIABILITY-007): a field the user touched is theirs whole. A change made elsewhere to another part of
  // the same field is not merged into it, so saving it puts the user's copy of that part back.
  it('keeps a field the user touched whole: what changed elsewhere in another part of it is not merged', () => {
    const draft = draftOf(state())
    draft.fields[1]!.name = 'pageSize'
    const stored = state()
    stored.fields[1]!.default = 50
    const rebased = rebaseDraft(draft, state(), stored)
    expect(rebased.fields[1]).toMatchObject({ id: 'fld_per_page', name: 'pageSize', default: '10' })
  })
})

describe('fieldOfRefusal', () => {
  const fields = draftOf(state()).fields
  const key = (name: string) => fields.find(field => field.name === name)!.key

  it('finds the field by the id the refusal names', () => {
    expect(fieldOfRefusal({ id: 'fld_per_page', name: 'perPage' }, fields)).toBe(key('perPage'))
  })

  it('finds a saved field by its id when the draft renamed it', () => {
    const renamed = draftOf(state()).fields.map(field => field.name === 'showDrafts' ? { ...field, name: 'showAll' } : field)
    expect(fieldOfRefusal({ id: 'fld_show_drafts', name: 'showDrafts' }, renamed)).toBe('fld_show_drafts')
  })

  it('finds a new field, which has no id yet, by the name it was sent with', () => {
    const added = [...fields, { ...newField(), name: ' Show Drafts ' }]
    expect(fieldOfRefusal({ name: 'Show Drafts' }, added)).toBe(added.at(-1)!.key)
  })

  it('prefers a new field to a saved one of the same name, when the refusal names no id', () => {
    const added = [...fields, { ...newField(), name: 'search' }]
    expect(fieldOfRefusal({ name: 'search' }, added)).toBe(added.at(-1)!.key)
  })

  it('does not match a field by name when the refusal names an id the draft has not', () => {
    expect(fieldOfRefusal({ id: 'fld_gone', name: 'search' }, fields)).toBeNull()
  })

  it('finds none for a refusal about something else', () => {
    expect(fieldOfRefusal(undefined, fields)).toBeNull()
    expect(fieldOfRefusal({ name: 'nothing' }, fields)).toBeNull()
  })
})
