import { describe, expect, it } from 'vitest'
import { jsonErrorMessage } from '../../src/editor/jsonError.ts'

/** What the raw editor says of text that is not JSON: where, in the line and column a person counts from 1. */

const parseError = (text: string) => {
  try {
    JSON.parse(text)
  } catch (caught) {
    return caught
  }
  throw new Error('the text parses')
}

describe('the message for text that is not JSON', () => {
  it('names the line and the column of the first character that is wrong', () => {
    const text = '{\n  "id": 1,\n  "name" 2\n}'
    expect(jsonErrorMessage(text, parseError(text))).toMatch(/^Invalid JSON at line 3, column 10: /)
  })

  it('counts from the first line and column', () => {
    expect(jsonErrorMessage('oops', parseError('oops'))).toMatch(/^Invalid JSON at line 1, column 1: /)
  })

  it('puts text that ends too soon at its end', () => {
    expect(jsonErrorMessage('{\n  "id": ', parseError('{\n  "id": '))).toMatch(/^Invalid JSON at line 2, column 9: /)
  })

  it('uses the position the engine gives in its own words, whatever they are', () => {
    expect(jsonErrorMessage('a\nb', new SyntaxError('Unexpected token b in JSON at position 2'))).toBe('Invalid JSON at line 2, column 1: Unexpected token b')
    expect(jsonErrorMessage('a\nb', new SyntaxError('JSON.parse: unexpected character at line 2 column 1 of the JSON data'))).toBe('Invalid JSON at line 2, column 1: JSON.parse: unexpected character')
  })

  it('says only what it was told when the error gives no place', () => {
    // An error that is not about the text (it is fine as far as it goes) has no place in it.
    expect(jsonErrorMessage('[]', new Error('boom'))).toBe('Invalid JSON: boom')
    expect(jsonErrorMessage('[]', 'boom')).toBe('Invalid JSON: boom')
  })
})
