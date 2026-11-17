import { describe, expect, it } from 'vitest'
import { fixtureRowKey } from '@bildr/codegen/edit'
import type { Row } from '@bildr/codegen/query'
import { cellEditText, cellValue, moveCell } from '../../src/shared/dataGrid.ts'
import { rowId } from '../../src/shared/dataTable.ts'
import type { DataField } from '../../src/shared/dataModel.ts'

const field = (type: DataField['type'], extra: Partial<DataField> = {}): DataField => ({ id: `fld_${type}`, name: type, label: type, type, required: false, ...extra })
const size = { rows: 3, cols: 4 }

describe('moveCell', () => {
  it('moves one cell with the arrows and stops at the edges', () => {
    expect(moveCell({ row: 1, col: 1 }, 'right', size)).toEqual({ row: 1, col: 2 })
    expect(moveCell({ row: 1, col: 1 }, 'left', size)).toEqual({ row: 1, col: 0 })
    expect(moveCell({ row: 1, col: 1 }, 'down', size)).toEqual({ row: 2, col: 1 })
    expect(moveCell({ row: 1, col: 1 }, 'up', size)).toEqual({ row: 0, col: 1 })
    expect(moveCell({ row: 0, col: 0 }, 'up', size)).toEqual({ row: 0, col: 0 })
    expect(moveCell({ row: 0, col: 0 }, 'left', size)).toEqual({ row: 0, col: 0 })
    expect(moveCell({ row: 2, col: 3 }, 'down', size)).toEqual({ row: 2, col: 3 })
    expect(moveCell({ row: 2, col: 3 }, 'right', size)).toEqual({ row: 2, col: 3 })
  })

  it('goes to the next cell with Tab, wrapping to the next row, and leaves the grid at its last cell', () => {
    expect(moveCell({ row: 0, col: 1 }, 'next', size)).toEqual({ row: 0, col: 2 })
    expect(moveCell({ row: 0, col: 3 }, 'next', size)).toEqual({ row: 1, col: 0 })
    expect(moveCell({ row: 2, col: 3 }, 'next', size)).toBeNull()
  })

  it('goes back with Shift+Tab, wrapping to the row before, and leaves the grid at its first cell', () => {
    expect(moveCell({ row: 1, col: 2 }, 'previous', size)).toEqual({ row: 1, col: 1 })
    expect(moveCell({ row: 1, col: 0 }, 'previous', size)).toEqual({ row: 0, col: 3 })
    expect(moveCell({ row: 0, col: 0 }, 'previous', size)).toBeNull()
  })

  it('stays where it is in a grid with no cells', () => {
    expect(moveCell({ row: 0, col: 0 }, 'down', { rows: 0, cols: 0 })).toEqual({ row: 0, col: 0 })
    expect(moveCell({ row: 0, col: 0 }, 'next', { rows: 0, cols: 0 })).toBeNull()
  })
})

describe('cellValue: what typed text saves as', () => {
  it('keeps text as typed, and empties an optional text to null', () => {
    expect(cellValue(field('text'), 'Hello')).toBe('Hello')
    expect(cellValue(field('text'), '  spaced  ')).toBe('  spaced  ')
    expect(cellValue(field('text'), '')).toBeNull()
    expect(cellValue(field('text', { required: true }), '')).toBe('')
  })

  it('reads a number, and hands the module what is not one so it says so', () => {
    expect(cellValue(field('integer'), '42')).toBe(42)
    expect(cellValue(field('number'), ' 1.5 ')).toBe(1.5)
    expect(cellValue(field('number'), '-3')).toBe(-3)
    expect(cellValue(field('integer'), '')).toBeNull()
    expect(cellValue(field('integer'), 'abc')).toBe('abc')
    expect(cellValue(field('number'), '1,5')).toBe('1,5')
  })

  it('trims dates, date-times and uuids, and empties them to null', () => {
    expect(cellValue(field('date'), ' 2026-01-15 ')).toBe('2026-01-15')
    expect(cellValue(field('datetime'), '2026-01-15T09:30:00Z')).toBe('2026-01-15T09:30:00Z')
    expect(cellValue(field('uuid'), '')).toBeNull()
    expect(cellValue(field('date'), '  ')).toBeNull()
  })
})

describe('cellEditText: what a cell starts editing with', () => {
  it('is the stored value as text, and nothing for an empty one', () => {
    expect(cellEditText('Hello')).toBe('Hello')
    expect(cellEditText(12)).toBe('12')
    expect(cellEditText(null)).toBe('')
    expect(cellEditText(undefined)).toBe('')
    expect(cellEditText('2026-01-15T09:30:00Z')).toBe('2026-01-15T09:30:00Z')
  })
})

describe('row keys', () => {
  it('are the same in the table as in the module, so a row the table shows is the row the action finds', () => {
    const rows: Row[] = [{ id: 'a', n: 1 }, { n: 2 }, { id: 7 }, { id: null }]
    rows.forEach((row, index) => expect(rowId(row, index)).toBe(fixtureRowKey(row, index)))
  })
})
