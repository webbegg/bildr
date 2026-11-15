import { describe, expect, it } from 'vitest'
import { isInsertTool, pointerMode, selectionAccent, toolForKey, toolHint } from '../../src/editor/tools.ts'

/** The canvas tools (the hosted `insertTools` and `accent` tests, over the adapter's `tools.ts`). */

const key = (k: string, mods: { meta?: boolean, shift?: boolean, alt?: boolean, typing?: boolean } = {}) =>
  toolForKey({ key: k, meta: false, shift: false, ...mods })

describe('toolForKey', () => {
  it('maps Figma letters to tools, in either case', () => {
    expect(key('v')).toBe('move')
    expect(key('h')).toBe('hand')
    expect(key('f')).toBe('Container')
    expect(key('a')).toBe('Container')
    expect(key('t')).toBe('Text')
    expect(key('T')).toBe('Text')
    expect(key('b')).toBe('Button')
    expect(key('r')).toBe('Row')
    expect(key('c')).toBe('Column')
  })

  it('ignores other keys', () => {
    expect(key('x')).toBeNull()
    // `I` opens the Insert panel (Framer), so the Image tool has no letter.
    expect(key('i')).toBeNull()
    expect(key('Enter')).toBeNull()
    expect(key(' ')).toBeNull()
  })

  it('never fires with Cmd/Ctrl, Shift or Alt, or while typing', () => {
    expect(key('d', { meta: true })).toBeNull()
    expect(key('A', { shift: true })).toBeNull()
    expect(key('t', { alt: true })).toBeNull()
    expect(key('t', { typing: true })).toBeNull()
  })
})

describe('isInsertTool', () => {
  it('is true for the component tools, not for Move or Hand', () => {
    expect(isInsertTool('Text')).toBe(true)
    expect(isInsertTool('move')).toBe(false)
    expect(isInsertTool('hand')).toBe(false)
  })
})

describe('pointerMode', () => {
  it('pans with the Hand tool or while Space is held, whatever tool is armed', () => {
    expect(pointerMode('hand', false)).toBe('pan')
    expect(pointerMode('move', true)).toBe('pan')
    expect(pointerMode('Text', true)).toBe('pan')
  })

  it('inserts with a component tool, else selects', () => {
    expect(pointerMode('Text', false)).toBe('insert')
    expect(pointerMode('move', false)).toBe('select')
  })
})

describe('toolHint', () => {
  it('tells how to use an armed insert tool', () => {
    expect(toolHint('Text')).toBe('Text · click to insert · Esc')
    expect(toolHint('Container')).toBe('Frame · click to insert · Esc')
  })

  it('is null for Move and Hand', () => {
    expect(toolHint('move')).toBeNull()
    expect(toolHint('hand')).toBeNull()
  })
})

describe('selectionAccent', () => {
  it('is blue on pages, purple inside a component or a layout, and for a selection of instances', () => {
    expect(selectionAccent(false, ['Text'])).toBe('#09f')
    expect(selectionAccent(false, [])).toBe('#09f')
    expect(selectionAccent(true, ['Text'])).toBe('#85f')
    expect(selectionAccent(false, ['Instance', 'Instance'])).toBe('#85f')
    expect(selectionAccent(false, ['Instance', 'Text'])).toBe('#09f')
  })
})
