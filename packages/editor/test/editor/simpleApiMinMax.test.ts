// API model min/max in the editor: typed as numbers beside a text or number field, saved on the model, checked as the model checks them.
import { describe, expect, it } from 'vitest'
import type { ApiModel } from '@bildr/codegen/model'
import { modelDraftOf, modelOutput, modelProblems, setFieldType, takesRange } from '../../src/editor/simpleApiDraft.ts'

const stored: ApiModel = { name: 'Contact', fields: [{ name: 'name', type: 'text', min: 2, max: 80 }, { name: 'age', type: 'integer', min: 0 }, { name: 'live', type: 'boolean' }] }

describe('an API model field\'s min and max in the editor', () => {
  it('are opened and saved back as they are', () => {
    const draft = modelDraftOf(stored)
    expect(draft.fields.map(field => [field.min, field.max])).toEqual([['2', '80'], ['0', ''], ['', '']])
    expect(modelOutput('Contact', draft)).toEqual(stored)
  })

  it('are taken by text and number fields only', () => {
    expect(['text', 'integer', 'number', 'money', 'percent'].every(type => takesRange(type as never))).toBe(true)
    expect(['email', 'boolean', 'select', 'date', 'model'].some(type => takesRange(type as never))).toBe(false)
  })

  it('save a typed number, and go with a type that takes none', () => {
    const draft = modelDraftOf(stored)
    draft.fields[1]!.max = ' 120 '
    expect(modelOutput('Contact', draft).fields[1]).toEqual({ name: 'age', type: 'integer', min: 0, max: 120 })
    setFieldType(draft.fields[0]!, 'boolean')
    expect([draft.fields[0]!.min, draft.fields[0]!.max]).toEqual(['', ''])
    expect(modelOutput('Contact', draft).fields[0]).toEqual({ name: 'name', type: 'boolean' })
  })

  it('say what is wrong with them before saving', () => {
    const draft = modelDraftOf(stored)
    draft.fields[0]!.min = 'two'
    expect(modelProblems(draft)).toEqual(['name: its min is a number, like 3'])
    draft.fields[0]!.min = '90'
    expect(modelProblems(draft)).toEqual(['name: its min (90) is over its max (80)'])
    draft.fields[0]!.min = '1.5'
    expect(modelProblems(draft)).toEqual(['name: a text\'s min and max are lengths: use whole numbers'])
  })
})
