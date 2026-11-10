import { describe, expect, it } from 'vitest'
import { insertAt } from '#shared/env/insert'

describe('insertAt', () => {
  it('inserts at the caret and puts the caret after the insert', () => {
    expect(insertAt('Hello world', 6, 6, '{{ env.SHOP }} ')).toEqual({ text: 'Hello {{ env.SHOP }} world', caret: 21 })
  })

  it('replaces the selection', () => {
    expect(insertAt('Bearer TOKEN', 7, 12, '{{ env.KEY }}')).toEqual({ text: 'Bearer {{ env.KEY }}', caret: 20 })
  })

  it('accepts a backwards selection', () => {
    expect(insertAt('abcd', 3, 1, 'X')).toEqual({ text: 'aXd', caret: 2 })
  })

  it('clamps positions outside the text, appending when there is no caret', () => {
    expect(insertAt('', 0, 0, '{{ env.A }}')).toEqual({ text: '{{ env.A }}', caret: 11 })
    expect(insertAt('ab', 5, 9, 'X')).toEqual({ text: 'abX', caret: 3 })
    expect(insertAt('ab', -2, 1, 'X')).toEqual({ text: 'Xb', caret: 1 })
  })
})
