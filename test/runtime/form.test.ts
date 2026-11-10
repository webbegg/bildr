import { describe, expect, it } from 'vitest'
import { createNode } from '#shared/document/factory'
import type { Field } from '#shared/document/schema'
import { enclosingForm, formFields, formValues, sampleValues } from '#shared/runtime/form'

describe('formValues', () => {
  it('collects the inputs\' values by field', () => {
    expect(formValues([['email', 'ana@example.com'], ['message', 'Hello']])).toEqual({ email: 'ana@example.com', message: 'Hello' })
  })

  it('skips inputs without a field and non-text entries such as files', () => {
    expect(formValues([['', 'ignored'], ['email', 'a@b.c'], ['photo', new Blob(['x'])]])).toEqual({ email: 'a@b.c' })
  })

  it('keeps empty values, so the server can clear or store them', () => {
    expect(formValues([['message', '']])).toEqual({ message: '' })
  })

  it('lets a later input of the same field win', () => {
    expect(formValues([['email', 'first'], ['email', 'second']])).toEqual({ email: 'second' })
  })
})

describe('formFields', () => {
  it('lists the fields of the Inputs inside a Form, in order and once each', () => {
    const form = createNode('Form')
    const row = createNode('Row')
    row.children.push(createNode('Input', { field: 'message' }), createNode('Input', { field: 'email' }))
    form.children.push(createNode('Input', { field: 'email' }), createNode('Input'), row, createNode('Button', { action: 'submit' }))
    expect(formFields(form)).toEqual(['email', 'message'])
  })
})

describe('enclosingForm', () => {
  it('finds the nearest Form above a node', () => {
    const page = createNode('Container')
    const form = createNode('Form')
    const row = createNode('Row')
    const input = createNode('Input')
    const outside = createNode('Input')
    row.children.push(input)
    form.children.push(row)
    page.children.push(form, outside)
    expect(enclosingForm(page, input.id)).toBe(form)
    expect(enclosingForm(page, outside.id)).toBeUndefined()
    expect(enclosingForm(page, form.id)).toBeUndefined()
  })
})

describe('sampleValues', () => {
  const fields: Field[] = [
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'guests', label: 'Guests', type: 'number' },
    { key: 'vegan', label: 'Vegan', type: 'boolean' },
    { key: 'day', label: 'Day', type: 'date' },
    { key: 'photo', label: 'Photo', type: 'image' }
  ]

  it('gives each field a value of its type', () => {
    expect(sampleValues(fields, new Date('2026-11-09T15:00:00Z'))).toEqual({
      email: 'Test email',
      guests: 1,
      vegan: true,
      day: '2026-11-09',
      photo: 'https://placehold.co/600x400'
    })
  })

  it('fills only the given keys when the Form maps some fields', () => {
    expect(sampleValues(fields, new Date('2026-11-09T15:00:00Z'), ['guests', 'unknown'])).toEqual({ guests: 1 })
  })
})

describe('formFields with components', () => {
  it('includes the Inputs of instances inside the Form', () => {
    const input = { ...createNode('Input', { field: 'email' }), id: 'in' }
    const def = {
      id: 'fld',
      name: 'Field',
      root: { ...createNode('Container'), id: 'root', children: [input] },
      properties: [{ id: 'p-f', name: 'Field', kind: 'field' as const, bindings: [{ nodeId: 'in', prop: 'field' }] }],
      variants: []
    }
    const form = { ...createNode('Form'), id: 'form', children: [{ ...createNode('Instance', { 'component': 'fld', 'p-f': 'message' }), id: 'i1' }] }
    expect(formFields(form, [def])).toEqual(['message'])
    expect(formFields(form)).toEqual([])
  })
})
