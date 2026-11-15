import { describe, expect, it } from 'vitest'
import type { DataField } from '../../src/shared/dataModel.ts'
import { fieldSteps, mapPreview, mappingFields, mappingProblems, mappingRow, mappingRowOf } from '../../src/shared/dataMapping.ts'
import type { MappingRow } from '../../src/shared/dataMapping.ts'

/**
 * The mapping of a REST response to an entity's fields (the hosted `DataMappingTable`'s
 * `mappingRow`/`mappingProblems`/`mappingFields`, and the source dialogs' preview) over the model's field
 * names and remote keys. Editing an existing entity's mapping becomes a list of `entity_field_*` steps.
 */

const row = (over: Partial<MappingRow> = {}): MappingRow => ({ include: true, name: 'title', type: 'text', remote: 'title', ...over })

describe('mappingRow', () => {
  it('keeps what the preview inferred, included', () => {
    expect(mappingRow({ name: 'fullName', type: 'text', remote: 'full_name' })).toEqual({ include: true, name: 'fullName', type: 'text', remote: 'full_name' })
  })

  it('reads a saved field with its id and remote key', () => {
    const field: DataField = { id: 'fld_text', name: 'text', label: 'Text', type: 'text', required: true, remote: 'quote' }
    expect(mappingRowOf(field)).toEqual({ include: true, id: 'fld_text', name: 'text', type: 'text', remote: 'quote' })
  })
})

describe('mappingProblems', () => {
  it('has none for a mapping that can be saved', () => {
    expect(mappingProblems([row(), row({ name: 'author', remote: 'author_name' })])).toEqual(['', ''])
  })

  it('names why a row cannot be saved, and skips the rows left out', () => {
    const rows = [row({ name: '' }), row({ name: 'Bad Name' }), row({ name: 'title' }), row({ name: 'title', remote: 'other' }), row({ name: 'x', remote: '' }), row({ name: 'y', remote: 'origin.name' }), row({ name: '1st', include: false })]
    expect(mappingProblems(rows)).toEqual([
      'Add a name',
      'Use letters and digits, starting with a lowercase letter, like servedFrom',
      '',
      '"title" is used twice',
      'Add the key of the field in each item',
      'Map a top-level key of each item, not a path like origin.name',
      ''
    ])
  })
})

describe('mappingFields', () => {
  it('is the included rows as the fields entity_create takes', () => {
    expect(mappingFields([row(), row({ name: 'skip', include: false }), row({ name: 'age', type: 'integer', remote: 'age_years' })])).toEqual([
      { name: 'title', type: 'text', remote: 'title' },
      { name: 'age', type: 'integer', remote: 'age_years' }
    ])
  })
})

describe('mapPreview', () => {
  it('reads each included field from the item\'s remote key', () => {
    const rows = [row({ name: 'text', remote: 'quote' }), row({ name: 'author', remote: 'author' }), row({ name: 'skip', remote: 'skip', include: false })]
    const items = [{ id: 1, quote: 'Hello', author: 'Ann', skip: 'x' }, { id: 2, quote: 'Bye' }]
    expect(mapPreview(items, rows)).toEqual([{ text: 'Hello', author: 'Ann' }, { text: 'Bye', author: null }])
  })

  it('shows an item that is not an object as empty values', () => {
    expect(mapPreview(['plain'], [row()])).toEqual([{ title: null }])
  })
})

describe('fieldSteps', () => {
  const saved: DataField[] = [
    { id: 'fld_id', name: 'id', label: 'Id', type: 'integer', required: true, remote: 'id' },
    { id: 'fld_text', name: 'text', label: 'Text', type: 'text', required: true, remote: 'quote' },
    { id: 'fld_author', name: 'author', label: 'Author', type: 'text', required: true, remote: 'author' }
  ]
  const rows = () => saved.map(mappingRowOf)

  it('has no steps when nothing changed', () => {
    expect(fieldSteps('ent_quote', saved, rows())).toEqual([])
  })

  it('removes a row left out, changes a key, name or type, and adds a field by hand, in that order', () => {
    const edited = rows()
    edited[1] = { ...edited[1]!, remote: 'body', type: 'number', name: 'content' }
    edited[2] = { ...edited[2]!, include: false }
    edited.push({ include: true, name: 'likes', type: 'integer', remote: 'likes' })
    expect(fieldSteps('ent_quote', saved, edited)).toEqual([
      { name: 'entity_field_remove', input: { entity: 'ent_quote', field: 'fld_author' } },
      { name: 'entity_field_update', input: { entity: 'ent_quote', field: 'fld_text', name: 'content', type: 'number', remote: 'body' } },
      { name: 'entity_field_add', input: { entity: 'ent_quote', name: 'likes', type: 'integer', remote: 'likes' } }
    ])
  })

  it('sends only what changed', () => {
    const edited = rows()
    edited[1] = { ...edited[1]!, remote: 'body' }
    expect(fieldSteps('ent_quote', saved, edited)).toEqual([{ name: 'entity_field_update', input: { entity: 'ent_quote', field: 'fld_text', remote: 'body' } }])
  })
})
