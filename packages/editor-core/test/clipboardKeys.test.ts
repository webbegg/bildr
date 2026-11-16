import { describe, expect, it } from 'vitest'
import { editorTakesKey } from '../src/clipboardKeys.ts'

const key = (k: string, extra: { alt?: boolean, shift?: boolean, meta?: boolean, code?: string } = {}) => ({ key: k, code: extra.code ?? `Key${k.toUpperCase()}`, meta: extra.meta ?? true, shift: extra.shift ?? false, alt: extra.alt ?? false })
const at = (focus: 'canvas' | 'layers' | 'other', more: { textSelected?: boolean, hasSelection?: boolean } = {}) => ({ focus, textSelected: more.textSelected ?? false, hasSelection: more.hasSelection ?? true })

describe('editorTakesKey (RELIABILITY-005)', () => {
  it('takes Cmd/Ctrl+C, V and Alt+V from the canvas or the layers', () => {
    for (const focus of ['canvas', 'layers'] as const) {
      expect(editorTakesKey(key('c'), at(focus))).toBe(true)
      expect(editorTakesKey(key('v'), at(focus))).toBe(true)
      expect(editorTakesKey(key('√', { alt: true, code: 'KeyV' }), at(focus))).toBe(true)
    }
  })

  it('leaves them to the browser elsewhere, or with text selected', () => {
    expect(editorTakesKey(key('c'), at('other'))).toBe(false)
    expect(editorTakesKey(key('v'), at('other'))).toBe(false)
    expect(editorTakesKey(key('√', { alt: true, code: 'KeyV' }), at('other'))).toBe(false)
    expect(editorTakesKey(key('c'), at('canvas', { textSelected: true }))).toBe(false)
    expect(editorTakesKey(key('v'), at('layers', { textSelected: true }))).toBe(false)
  })

  it('leaves Copy to the browser with nothing selected; Paste still pastes at the root', () => {
    expect(editorTakesKey(key('c'), at('canvas', { hasSelection: false }))).toBe(false)
    expect(editorTakesKey(key('v'), at('canvas', { hasSelection: false }))).toBe(true)
  })
})

describe('editorTakesKey (RELIABILITY-013)', () => {
  it('takes Cmd/Ctrl+R and L only with something selected (reload and the address bar otherwise)', () => {
    expect(editorTakesKey(key('r'), at('canvas'))).toBe(true)
    expect(editorTakesKey(key('l'), at('canvas'))).toBe(true)
    expect(editorTakesKey(key('r'), at('canvas', { hasSelection: false }))).toBe(false)
    expect(editorTakesKey(key('l'), at('other', { hasSelection: false }))).toBe(false)
  })

  it('does not gate other keys', () => {
    expect(editorTakesKey(key('z'), at('other', { hasSelection: false, textSelected: true }))).toBe(true)
    expect(editorTakesKey(key('c', { meta: false }), at('other', { hasSelection: false }))).toBe(true)
    expect(editorTakesKey(key('c', { shift: true }), at('other'))).toBe(true)
  })
})
