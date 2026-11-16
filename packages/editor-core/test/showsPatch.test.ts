import { describe, expect, it } from 'vitest'
import { showsPatch } from '../src/preview.ts'

describe('showsPatch', () => {
  it('is true once the style shows every value, and every null key is gone', () => {
    expect(showsPatch({ mt: '8' }, { 'mt': '8', 'md:mt': null })).toBe(true)
    expect(showsPatch({ mt: '8', p: '4' }, { mt: '8' })).toBe(true)
    expect(showsPatch({}, {})).toBe(true)
  })

  it('is false while a value differs, is missing, or a removed key is still there', () => {
    expect(showsPatch({ 'mt': '2', 'md:mt': '4' }, { 'mt': '8', 'md:mt': null })).toBe(false)
    expect(showsPatch({ 'mt': '8', 'md:mt': '4' }, { 'mt': '8', 'md:mt': null })).toBe(false)
    expect(showsPatch({}, { bg: 'primary' })).toBe(false)
  })
})
