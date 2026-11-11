import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { CLIP_KIND, copyNode, pasteInput } from '#shared/editor/clipboard'
import { canvasKeyMessage } from '#shared/editor/protocol'
import { canvasMovable } from '#shared/editor/selection'

function fixture() {
  const page = createPage('Home')
  const card = createNode('Card')
  const inner = createNode('Text')
  card.children.push(inner)
  const [a, b] = [createNode('Text'), createNode('Text')]
  page.root.children.push(card, a, b)
  return { root: page.root, card, inner, a, b }
}

describe('canvasMovable (RELIABILITY-007)', () => {
  it('keeps the unlocked top-level selection', () => {
    const { root, card, inner, a } = fixture()
    expect(canvasMovable(root, [card.id, inner.id, a.id])).toEqual([card.id, a.id])
  })

  it('leaves out locked nodes and nodes inside a lock', () => {
    const { root, card, inner, a, b } = fixture()
    a.locked = true
    expect(canvasMovable(root, [a.id, b.id])).toEqual([b.id])
    card.locked = true
    expect(canvasMovable(root, [inner.id])).toEqual([])
    expect(canvasMovable(root, [card.id])).toEqual([])
  })

  it('moves nothing under a locked root, and never the root itself', () => {
    const { root, a } = fixture()
    expect(canvasMovable(root, [root.id])).toEqual([])
    root.locked = true
    expect(canvasMovable(root, [a.id])).toEqual([])
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

describe('pasteInput (RELIABILITY-001)', () => {
  it('is the copied node as node_insert takes it, with exact: true', () => {
    const { root, card } = fixture()
    card.style = { items: 'start' }
    const clip = copyNode(root, card.id)!
    expect(clip.kind).toBe(CLIP_KIND)
    expect(pasteInput(clip)).toEqual({ ...clip.node, exact: true })
  })
})
