import { describe, expect, it } from 'vitest'
import { project } from './helpers'
import { expectGenerates } from './behaviour-helpers'

/**
 * B2 review: how `state_update` matches the entries of `fields` to the saved fields, and how a refusal about one field says which
 * (`field: { id?, name }`, additive next to `message`).
 *
 * An entry with an id is that field. When any entry has an id the caller knows ids (the editor always sends them for saved fields),
 * so an entry without one is a NEW field, never matched by name to a field another entry claimed or one the list left out. When no
 * entry has an id, entries match saved fields by name (the shorthand for a caller that does not keep ids).
 */

const READING = '.bildr/modules/blog/state/reading.json'

/** A state `reading` with page (an integer with a minimum, which `state_create` can't say) and dark. */
const reading = () => {
  const p = project()
  p.edit('state_create', { name: 'reading', fields: [{ name: 'page', type: 'integer', default: 1 }, { name: 'dark', type: 'boolean', default: false }] })
  const file = p.json(READING)
  file.fields[0].min = 1
  return project({ ...p.files, [READING]: `${JSON.stringify(file, null, 2)}\n` })
}

const PAGE = { id: 'fld_page', name: 'page', type: 'integer', default: 1 }
const DARK = { id: 'fld_dark', name: 'dark', type: 'boolean', default: false }

describe('state_update: which field an entry is', () => {
  it('renames a saved field and adds a new one with its old name in one save', () => {
    const p = reading()
    p.edit('state_update', { state: 'st_reading', fields: [{ ...PAGE, name: 'pageNumber' }, DARK, { name: 'page', type: 'text', default: '' }] })
    expect(p.json(READING).fields).toEqual([
      { id: 'fld_page', name: 'pageNumber', type: 'integer', min: 1, default: 1 },
      { id: 'fld_dark', name: 'dark', type: 'boolean', default: false },
      { id: 'fld_page_2', name: 'page', type: 'text', default: '' }
    ])
    expectGenerates(p)
  })

  it('does the same when the list is reordered as well', () => {
    const p = reading()
    p.edit('state_update', { state: 'st_reading', fields: [{ name: 'page', type: 'text', default: '' }, DARK, { ...PAGE, name: 'pageNumber' }] })
    expect(p.json(READING).fields).toEqual([
      { id: 'fld_page_2', name: 'page', type: 'text', default: '' },
      { id: 'fld_dark', name: 'dark', type: 'boolean', default: false },
      { id: 'fld_page', name: 'pageNumber', type: 'integer', min: 1, default: 1 }
    ])
  })

  it('makes a field removed and added again under the same name a new field: it does not inherit the old id or its extras', () => {
    const p = reading()
    p.edit('state_update', { state: 'st_reading', fields: [DARK, { name: 'page', type: 'integer', default: 5 }] })
    expect(p.json(READING).fields).toEqual([
      { id: 'fld_dark', name: 'dark', type: 'boolean', default: false },
      { id: 'fld_page_2', name: 'page', type: 'integer', default: 5 }
    ])
  })

  it('still matches entries to fields by name when no entry has an id, keeping the extras', () => {
    const p = reading()
    p.edit('state_update', { state: 'st_reading', fields: [{ name: 'dark', type: 'boolean', default: true }, { name: 'page', type: 'integer', default: 2 }] })
    expect(p.json(READING).fields).toEqual([
      { id: 'fld_dark', name: 'dark', type: 'boolean', default: true },
      { id: 'fld_page', name: 'page', type: 'integer', min: 1, default: 2 }
    ])
  })

  it('treats an entry without an id as new when another entry has one, even when a saved field has its name', () => {
    const p = reading()
    p.edit('state_update', { state: 'st_reading', fields: [{ id: 'fld_dark', name: 'dark', type: 'boolean', default: false }, { name: 'page', type: 'integer', default: 1 }] })
    const fields = p.json(READING).fields as Array<{ id: string, min?: number }>
    expect(fields.map(field => field.id)).toEqual(['fld_dark', 'fld_page_2'])
    expect(fields[1]!.min).toBeUndefined()
  })
})

describe('state_update: a refusal about one field says which', () => {
  const refusedField = (fields: unknown[], state = 'st_reading', p = reading()) => {
    const outcome = p.refuse('state_update', { state, fields }, 'invalid')
    return (outcome as { field?: unknown }).field
  }

  it('names a field that is still used by its id and the name it has saved', () => {
    const p = project()
    const outcome = p.refuse('state_update', { state: 'st_preferences', fields: [{ id: 'fld_show_drafts', name: 'drafts', type: 'boolean', default: false }] }, 'invalid')
    expect((outcome as { field?: unknown }).field).toEqual({ id: 'fld_show_drafts', name: 'showDrafts' })
  })

  it('names the entry for a default that does not fit, a required field without a default, and null', () => {
    expect(refusedField([PAGE, { ...DARK, default: 'yes' }])).toEqual({ id: 'fld_dark', name: 'dark' })
    expect(refusedField([PAGE, { name: 'search', type: 'text', required: true }])).toEqual({ name: 'search' })
    expect(refusedField([PAGE, { name: 'Search box', type: 'text', default: null }])).toEqual({ name: 'Search box' })
  })

  it('names the entry for the names the module refuses, as it was given (not camelCased)', () => {
    expect(refusedField([PAGE, { name: 'id', type: 'text' }])).toEqual({ name: 'id' })
    expect(refusedField([PAGE, { name: 'constructor', type: 'text' }])).toEqual({ name: 'constructor' })
    expect(refusedField([PAGE, { name: '1st', type: 'text' }])).toEqual({ name: '1st' })
  })

  it('names the second entry of two with one name', () => {
    expect(refusedField([PAGE, { name: 'Page', type: 'text' }])).toEqual({ name: 'Page' })
    expect(refusedField([PAGE, { id: 'fld_dark', name: 'page', type: 'boolean' }])).toEqual({ id: 'fld_dark', name: 'page' })
  })

  it('names the entry whose id the state does not have', () => {
    const outcome = reading().refuse('state_update', { state: 'st_reading', fields: [{ id: 'fld_nope', name: 'a', type: 'text' }] }, 'not_found')
    expect((outcome as { field?: unknown }).field).toEqual({ id: 'fld_nope', name: 'a' })
  })

  it('says nothing of a field for a refusal about the state', () => {
    const outcome = project().refuse('state_update', { state: 'st_nope', label: 'x' }, 'not_found')
    expect(outcome).not.toHaveProperty('field')
  })
})
