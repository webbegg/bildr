import { describe, expect, it } from 'vitest'
import { coerceValues, queryRecords, readRecord } from '#shared/data/records'
import type { DataRecord } from '#shared/data/records'
import type { Field } from '#shared/document/schema'

const fields: Field[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'price', label: 'Price', type: 'number' },
  { key: 'vegan', label: 'Vegan', type: 'boolean' },
  { key: 'servedFrom', label: 'Served from', type: 'date' },
  { key: 'photo', label: 'Photo', type: 'image' }
]

describe('coerceValues', () => {
  it('accepts values of each field type and coerces form strings', () => {
    expect(coerceValues(fields, {
      name: 'Flat white',
      price: '3.5',
      vegan: 'true',
      servedFrom: '2026-11-09',
      photo: 'https://example.com/flat-white.jpg'
    })).toEqual({ values: { name: 'Flat white', price: 3.5, vegan: true, servedFrom: '2026-11-09', photo: 'https://example.com/flat-white.jpg' } })
    expect(coerceValues(fields, { price: 4, vegan: false, servedFrom: '2026-11-09T08:30:00.000Z', photo: '/images/a.png' }))
      .toEqual({ values: { price: 4, vegan: false, servedFrom: '2026-11-09T08:30:00.000Z', photo: '/images/a.png' } })
  })

  it('null and an empty string clear a value (text keeps the empty string)', () => {
    expect(coerceValues(fields, { name: '', price: '', vegan: null, servedFrom: '', photo: null }))
      .toEqual({ values: { name: '', price: null, vegan: null, servedFrom: null, photo: null } })
  })

  it('rejects values that do not fit the field type', () => {
    expect(coerceValues(fields, { price: 'abc' })).toEqual({ problems: ['"price" must be a number'] })
    expect(coerceValues(fields, { vegan: 'yes', servedFrom: 'tomorrow', photo: 'javascript:alert(1)', name: 12 })).toEqual({
      problems: [
        '"vegan" must be true or false',
        '"servedFrom" must be a date (YYYY-MM-DD or an ISO date-time)',
        '"photo" must be an http(s) URL or a /path',
        '"name" must be a string'
      ]
    })
    expect(coerceValues(fields, { servedFrom: '2026-02-31' })).toEqual({ problems: ['"servedFrom" must be a date (YYYY-MM-DD or an ISO date-time)'] })
  })

  it('rejects unknown keys and the reserved id', () => {
    expect(coerceValues(fields, { colour: 'red', id: 'x' })).toEqual({ problems: ['Unknown field "colour"', 'Unknown field "id"'] })
  })
})

function record(id: string, values: DataRecord['values'], createdAt = `2026-11-09T10:00:0${id}.000Z`): DataRecord {
  return { id, createdAt, updatedAt: createdAt, values }
}

describe('readRecord', () => {
  it('returns every field, ignores unknown keys and reads invalid stored values as null', () => {
    const stored = record('1', { name: 'Tea', price: 'cheap', vegan: true, removed: 'gone' })
    expect(readRecord(fields, stored).values).toEqual({ name: 'Tea', price: null, vegan: true, servedFrom: null, photo: null })
  })

  it('reads a value that still fits after a type change, e.g. a numeric text', () => {
    const asNumber: Field[] = [{ key: 'name', label: 'Name', type: 'number' }]
    expect(readRecord(asNumber, record('1', { name: '12' })).values).toEqual({ name: 12 })
  })
})

describe('queryRecords', () => {
  const records = [
    record('1', { name: 'Latte', price: 3.2, vegan: false }),
    record('2', { name: 'Oat latte', price: 3.8, vegan: true }),
    record('3', { name: 'Espresso', price: 2, vegan: true }),
    record('4', { name: 'Scone', price: null, vegan: true })
  ].map(r => readRecord(fields, r))

  const ids = (result: { records: DataRecord[] }) => result.records.map(r => r.id)

  it('keeps creation order and reports the total by default', () => {
    const result = queryRecords(records, {})
    expect(ids(result)).toEqual(['1', '2', '3', '4'])
    expect(result.total).toBe(4)
  })

  it('filters by field equality', () => {
    expect(ids(queryRecords(records, { filter: { vegan: true } }))).toEqual(['2', '3', '4'])
    expect(ids(queryRecords(records, { filter: { vegan: true, price: 2 } }))).toEqual(['3'])
    expect(ids(queryRecords(records, { filter: { price: null } }))).toEqual(['4'])
  })

  it('sorts ascending or descending with empty values last', () => {
    expect(ids(queryRecords(records, { sort: { field: 'price', direction: 'asc' } }))).toEqual(['3', '1', '2', '4'])
    expect(ids(queryRecords(records, { sort: { field: 'price', direction: 'desc' } }))).toEqual(['2', '1', '3', '4'])
    expect(ids(queryRecords(records, { sort: { field: 'name', direction: 'asc' } }))).toEqual(['3', '1', '2', '4'])
    expect(ids(queryRecords(records, { sort: { field: 'createdAt', direction: 'desc' } }))).toEqual(['4', '3', '2', '1'])
  })

  it('pages with limit and offset after filtering and sorting', () => {
    const result = queryRecords(records, { filter: { vegan: true }, sort: { field: 'price', direction: 'asc' }, limit: 1, offset: 1 })
    expect(ids(result)).toEqual(['2'])
    expect(result.total).toBe(3)
  })
})
