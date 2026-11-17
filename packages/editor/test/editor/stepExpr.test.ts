import { describe, expect, it } from 'vitest'
import { defaultLiteral, exprOf, inputRoots, literalOf, varRoots } from '../../src/editor/stepExpr.ts'

/** The values the steps of an action take (S10, D10c): the expression model, the literals of each type and the names a value reads. */

describe('exprOf', () => {
  it('reads a stored value as what the picker shows', () => {
    const values: Array<[unknown, ReturnType<typeof exprOf>]> = [
      [{ $input: 'slug' }, { kind: 'input', path: 'slug' }],
      [{ $var: 'post.title' }, { kind: 'var', path: 'post.title' }],
      [{ $now: true }, { kind: 'now' }],
      [null, { kind: 'empty' }],
      ['hello', { kind: 'literal', value: 'hello' }],
      [3, { kind: 'literal', value: 3 }],
      [false, { kind: 'literal', value: false }],
      [undefined, { kind: 'none' }],
      [{ if: { $input: 'published' }, then: { $now: true }, else: null }, { kind: 'computed', value: { if: { $input: 'published' }, then: { $now: true }, else: null } }]
    ]
    for (const [value, expr] of values) {
      expect(exprOf(value)).toEqual(expr)
    }
  })

  it('keeps an expression the form does not know as it is', () => {
    expect(exprOf({ $param: 'limit' })).toEqual({ kind: 'computed', value: { $param: 'limit' } })
    expect(exprOf([1, 2])).toEqual({ kind: 'computed', value: [1, 2] })
  })
})

describe('literals typed by the field type', () => {
  it('turns the text of a number field into a number, and keeps what is not one as text for the problem to name', () => {
    expect(literalOf('integer', '12')).toBe(12)
    expect(literalOf('number', '1.5')).toBe(1.5)
    expect(literalOf('integer', '1.5')).toBe('1.5')
    expect(literalOf('integer', '')).toBe('')
    expect(literalOf('text', '12')).toBe('12')
    expect(literalOf(undefined, '12')).toBe('12')
    expect(literalOf('boolean', 'true')).toBe(true)
    expect(literalOf('boolean', 'false')).toBe(false)
  })

  it('starts a value of each type empty in its own way', () => {
    expect(defaultLiteral('integer')).toBe(0)
    expect(defaultLiteral('number')).toBe(0)
    expect(defaultLiteral('boolean')).toBe(false)
    expect(defaultLiteral('text')).toBe('')
    expect(defaultLiteral(undefined)).toBe('')
  })
})

describe('the roots a value reads', () => {
  it('lists the variables and the inputs a value tree mentions, by their first name', () => {
    const value = { if: { $var: 'post.published' }, then: { $input: 'slug' }, else: [{ $var: 'other' }, { $input: 'body.x' }] }
    expect(varRoots(value)).toEqual(['post', 'other'])
    expect(inputRoots(value)).toEqual(['slug', 'body'])
    expect(varRoots({ $var: 'undefined' })).toEqual(['undefined'])
    expect(varRoots('plain')).toEqual([])
  })
})
