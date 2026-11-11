import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { CLIP_KIND, copyNode, parseClip, pasteStylePatch, pasteTarget, serializeClip } from '#shared/editor/clipboard'

function fixture() {
  const page = createPage('Home')
  const card = createNode('Card')
  const text = createNode('Text', { text: 'Hi' })
  text.style = { ...text.style, color: '#ff6600' }
  text.name = 'Greeting'
  text.locked = true
  card.children.push(text)
  const button = createNode('Button', { label: 'Go' })
  page.root.children.push(card, button)
  return { root: page.root, card, text, button }
}

describe('copyNode', () => {
  it('copies a node and its subtree without ids, names or locks', () => {
    const { root, card, text } = fixture()
    const clip = copyNode(root, card.id)!
    expect(clip.kind).toBe(CLIP_KIND)
    expect(clip.sourceId).toBe(card.id)
    expect(clip.node).toEqual({
      type: 'Card',
      props: card.props,
      style: card.style,
      children: [{ type: 'Text', props: text.props, style: text.style, children: [] }]
    })
    expect(JSON.stringify(clip.node)).not.toContain(text.id)
  })

  it('copies nothing for the root or a missing node', () => {
    const { root } = fixture()
    expect(copyNode(root, root.id)).toBeNull()
    expect(copyNode(root, 'missing')).toBeNull()
  })

  it('does not share objects with the document', () => {
    const { root, text } = fixture()
    const clip = copyNode(root, text.id)!
    clip.node.style.color = 'primary'
    expect(text.style.color).toBe('#ff6600')
  })
})

describe('serializeClip and parseClip', () => {
  it('round-trips a clip as JSON text', () => {
    const { root, card } = fixture()
    const clip = copyNode(root, card.id)!
    const text = serializeClip(clip)
    expect(JSON.parse(text).kind).toBe(CLIP_KIND)
    expect(parseClip(text)).toEqual(clip)
  })

  it('rejects text that is not a bildr clip', () => {
    expect(parseClip('hello')).toBeNull()
    expect(parseClip('{"kind":"other"}')).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceId: 'x', node: { type: 3, props: {}, style: {}, children: [] } }))).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceId: 'x', node: { type: 'Text', props: { a: {} }, style: {}, children: [] } }))).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceId: 'x', node: { type: 'Text', props: {}, style: { color: 1 }, children: [] } }))).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceId: 'x', node: { type: 'Card', props: {}, style: {}, children: [{ type: 'Text' }] } }))).toBeNull()
  })
})

describe('pasteTarget', () => {
  it('pastes right after the copied node while it is selected (never into itself)', () => {
    const { root, card } = fixture()
    const clip = copyNode(root, card.id)!
    expect(pasteTarget(root, card.id, clip)).toEqual({ parentId: root.id, index: 1 })
  })

  it('pastes into a selected container, after a selected leaf, or at the end of the root', () => {
    const { root, card, button } = fixture()
    const clip = copyNode(root, button.id)!
    expect(pasteTarget(root, card.id, clip)).toEqual({ parentId: card.id, index: 1 })
    const leafClip = copyNode(root, card.id)!
    expect(pasteTarget(root, button.id, leafClip)).toEqual({ parentId: root.id, index: 2 })
    expect(pasteTarget(root, null, clip)).toEqual({ parentId: root.id, index: 2 })
  })
})

describe('pasteStylePatch', () => {
  it('sets the copied tokens and removes the target tokens the copy does not have', () => {
    expect(pasteStylePatch({ p: '4', bg: 'primary' }, { bg: '#fff', rounded: 'lg' })).toEqual({ bg: '#fff', rounded: 'lg', p: null })
  })

  it('is empty when the styles already match', () => {
    expect(pasteStylePatch({ bg: 'primary' }, { bg: 'primary' })).toEqual({})
  })
})
