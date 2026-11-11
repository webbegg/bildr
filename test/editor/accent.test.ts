import { describe, expect, it } from 'vitest'
import { CONTEXT_ACCENT, SELECTION_ACCENT, selectionAccent } from '#shared/editor/accent'

describe('selectionAccent', () => {
  it('is the selection blue on a page', () => {
    expect(SELECTION_ACCENT).toBe('#09f')
    expect(selectionAccent(false, [])).toBe(SELECTION_ACCENT)
    expect(selectionAccent(false, ['Heading'])).toBe(SELECTION_ACCENT)
    expect(selectionAccent(false, ['Instance', 'Text'])).toBe(SELECTION_ACCENT)
  })

  it('is purple while editing a component or a layout', () => {
    expect(CONTEXT_ACCENT).toBe('#85f')
    expect(selectionAccent(true, [])).toBe(CONTEXT_ACCENT)
    expect(selectionAccent(true, ['Heading'])).toBe(CONTEXT_ACCENT)
  })

  it('is purple for a selection of instances on a page', () => {
    expect(selectionAccent(false, ['Instance'])).toBe(CONTEXT_ACCENT)
    expect(selectionAccent(false, ['Instance', 'Instance'])).toBe(CONTEXT_ACCENT)
  })
})
