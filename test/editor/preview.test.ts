import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocNode } from '#shared/document/schema'
import type { PreviewState } from '#shared/editor/preview'
import { applyStylePreview, createStylePreview, createThrottle, PREVIEW_INTERVAL, previewTree, settlePreviews } from '#shared/editor/preview'

const node = (id: string, style: Record<string, string>, children: DocNode[] = []): DocNode => ({ id, type: 'Container', props: {}, style, children })

describe('style preview', () => {
  it('merges a patch over a style, and null values remove keys', () => {
    expect(applyStylePreview({ mt: '2', p: '4' }, { 'mt': '8', 'md:mt': '10' })).toEqual({ 'mt': '8', 'p': '4', 'md:mt': '10' })
    expect(applyStylePreview({ mt: '2', p: '4' }, { p: null, rounded: null })).toEqual({ mt: '2' })
  })

  it('leaves the style untouched without a patch', () => {
    const style = { mt: '2' }
    expect(applyStylePreview(style, undefined)).toBe(style)
    expect(style).toEqual({ mt: '2' })
  })

  it('renders previews over the tree, keeping untouched branches as they are', () => {
    const card = node('card', { p: '4' })
    const aside = node('aside', { p: '2' })
    const root = node('root', {}, [node('main', {}, [card]), aside])
    const shown = previewTree(root, { card: { p: '8', rounded: 'xl' } })
    expect(shown.children[0]!.children[0]!.style).toEqual({ p: '8', rounded: 'xl' })
    expect(shown.children[1]).toBe(aside)
    expect(root.children[0]!.children[0]).toBe(card)
    expect(card.style).toEqual({ p: '4' })
    expect(previewTree(root, {})).toBe(root)
  })

  it('drops a preview once a render already shows it, and keeps it until then', () => {
    const previews = { card: { 'mt': '8', 'md:mt': null }, hero: { bg: 'primary' } }
    // The committed render shows the card value; the hero is still being scrubbed.
    const committed = node('root', {}, [node('card', { mt: '8' }), node('hero', {})])
    expect(settlePreviews(previews, committed)).toEqual({ hero: { bg: 'primary' } })
    // A render from before the commit (e.g. an agent edit) keeps the preview, so the old value never shows.
    const stale = node('root', {}, [node('card', { 'mt': '2', 'md:mt': '4' }), node('hero', {})])
    expect(settlePreviews(previews, stale)).toEqual(previews)
  })

  it('drops previews of nodes the render no longer has', () => {
    expect(settlePreviews({ gone: { mt: '8' } }, node('root', {}))).toEqual({})
  })
})

describe('editor preview and commit', () => {
  it('previews and clears a gesture that ends without a commit', () => {
    const states: (PreviewState | null)[] = []
    const preview = createStylePreview(state => states.push(state))
    preview.preview('card', { mt: '8' })
    preview.preview('card', null)
    expect(states).toEqual([{ nodeId: 'card', style: { mt: '8' } }, null])
  })

  it('holds the committed value until the commit has reloaded, even when the control clears first or after', async () => {
    const states: (PreviewState | null)[] = []
    const preview = createStylePreview(state => states.push(state))
    let finish!: () => void
    const run = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    preview.preview('card', { mt: '6' })
    preview.preview('card', null)
    const done = preview.commit('card', { mt: '8' }, run)
    // A menu that closes after its pick clears too; the commit in flight keeps its value.
    preview.preview('card', null)
    expect(states.at(-1)).toEqual({ nodeId: 'card', style: { mt: '8' } })
    finish()
    await done
    expect(run).toHaveBeenCalledOnce()
    expect(states.at(-1)).toBeNull()
  })

  it('previews one patch on every selected node, naming the first as the node', () => {
    const states: (PreviewState | null)[] = []
    const preview = createStylePreview(state => states.push(state))
    preview.preview(['a', 'b'], { gap: '6' })
    preview.preview(['a'], { gap: '4' })
    expect(states).toEqual([{ nodeId: 'a', nodeIds: ['a', 'b'], style: { gap: '6' } }, { nodeId: 'a', style: { gap: '4' } }])
  })

  it('clears the preview when the commit fails, so the old value comes back', async () => {
    const states: (PreviewState | null)[] = []
    const preview = createStylePreview(state => states.push(state))
    await expect(preview.commit('card', { mt: '8' }, () => Promise.reject(new Error('422')))).rejects.toThrow('422')
    expect(states).toEqual([{ nodeId: 'card', style: { mt: '8' } }, null])
  })
})

describe('preview throttle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the first value at once, then the latest one per interval', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const throttle = createThrottle<string>(value => sent.push(value), PREVIEW_INTERVAL)
    expect(PREVIEW_INTERVAL).toBe(50)
    throttle.push('1')
    throttle.push('2')
    throttle.push('3')
    expect(sent).toEqual(['1'])
    vi.advanceTimersByTime(50)
    expect(sent).toEqual(['1', '3'])
    vi.advanceTimersByTime(50)
    expect(sent).toEqual(['1', '3'])
    throttle.push('4')
    expect(sent).toEqual(['1', '3', '4'])
  })

  it('flushes a value at once and drops the pending one, so a clear is never overtaken', () => {
    vi.useFakeTimers()
    const sent: (string | null)[] = []
    const throttle = createThrottle<string | null>(value => sent.push(value), PREVIEW_INTERVAL)
    throttle.push('1')
    throttle.push('2')
    throttle.flush(null)
    vi.advanceTimersByTime(200)
    expect(sent).toEqual(['1', null])
  })
})
