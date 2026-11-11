import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { CLIP_KIND, clipStyle, copyNode, copyNodes, newerClip, parseClip, pasteInput, pasteStylePatch, pasteTarget, readWithin, serializeClip } from '#shared/editor/clipboard'

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
    const clip = copyNode(root, card.id, 5)!
    expect(clip.kind).toBe(CLIP_KIND)
    expect(clip.sourceIds).toEqual([card.id])
    expect(clip.copiedAt).toBe(5)
    expect(clip.nodes).toEqual([{
      type: 'Card',
      props: card.props,
      style: card.style,
      children: [{ type: 'Text', props: text.props, style: text.style, children: [] }]
    }])
    expect(JSON.stringify(clip.nodes)).not.toContain(text.id)
  })

  it('copies nothing for the root or a missing node', () => {
    const { root } = fixture()
    expect(copyNode(root, root.id)).toBeNull()
    expect(copyNode(root, 'missing')).toBeNull()
  })

  it('does not share objects with the document', () => {
    const { root, text } = fixture()
    const clip = copyNode(root, text.id)!
    clip.nodes[0]!.style.color = 'primary'
    expect(text.style.color).toBe('#ff6600')
  })
})

describe('copyNodes (RELIABILITY-004)', () => {
  it('copies the top-level selection in document order, leaving out the root, missing nodes and nodes inside another copied one', () => {
    const { root, card, text, button } = fixture()
    const clip = copyNodes(root, [button.id, text.id, root.id, 'missing', card.id])!
    expect(clip.sourceIds).toEqual([card.id, button.id])
    expect(clip.nodes.map(n => n.type)).toEqual(['Card', 'Button'])
  })

  it('copies nothing when nothing copyable is selected', () => {
    const { root } = fixture()
    expect(copyNodes(root, [])).toBeNull()
    expect(copyNodes(root, [root.id, 'missing'])).toBeNull()
  })
})

describe('serializeClip and parseClip', () => {
  it('round-trips a clip as JSON text', () => {
    const { root, card, button } = fixture()
    const clip = copyNodes(root, [card.id, button.id], 42)!
    const text = serializeClip(clip)
    expect(JSON.parse(text).kind).toBe(CLIP_KIND)
    expect(parseClip(text)).toEqual(clip)
  })

  it('also writes the first node in the single-node format, for older editors', () => {
    const { root, card, button } = fixture()
    const clip = copyNodes(root, [card.id, button.id])!
    const data = JSON.parse(serializeClip(clip))
    expect(data.sourceId).toBe(card.id)
    expect(data.node).toEqual(clip.nodes[0])
  })

  it('still parses an old single-node clip, as never newer than a stamped one', () => {
    const { root, card } = fixture()
    const node = copyNode(root, card.id)!.nodes[0]!
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceId: card.id, node }))).toEqual({ kind: CLIP_KIND, sourceIds: [card.id], nodes: [node], copiedAt: 0 })
  })

  it('rejects text that is not a bildr clip', () => {
    expect(parseClip('hello')).toBeNull()
    expect(parseClip('{"kind":"other"}')).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceId: 'x', node: { type: 3, props: {}, style: {}, children: [] } }))).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceId: 'x', node: { type: 'Text', props: { a: {} }, style: {}, children: [] } }))).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceId: 'x', node: { type: 'Text', props: {}, style: { color: 1 }, children: [] } }))).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceId: 'x', node: { type: 'Card', props: {}, style: {}, children: [{ type: 'Text' }] } }))).toBeNull()
    const node = { type: 'Text', props: {}, style: {}, children: [] }
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceIds: ['x'], nodes: [], copiedAt: 1 }))).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceIds: ['x', 'y'], nodes: [node], copiedAt: 1 }))).toBeNull()
    expect(parseClip(JSON.stringify({ kind: CLIP_KIND, sourceIds: ['x'], nodes: [node], copiedAt: 'now' }))).toBeNull()
  })
})

describe('readWithin (T8-002)', () => {
  it('gives the text when the read settles in time', async () => {
    await expect(readWithin(Promise.resolve('x'), 50)).resolves.toBe('x')
  })
  it('gives null when the read never settles (an unanswered permission prompt)', async () => {
    await expect(readWithin(new Promise<string>(() => {}), 20)).resolves.toBeNull()
  })
  it('gives null when the read is refused', async () => {
    await expect(readWithin(Promise.reject(new Error('denied')), 50)).resolves.toBeNull()
  })
})

describe('newerClip (RELIABILITY-003)', () => {
  it('takes the system clip when it was copied after the in-memory one', () => {
    const { root, card, button } = fixture()
    const mine = copyNode(root, card.id, 100)!
    const other = copyNode(root, button.id, 200)!
    expect(newerClip(mine, other)).toBe(other)
    expect(newerClip(other, mine)).toBe(other)
  })

  it('keeps the in-memory clip when the system one is the same, older or missing', () => {
    const { root, card } = fixture()
    const mine = copyNode(root, card.id, 100)!
    expect(newerClip(mine, parseClip(serializeClip(mine)))).toBe(mine)
    expect(newerClip(mine, null)).toBe(mine)
    expect(newerClip(null, mine)).toBe(mine)
    expect(newerClip(null, null)).toBeNull()
  })
})

describe('pasteInput', () => {
  it('is the copied nodes as node_insert nodes, with exact: true', () => {
    const { root, card, button } = fixture()
    const clip = copyNodes(root, [card.id, button.id])!
    expect(pasteInput(clip)).toEqual({ nodes: clip.nodes, exact: true })
  })
})

describe('pasteTarget', () => {
  it('pastes right after the copied node while it is selected (never into itself)', () => {
    const { root, card, button } = fixture()
    const clip = copyNode(root, card.id)!
    expect(pasteTarget(root, card.id, clip)).toEqual({ parentId: root.id, index: 1 })
    const both = copyNodes(root, [card.id, button.id])!
    expect(pasteTarget(root, button.id, both)).toEqual({ parentId: root.id, index: 2 })
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

describe('clipStyle', () => {
  it('is the style of the first copied node', () => {
    const { root, card, text } = fixture()
    expect(clipStyle(copyNodes(root, [text.id, card.id])!)).toEqual(card.style)
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
