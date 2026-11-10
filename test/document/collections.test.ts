import { describe, expect, it } from 'vitest'
import { applyOperation, applyOperations, OperationError } from '#shared/document/operations'
import { fieldKey } from '#shared/document/collections'
import { createCollection, createProject } from '#shared/document/factory'
import { ProjectSchema } from '#shared/document/schema'
import type { Collection, Project } from '#shared/document/schema'

function setup(): { project: Project, menu: Collection } {
  const project = createProject('Demo')
  const menu = createCollection('Menu', undefined, [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'price', label: 'Price', type: 'number' }
  ])
  applyOperation(project, { op: 'addCollection', index: 0, collection: menu })
  return { project, menu }
}

describe('collection schema operations', () => {
  it('a new project has no collections, and a collection defaults to private', () => {
    expect(createProject('Demo').collections).toEqual([])
    const menu = createCollection('Café Menu')
    expect(menu).toMatchObject({ name: 'Café Menu', slug: 'cafe-menu', fields: [], publicRead: false, publicCreate: false })
  })

  it('adds a collection and its inverse removes it; removing restores it at the same place', () => {
    const project = createProject('Demo')
    const a = createCollection('A')
    const b = createCollection('B')
    const inverse = applyOperation(project, { op: 'addCollection', index: 0, collection: a })
    expect(inverse).toEqual({ op: 'removeCollection', collectionId: a.id })
    applyOperation(project, { op: 'addCollection', index: 1, collection: b })

    const restore = applyOperation(project, { op: 'removeCollection', collectionId: a.id })
    expect(project.collections.map(c => c.id)).toEqual([b.id])
    applyOperation(project, restore)
    expect(project.collections.map(c => c.id)).toEqual([a.id, b.id])
  })

  it('rejects a duplicate slug atomically', () => {
    const { project } = setup()
    const before = structuredClone(project)
    expect(() => applyOperations(project, [
      { op: 'addCollection', index: 1, collection: createCollection('Orders') },
      { op: 'addCollection', index: 2, collection: createCollection('Menu') }
    ])).toThrow('A collection with slug "menu" already exists')
    expect(project).toEqual(before)
  })

  it('updates name, slug and flags with an exact inverse', () => {
    const { project, menu } = setup()
    const before = structuredClone(project.collections[0])
    const inverse = applyOperation(project, { op: 'updateCollection', collectionId: menu.id, name: 'Drinks', slug: 'drinks', publicRead: true })
    expect(project.collections[0]).toMatchObject({ name: 'Drinks', slug: 'drinks', publicRead: true, publicCreate: false })
    applyOperation(project, inverse)
    expect(project.collections[0]).toEqual(before)
  })

  it('rejects renaming to a slug another collection uses', () => {
    const { project } = setup()
    const orders = createCollection('Orders')
    applyOperation(project, { op: 'addCollection', index: 1, collection: orders })
    expect(() => applyOperation(project, { op: 'updateCollection', collectionId: orders.id, slug: 'menu' })).toThrow(OperationError)
  })

  it('adds, updates and removes fields with exact inverses', () => {
    const { project, menu } = setup()
    const before = structuredClone(project.collections[0])

    const removeVegan = applyOperation(project, { op: 'addField', collectionId: menu.id, index: 1, field: { key: 'vegan', label: 'Vegan', type: 'boolean' } })
    expect(project.collections[0]!.fields.map(f => f.key)).toEqual(['name', 'vegan', 'price'])
    expect(removeVegan).toEqual({ op: 'removeField', collectionId: menu.id, key: 'vegan' })

    const retype = applyOperation(project, { op: 'updateField', collectionId: menu.id, key: 'price', label: 'Cost', type: 'text' })
    expect(project.collections[0]!.fields[2]).toEqual({ key: 'price', label: 'Cost', type: 'text' })
    applyOperation(project, retype)

    const readd = applyOperation(project, { op: 'removeField', collectionId: menu.id, key: 'name' })
    expect(readd).toEqual({ op: 'addField', collectionId: menu.id, index: 0, field: { key: 'name', label: 'Name', type: 'text' } })
    applyOperation(project, readd)
    applyOperation(project, removeVegan)
    expect(project.collections[0]).toEqual(before)
  })

  it('moves a field to a position with an exact inverse', () => {
    const { project, menu } = setup()
    applyOperation(project, { op: 'addField', collectionId: menu.id, index: 2, field: { key: 'vegan', label: 'Vegan', type: 'boolean' } })
    const before = structuredClone(project.collections[0])

    const back = applyOperation(project, { op: 'moveField', collectionId: menu.id, key: 'vegan', index: 0 })
    expect(project.collections[0]!.fields.map(f => f.key)).toEqual(['vegan', 'name', 'price'])
    expect(back).toEqual({ op: 'moveField', collectionId: menu.id, key: 'vegan', index: 2 })
    applyOperation(project, back)
    expect(project.collections[0]).toEqual(before)

    applyOperation(project, { op: 'moveField', collectionId: menu.id, key: 'name', index: 2 })
    expect(project.collections[0]!.fields.map(f => f.key)).toEqual(['price', 'vegan', 'name'])
  })

  it('rejects moving an unknown field or out of bounds', () => {
    const { project, menu } = setup()
    const move = (key: string, index: number) => () => applyOperation(project, { op: 'moveField', collectionId: menu.id, key, index })
    expect(move('nope', 0)).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(move('name', 2)).toThrow('Index 2 is out of bounds: "Menu" has 2 fields')
    expect(move('name', -1)).toThrow(expect.objectContaining({ code: 'invalid' }))
    expect(move('name', 0.5)).toThrow(expect.objectContaining({ code: 'invalid' }))
  })

  it('rejects a duplicate field key atomically', () => {
    const { project, menu } = setup()
    const before = structuredClone(project)
    expect(() => applyOperations(project, [
      { op: 'addField', collectionId: menu.id, index: 9, field: { key: 'photo', label: 'Photo', type: 'image' } },
      { op: 'addField', collectionId: menu.id, index: 9, field: { key: 'price', label: 'Price', type: 'number' } }
    ])).toThrow('Field "price" already exists in "Menu"')
    expect(project).toEqual(before)
  })

  it('rejects the reserved key id, malformed keys and unknown types', () => {
    const { project, menu } = setup()
    const add = (field: unknown) => () => applyOperation(project, { op: 'addField', collectionId: menu.id, index: 0, field: field as never })
    expect(add({ key: 'id', label: 'Id', type: 'text' })).toThrow(OperationError)
    expect(add({ key: 'Price', label: 'P', type: 'number' })).toThrow(OperationError)
    expect(add({ key: 'my-field', label: 'M', type: 'text' })).toThrow(OperationError)
    expect(add({ key: 'colour', label: 'Colour', type: 'color' })).toThrow(OperationError)
    expect(() => applyOperation(project, { op: 'updateField', collectionId: menu.id, key: 'price', type: 'money' as never })).toThrow(OperationError)
  })

  it('reports unknown collections and fields as not_found', () => {
    const { project, menu } = setup()
    expect(() => applyOperation(project, { op: 'removeCollection', collectionId: 'col_missing' })).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(() => applyOperation(project, { op: 'removeField', collectionId: menu.id, key: 'nope' })).toThrow(expect.objectContaining({ code: 'not_found' }))
  })
})

describe('fieldKey', () => {
  it('derives a camelCase key from a label, the inverse of fieldLabel', () => {
    expect(fieldKey('Served from')).toBe('servedFrom')
    expect(fieldKey('Price (€)')).toBe('price')
    expect(fieldKey('Café name')).toBe('cafeName')
    expect(fieldKey('2nd photo')).toBe('f2ndPhoto')
    expect(fieldKey('ID')).toBe('idField')
    expect(fieldKey('  ')).toBe('')
  })
})

describe('collection sources', () => {
  const API = { type: 'api' as const, url: 'https://rickandmortyapi.com/api/character', itemsPath: 'results' }
  const MAPPING = [
    { key: 'name', label: 'Name', type: 'text' as const, path: 'name' },
    { key: 'originName', label: 'Origin', type: 'text' as const, path: 'origin.name' }
  ]

  it('a new collection is internal', () => {
    expect(createCollection('Menu').source).toEqual({ type: 'internal' })
  })

  it('setSource replaces the source and fields together, with an exact inverse', () => {
    const { project, menu } = setup()
    const before = structuredClone(project.collections[0])
    const inverse = applyOperation(project, { op: 'setSource', collectionId: menu.id, source: API, fields: MAPPING })
    expect(project.collections[0]).toMatchObject({ source: API, fields: MAPPING })
    expect(inverse).toEqual({ op: 'setSource', collectionId: menu.id, source: { type: 'internal' }, fields: before!.fields })
    applyOperation(project, inverse)
    expect(project.collections[0]).toEqual(before)
  })

  it('rejects unsafe URLs, bad paths and duplicate keys in a source', () => {
    const { project, menu } = setup()
    const set = (source: unknown, fields: unknown = MAPPING) => () => applyOperation(project, { op: 'setSource', collectionId: menu.id, source: source as never, fields: fields as never })
    expect(set({ ...API, url: 'file:///etc/passwd' })).toThrow('Only http and https URLs can be fetched')
    expect(set({ ...API, url: 'https://a:b@example.com/' })).toThrow(OperationError)
    expect(set({ ...API, itemsPath: 'results..x' })).toThrow(OperationError)
    expect(set(API, [{ key: 'name', label: 'Name', type: 'text', path: 'origin name' }])).toThrow(OperationError)
    expect(set(API, [...MAPPING, MAPPING[0]])).toThrow('Field "name" already exists')
  })

  it('updateField changes an API field\'s path, with an exact inverse', () => {
    const { project, menu } = setup()
    applyOperation(project, { op: 'setSource', collectionId: menu.id, source: API, fields: MAPPING })
    const inverse = applyOperation(project, { op: 'updateField', collectionId: menu.id, key: 'originName', path: 'location.name' })
    expect(project.collections[0]!.fields[1]!.path).toBe('location.name')
    applyOperation(project, inverse)
    expect(project.collections[0]!.fields[1]!.path).toBe('origin.name')
    expect(() => applyOperation(project, { op: 'updateField', collectionId: menu.id, key: 'name', path: 'a b' })).toThrow(OperationError)
  })
})

describe('ProjectSchema collections', () => {
  it('a collection saved before sources existed parses as internal', () => {
    const { source: _source, ...legacy } = createCollection('Menu')
    const parsed = ProjectSchema.parse({ ...createProject('Legacy'), collections: [legacy] })
    expect(parsed.collections[0]!.source).toEqual({ type: 'internal' })
  })

  it('a project saved before collections existed parses with none', () => {
    const { collections: _collections, ...legacy } = createProject('Legacy')
    expect(ProjectSchema.parse(legacy).collections).toEqual([])
  })

  it('rejects duplicate collection slugs and field keys', () => {
    const project = createProject('Demo')
    const menu = createCollection('Menu', undefined, [{ key: 'name', label: 'Name', type: 'text' }])
    expect(ProjectSchema.safeParse({ ...project, collections: [menu, { ...createCollection('Menu') }] }).success).toBe(false)
    expect(ProjectSchema.safeParse({ ...project, collections: [{ ...menu, fields: [...menu.fields, ...menu.fields] }] }).success).toBe(false)
    expect(ProjectSchema.safeParse({ ...project, collections: [menu] }).success).toBe(true)
  })
})
