// Field types S3 (verify B4): money and a percent are numbers wherever the editor turns typed text into a stored value or orders
// values, as a number field is; the SaaS text types (email, url, phone, color, select) stay text.
import { describe, expect, it } from 'vitest'
import { valueOfText } from '../../src/editor/queryDraft.ts'
import { defaultLiteral, literalOf, literalProblem } from '../../src/editor/stepExpr.ts'
import { cellValue } from '../../src/shared/dataGrid.ts'
import type { DataField } from '../../src/shared/dataModel.ts'
import { sortRows } from '../../src/shared/dataTable.ts'
import { fixedValue } from '../../src/shared/interactionConversion.ts'

const field = (type: DataField['type']): DataField => ({ id: `fld_${type}`, name: type, label: type, type, required: false })

describe('money and a percent are numbers in the editor (verify B4)', () => {
  it('saves a sample-data cell as a number', () => {
    expect(cellValue(field('money'), ' 9.99 ')).toBe(9.99)
    expect(cellValue(field('percent'), '25')).toBe(25)
    expect(cellValue(field('money'), '')).toBeNull()
    expect(cellValue(field('email'), ' ana@example.com ')).toBe('ana@example.com')
  })

  it('reads a query condition\'s value as a number', () => {
    expect(valueOfText('money', '10')).toEqual({ value: 10 })
    expect(valueOfText('percent', 'ten')).toEqual({ problem: 'a number' })
  })

  it('reads a fixed value of a step as a number', () => {
    expect(fixedValue('money', '10.5')).toEqual({ value: 10.5 })
    expect(fixedValue('percent', 'x')).toEqual({ problem: 'Use a number' })
  })

  it('types an action step\'s literal as a number, starting at 0', () => {
    expect(literalOf('money', '10')).toBe(10)
    expect(defaultLiteral('percent')).toBe(0)
    expect(literalProblem('money', 10)).toBeUndefined()
    expect(literalProblem('money', '10')).toBe('a number')
  })

  it('sorts money and a percent as numbers', () => {
    const rows = [1.5, 1.25, -3, 10, 2].map(money => ({ money }))
    expect(sortRows(rows, [field('money')], { key: 'money', direction: 'asc' }).map(row => row.money)).toEqual([-3, 1.25, 1.5, 2, 10])
  })
})
