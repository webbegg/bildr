import { describe, expect, it } from 'vitest'
import { canvasKeyMessage, isCanvasMessage } from '../src/protocol.ts'

describe('isCanvasMessage', () => {
  it('accepts bildr messages and ignores everything else', () => {
    expect(isCanvasMessage({ type: 'bildr:click', nodeId: 'n_1' })).toBe(true)
    expect(isCanvasMessage({ type: 'webpackOk' })).toBe(false)
    expect(isCanvasMessage('bildr:click')).toBe(false)
    expect(isCanvasMessage(null)).toBe(false)
  })
})

describe('canvasKeyMessage (RELIABILITY-006)', () => {
  it('carries alt and the physical code, so ⌘⌥V (key "√" on a Mac) reaches Paste style', () => {
    expect(canvasKeyMessage({ key: '√', code: 'KeyV', metaKey: true, ctrlKey: false, shiftKey: false, altKey: true }))
      .toEqual({ type: 'bildr:key', key: '√', code: 'KeyV', meta: true, shift: false, alt: true })
  })

  it('counts Ctrl as meta and reports alt off', () => {
    expect(canvasKeyMessage({ key: 'v', code: 'KeyV', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }))
      .toEqual({ type: 'bildr:key', key: 'v', code: 'KeyV', meta: true, shift: false, alt: false })
  })
})
