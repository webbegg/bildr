import { describe, expect, it } from 'vitest'
import { bindingItem, hasBindings, resolveBindings } from '#shared/runtime/bindings'

const item = { id: 'rec_1', name: 'Flat white', price: 3.5, vegan: true, photo: '/img/fw.jpg', notes: null }

describe('resolveBindings', () => {
  it('replaces {{ item.<field> }} with the record value, tolerating whitespace', () => {
    expect(resolveBindings('{{ item.name }}', { item })).toBe('Flat white')
    expect(resolveBindings('{{item.name}}', { item })).toBe('Flat white')
    expect(resolveBindings('{{   item.name\t}}', { item })).toBe('Flat white')
  })

  it('resolves several bindings and keeps the text around them', () => {
    expect(resolveBindings('{{ item.name }} · €{{ item.price }}', { item })).toBe('Flat white · €3.5')
  })

  it('writes numbers and booleans as strings', () => {
    expect(resolveBindings('{{ item.price }}', { item })).toBe('3.5')
    expect(resolveBindings('vegan: {{ item.vegan }}', { item })).toBe('vegan: true')
  })

  it('resolves the record id', () => {
    expect(resolveBindings('/menu/{{ item.id }}', { item })).toBe('/menu/rec_1')
  })

  it('renders missing and empty fields as an empty string', () => {
    expect(resolveBindings('[{{ item.colour }}]', { item })).toBe('[]')
    expect(resolveBindings('[{{ item.notes }}]', { item })).toBe('[]')
  })

  it('renders item bindings as empty outside a record', () => {
    expect(resolveBindings('Hi {{ item.name }}', {})).toBe('Hi ')
  })

  it('keeps placeholders that are not item bindings literal, so typos stay visible', () => {
    expect(resolveBindings('{{ name }} and {{ user.name }}', { item })).toBe('{{ name }} and {{ user.name }}')
  })

  it('resolves {{ env.NAME }} from the scope env next to item bindings', () => {
    const env = { BRAND: 'Bean' }
    expect(resolveBindings('{{ env.BRAND }} · {{ item.name }}', { item, env })).toBe('Bean · Flat white')
    expect(resolveBindings('{{env.BRAND}}', { env })).toBe('Bean')
  })

  it('keeps env refs as written without an env, and unknown names unless asked to render them empty', () => {
    expect(resolveBindings('{{ env.BRAND }} {{ item.name }}', { item })).toBe('{{ env.BRAND }} Flat white')
    expect(resolveBindings('[{{ env.NOPE }}]', { env: {} })).toBe('[{{ env.NOPE }}]')
    expect(resolveBindings('[{{ env.NOPE }}]', { env: {}, onMissingEnv: 'empty' })).toBe('[]')
  })

  it('does not resolve env refs that come from a record value', () => {
    expect(resolveBindings('{{ item.note }}', { item: { note: '{{ env.BRAND }}' }, env: { BRAND: 'Bean' } })).toBe('{{ env.BRAND }}')
  })

  it('leaves strings without bindings unchanged', () => {
    expect(resolveBindings('Plain {text}', { item })).toBe('Plain {text}')
  })
})

describe('hasBindings', () => {
  it('detects item bindings only', () => {
    expect(hasBindings('{{ item.name }}')).toBe(true)
    expect(hasBindings('{{ name }}')).toBe(false)
    expect(hasBindings('plain')).toBe(false)
  })
})

describe('bindingItem', () => {
  it('flattens a record into the binding scope with id and timestamps', () => {
    expect(bindingItem({ id: 'rec_1', createdAt: 'c', updatedAt: 'u', values: { name: 'Tea' } }))
      .toEqual({ id: 'rec_1', createdAt: 'c', updatedAt: 'u', name: 'Tea' })
  })
})
