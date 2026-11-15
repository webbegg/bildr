import { describe, expect, it, vi } from 'vitest'
import { byLabel, chooseDevice, fromCanvas, frames, menuItem, open, postCard, readyAll, select, sent, setupHarness, toggle, world } from './harness.ts'
import { click, settle } from '../helpers.ts'
import { DATA_REFRESH_DELAY_MS } from '../../src/design/store.ts'
import { thumbnailSignature, thumbnailSnapshots, thumbnailSource } from '../../src/shared/thumbnails.ts'

/**
 * The hosted canvas over the module (U6): `EditorCanvas` (a frame per device on a zoomed and
 * panned surface, or the variant board), `EditorFrameBar`, and what the frames report to it
 * (`bildr:*` messages from this origin and these windows only). The canvas iframe is a stub
 * window per frame; the tests answer as the canvas would.
 */

setupHarness()

const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
const POST_CARD = 'cmp_post_card'

/** The transform of the zoomed surface: `translate(x, y) scale(zoom)`. */
const surface = () => q('[data-canvas-content]')!.style.transform
/** The zoom label of the floating bar. */
const zoomLabel = () => byLabel('Zoom')?.textContent?.trim()
const keydown = async (init: KeyboardEventInit) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  await settle()
}

/** A stage of this size (jsdom has no layout): its ResizeObserver reports it when the canvas starts watching. */
const stageOf = (width: number, height: number) => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() {
      this.callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }

    unobserve() {}
    disconnect() {}
  })
}

describe('the device frames', () => {
  it('shows the Primary frame at its device\'s width, titled Canvas (the active one), with its header bar', async () => {
    await open()
    expect(qa('[data-frame]').map(frame => frame.dataset.frame)).toEqual(['mobile'])
    const frame = q('[data-frame="mobile"]')!
    expect(frame.style.width).toBe('390px')
    expect(frame.hasAttribute('data-active')).toBe(true)
    expect(frame.querySelector('iframe')?.title).toBe('Canvas')
    expect(frame.querySelector('[data-frame-label]')?.textContent).toContain('Mobile')
  })

  it('adds a frame from the bar\'s "+", the widest first; the edited one is titled Canvas and gets bildr:active, the other does not', async () => {
    await open()
    await chooseDevice('tablet')
    expect(qa('[data-frame]').map(frame => [frame.dataset.frame, frame.style.width])).toEqual([['tablet', '768px'], ['mobile', '390px']])
    expect(qa('iframe[data-device]').map(frame => frame.title)).toEqual(['Canvas', 'Canvas Mobile'])

    await readyAll()
    // Every frame gets the same render, selection and tool; the active flag is per frame (the Mobile frame is not).
    expect(sent('bildr:render').filter(message => message.file.id === 'pg_index').length).toBeGreaterThanOrEqual(2)
    const actives = sent('bildr:active').slice(-2).map(message => message.active).sort()
    expect(actives).toEqual([false, true])
  })

  it('edits a frame\'s device with a click on its bar, and hides a frame with its context menu\'s item (never the Primary)', async () => {
    await open()
    await chooseDevice('tablet')
    await click(q('[data-frame="mobile"] [data-frame-label]'))
    expect(q('[data-frame="mobile"]')?.hasAttribute('data-active')).toBe(true)
    expect(q('[data-frame="tablet"]')?.hasAttribute('data-active')).toBe(false)
  })

  it('previews the draft at the frame\'s width in a popup with the bar\'s ▶', async () => {
    const open_ = vi.spyOn(window, 'open').mockReturnValue(null)
    await open()
    await click(q('[data-frame="mobile"] [data-frame-preview]'))
    expect(open_).toHaveBeenCalledWith('/', 'bildr-preview-390', expect.stringContaining('width=390'))
    open_.mockRestore()
  })

  it('can show only the active frame from the zoom menu, remembered across reloads', async () => {
    await open()
    await chooseDevice('tablet')
    await menuItem(byLabel('Zoom'), 'Active frame only')
    expect(qa('[data-frame]').map(frame => frame.dataset.frame)).toEqual(['tablet'])
    expect(localStorage.getItem('bildr:canvas-frames')).toBe('single')
  })
})

describe('zoom and pan', () => {
  it('fits the frames in the stage until the user zooms or pans, and tells the frames and the floating bar the zoom', async () => {
    // Desktop and Mobile side by side: 1280 + 80 + 390 = 1750 px wide, 800 tall; the stage keeps 48 px + the 28 px bars around them.
    localStorage.setItem('bildr:frames', JSON.stringify(['desktop', 'mobile']))
    stageOf(1000, 800)
    await open()
    // min((1000 − 152) / 1750, (800 − 152) / 800) = 848 / 1750
    expect(zoomLabel()).toBe('48%')
    expect(surface()).toContain('scale(0.4845714')
    await readyAll()
    expect(sent('bildr:active').at(-1)?.zoom).toBeCloseTo(0.48457, 4)
  })

  it('zooms from the menu and the keys, and fits again', async () => {
    stageOf(1000, 800)
    await open()
    await menuItem(byLabel('Zoom'), 'Zoom to 200%')
    expect(zoomLabel()).toBe('200%')
    await keydown({ code: 'Digit0', key: ')', shiftKey: true })
    expect(zoomLabel()).toBe('100%')
    await keydown({ code: 'Equal', key: '=', metaKey: true })
    expect(zoomLabel()).toBe('150%')
    await keydown({ code: 'Digit1', key: '!', shiftKey: true })
    // The Mobile frame alone: min(848 / 390, 648 / 800) = 0.81
    expect(zoomLabel()).toBe('81%')
  })

  it('pans and zooms with the wheel a frame forwards, and with the pan messages', async () => {
    await open()
    expect(surface()).toBe('translate(0px, 0px) scale(1)')
    await fromCanvas({ type: 'bildr:wheel', dx: 0, dy: 40, zoom: false, x: 10, y: 10 })
    expect(surface()).toBe('translate(0px, -40px) scale(1)')
    await fromCanvas({ type: 'bildr:pan', dx: 15, dy: 5 })
    expect(surface()).toBe('translate(15px, -35px) scale(1)')
    // A pinch or Cmd + wheel of 100 px up doubles the zoom, around the pointer.
    await fromCanvas({ type: 'bildr:wheel', dx: 0, dy: -100, zoom: true, x: 0, y: 0 })
    expect(zoomLabel()).toBe('200%')
  })

  it('shows a grab layer over the frames while Space is held (Hand tool too), so the drag pans in the editor', async () => {
    await open()
    expect(q('[data-pan-layer]')).toBeNull()
    await fromCanvas({ type: 'bildr:space', down: true })
    expect(q('[data-pan-layer]')).not.toBeNull()
    await fromCanvas({ type: 'bildr:space', down: false })
    expect(q('[data-pan-layer]')).toBeNull()
    await click(byLabel('Hand tool'))
    expect(q('[data-pan-layer]')).not.toBeNull()
  })

  it('drops the pan layer when the window loses focus, so it cannot stay over the frames (Space held, or a pan in progress)', async () => {
    await open()
    await fromCanvas({ type: 'bildr:space', down: true })
    expect(q('[data-pan-layer]')).not.toBeNull()
    window.dispatchEvent(new Event('blur'))
    await settle()
    expect(q('[data-pan-layer]')).toBeNull()

    // A pan in progress (middle button): the blur ends it, and the drag no longer moves the surface.
    q('[data-canvas-stage]')!.dispatchEvent(new PointerEvent('pointerdown', { button: 1, pointerId: 1, clientX: 0, clientY: 0, bubbles: true, cancelable: true }))
    await settle()
    expect(q('[data-pan-layer]')).not.toBeNull()
    window.dispatchEvent(new Event('blur'))
    await settle()
    expect(q('[data-pan-layer]')).toBeNull()
    q('[data-canvas-stage]')!.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 30, clientY: 30, bubbles: true }))
    await settle()
    expect(surface()).toBe('translate(0px, 0px) scale(1)')
  })

  it('ends a pan when the pointer capture is lost (the stage is gone, or the browser took it)', async () => {
    await open()
    const stage = q('[data-canvas-stage]')!
    stage.dispatchEvent(new PointerEvent('pointerdown', { button: 1, pointerId: 1, clientX: 0, clientY: 0, bubbles: true, cancelable: true }))
    await settle()
    expect(q('[data-pan-layer]')).not.toBeNull()
    stage.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }))
    await settle()
    expect(q('[data-pan-layer]')).toBeNull()
  })

  it('zooms to the selection from the frame\'s measured box', async () => {
    stageOf(1000, 800)
    await open()
    await select('n_h1')
    const pending = menuItem(byLabel('Zoom'), 'Zoom to selection')
    await settle()
    const measure = sent('bildr:measure').at(-1)!
    expect(measure.nodeIds).toEqual(['n_h1'])
    await fromCanvas({ type: 'bildr:rects', requestId: measure.requestId, rects: [{ id: 'n_h1', x: 20, y: 40, width: 200, height: 40 }] })
    await pending
    // 200 × 40 in a 848 × 648 room: width-bound, 848 / 200 = 4.24, clamped to 400%.
    expect(zoomLabel()).toBe('400%')
  })
})

describe('what the frames report', () => {
  it('forwards a key the frame could not use to the editor\'s shortcuts, with the selection, hover and insert slot', async () => {
    const { actions } = await open({ node_delete: ok(), node_insert: ok({ nodeId: 'n_text_1' }) })
    await select('n_h1')
    await fromCanvas({ type: 'bildr:hover', nodeId: 'n_head' })
    expect(sent('bildr:hover').at(-1)).toEqual({ type: 'bildr:hover', nodeId: 'n_head' })

    await fromCanvas({ type: 'bildr:key', key: 'Delete', code: 'Delete', meta: false, shift: false, alt: false })
    expect(actions.named('node_delete').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1' }])

    // A letter arms the tool, which the frames are told; a click then reports its slot.
    await fromCanvas({ type: 'bildr:key', key: 't', code: 'KeyT', meta: false, shift: false, alt: false })
    expect(sent('bildr:tool').at(-1)).toEqual({ type: 'bildr:tool', tool: 'Text' })
    await fromCanvas({ type: 'bildr:insert', parentId: 'n_head', index: 1 })
    expect(actions.named('node_insert').map(call => call.input)).toEqual([{ file: 'pg_index', parentId: 'n_head', index: 1, type: 'Text' }])
  })

  it('a right-click in a frame selects the node and opens the node menu where the frame says', async () => {
    await open()
    await fromCanvas({ type: 'bildr:contextmenu', nodeId: 'n_h1', x: 30, y: 40 })
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeIds: ['n_h1'] })
    expect(qa('[role^="menuitem"]').map(item => item.textContent?.trim()).some(text => text?.startsWith('Duplicate'))).toBe(true)
  })

  it('hears only a frame of its own, from its own origin: anything else changes nothing', async () => {
    const { actions } = await open({ node_insert: ok() })
    const drop = { type: 'bildr:drop' as const, parentId: 'n_page', index: 0, payload: JSON.stringify({ kind: 'component', type: 'Text' }) }
    // Another origin (a page that framed or opened the editor), the editor's own window, and a window that is no frame.
    await fromCanvas(drop, 'https://evil.test')
    window.dispatchEvent(new MessageEvent('message', { data: drop, source: window, origin: window.location.origin }))
    window.dispatchEvent(new MessageEvent('message', { data: drop, source: { postMessage: () => {} } as unknown as Window, origin: window.location.origin }))
    await settle()
    expect(actions.named('node_insert')).toEqual([])

    await fromCanvas(drop)
    expect(actions.named('node_insert')).toHaveLength(1)
  })

  it('sends a frame only structured-cloneable messages to its own origin', async () => {
    await open()
    const target = frames()[0]!
    const spy = vi.spyOn(target.contentWindow!, 'postMessage')
    await fromCanvas({ type: 'bildr:ready' })
    expect(spy).toHaveBeenCalled()
    for (const call of spy.mock.calls) expect(call[1]).toBe(window.location.origin)
  })

  it('reads the app\'s rows again after a runAction a frame reports from the preview (and after nothing else)', async () => {
    const rows = { items: [{ id: 'id-one', title: 'Post one', slug: 'one', body: '', published: true, publishedAt: '2026-11-10T09:00:00.000Z', createdAt: '2026-11-10T09:00:00.000Z', updatedAt: '2026-11-10T09:00:00.000Z' }], total: 1 }
    const { actions } = await open({}, 'pg_index', { '/api/blog/posts': rows, '/api/blog/quotes': { items: [], total: 0 } })
    const reads = () => actions.appCalls.length
    const wait = () => new Promise(resolve => setTimeout(resolve, DATA_REFRESH_DELAY_MS + 150))
    const initial = reads()
    expect(initial).toBeGreaterThan(0)

    await fromCanvas({ type: 'bildr:interaction', nodeId: 'n_any', on: 'click', step: { kind: 'navigate', to: '/' } })
    await wait()
    expect(reads()).toBe(initial)

    await fromCanvas({ type: 'bildr:interaction', nodeId: 'n_any', on: 'submit', step: { kind: 'runAction', action: 'act_create_post' } })
    await wait()
    expect(reads()).toBeGreaterThan(initial)
  })

  it('resets a drag when a frame reloads: the abandoned preview is dropped, not shown again to the reloaded frame', async () => {
    await open()
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { w: '64' } })
    await settle()
    world.posted = []
    await fromCanvas({ type: 'bildr:ready' })
    expect(sent('bildr:preview').filter(message => message.style)).toEqual([])
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await settle()
    // The drag ended with the reload: Esc is the usual one.
    expect(sent('bildr:cancel-drag')).toEqual([])
  })
})

describe('the layout view', () => {
  it('draws the children slot\'s placeholder over its box as the frame measured it', async () => {
    await open({}, 'lay_main')
    await new Promise(resolve => setTimeout(resolve, 150))
    const measure = sent('bildr:measure').at(-1)!
    expect(measure.nodeIds).toEqual(['n_main'])
    await fromCanvas({ type: 'bildr:rects', requestId: measure.requestId, rects: [{ id: 'n_main', x: 10, y: 60, width: 300, height: 200 }] })
    const placeholder = q('[data-layout-placeholder]')!
    expect(placeholder.textContent).toContain('Page content — your page appears here')
    expect([placeholder.style.left, placeholder.style.top, placeholder.style.width, placeholder.style.height]).toEqual(['10px', '60px', '300px', '200px'])
  })
})

describe('the variant board', () => {
  const chips = () => qa('[data-board-label]').map(chip => chip.textContent?.trim())

  it('replaces the device frames with one frame per variant at the active width, a state under its base, and the "+ Variant" and state tiles', async () => {
    await open({}, POST_CARD)
    expect(qa('[data-frame]')).toEqual([])
    expect(chips()).toEqual(['Primary', 'hovered', 'compact'])
    // Columns 390 + 80 apart; the hovered state sits under the Primary, a purple line joining them.
    const frame = (key: string) => q(`[data-board-frame="${key}"]`)!
    expect([frame('primary'), frame('var_compact')].map(element => [element.style.left, element.style.top, element.style.width])).toEqual([['0px', '0px', '390px'], ['470px', '0px', '390px']])
    expect(frame('var_hovered').style.left).toBe('0px')
    expect(frame('var_hovered').style.top).toBe('880px')
    expect(q('[data-board-link="primary"]')).not.toBeNull()
    expect(q('[data-board-add]')?.style.left).toBe('940px')
    // The Primary has a hover state and lacks a pressed one; compact has neither.
    expect(qa('[data-board-state-add]').map(tile => tile.dataset.boardStateAdd)).toEqual(['primary', 'var_compact'])
  })

  it('adds a variant from the "+ Variant" tile, and a state from the state tile\'s menu (the kind the base lacks)', async () => {
    const { actions } = await open({ component_variant_add: ok({ variantId: 'var_x' }), component_state_add: ok({ variantId: 'var_y' }) }, POST_CARD)
    await click(q('[data-board-add]'))
    expect(actions.named('component_variant_add').map(call => call.input)).toEqual([{ component: POST_CARD, name: 'Variant 3' }])

    await menuItem(q('[data-board-state-add="primary"]'), 'Pressed')
    expect(actions.named('component_state_add').map(call => call.input)).toEqual([{ component: POST_CARD, baseVariant: '', kind: 'pressed' }])
  })

  it('makes a frame\'s variant the active one before a click in it selects, so the selection edits that variant', async () => {
    await open({}, POST_CARD)
    await readyAll()
    const compact = frames().find(frame => frame.dataset.boardVariant === 'var_compact')!
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_card', shift: false, meta: false, variantId: 'var_compact' }, undefined, compact)
    expect(q('[data-board-bar][data-active] [data-board-label]')?.textContent?.trim()).toBe('compact')
    // Only the active variant's frame shows the selection: of the last select to each of the three frames, one has it.
    expect(sent('bildr:select').slice(-3).map(message => message.nodeIds)).toEqual(expect.arrayContaining([['n_card'], [], []]))
    expect(sent('bildr:select').slice(-3).filter(message => message.nodeIds.length)).toHaveLength(1)
  })

  it('draws the interactions as arrows between the frames; a click on an arrow\'s event selects it, and Delete removes it', async () => {
    postCard().variants[0]!.interactions = [{ on: 'click', do: [{ kind: 'setVariant', to: '' }] }]
    const { actions } = await open({ component_interaction_remove: ok() }, POST_CARD)
    expect(qa('[data-interaction-arrow]').map(arrow => arrow.dataset.interactionArrow)).toEqual(['var_compact:0'])
    expect(q('[data-interaction-label="var_compact:0"]')?.textContent?.trim()).toBe('Click')

    await click(q('[data-interaction-label="var_compact:0"]'))
    expect(q('[data-interaction-arrow="var_compact:0"]')?.hasAttribute('data-selected')).toBe(true)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }))
    await settle()
    expect(actions.named('component_interaction_remove').map(call => call.input)).toEqual([{ component: POST_CARD, variant: 'var_compact', index: 0 }])
  })

  it('adds a click interaction by dragging a frame\'s ⚡ handle onto another variant', async () => {
    const { actions } = await open({ component_interaction_add: ok({ index: 0 }) }, POST_CARD)
    const handle = q('[data-board-handle="primary"]')!
    handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true, cancelable: true }))
    await settle()
    expect(q('[data-board-linking]')).not.toBeNull()
    // The compact frame is at x 470–860 in the board.
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 100, pointerId: 1, bubbles: true }))
    await settle()
    // The line follows the pointer, and the frame it would land on is outlined, set off from its edge (the active one is not).
    expect(q('[data-board-linking]')?.getAttribute('x2')).toBe('500')
    expect(q('iframe[data-board-variant="var_compact"]')?.style.outlineOffset).toBe('4px')
    expect(q('iframe[data-board-variant="primary"]')?.style.outlineOffset).toBe('')
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 100, pointerId: 1, bubbles: true }))
    await settle()
    expect(actions.named('component_interaction_add').map(call => call.input)).toEqual([{ component: POST_CARD, on: 'click', to: 'var_compact' }])
    expect(q('[data-board-linking]')).toBeNull()
  })

  it('goes back to the device frames with the Board switch off, and each variant renders its own variant', async () => {
    await open({}, POST_CARD)
    await readyAll()
    const rendered = world.posted.flatMap(message => message.type === 'bildr:render' && message.file.id === POST_CARD ? [message.variant?.id] : [])
    expect(new Set(rendered)).toEqual(new Set([null, 'var_hovered', 'var_compact']))
    await toggle('[data-variant-board-toggle]')
    expect(qa('[data-frame]').map(frame => frame.dataset.frame)).toEqual(['mobile'])
  })
})

describe('the Insert panel\'s thumbnails', () => {
  const tile = (id: string) => q(`[data-palette-component="${id}"] [data-insert-thumb]`)
  /** The hidden canvas that renders a tile's thumbnail, while it renders. */
  const liveFrame = (id: string) => tile(id)?.querySelector<HTMLIFrameElement>('iframe')

  /** Opens the Insert panel with its tiles in view (happy-dom has no layout to scroll them into). */
  const openInsert = async () => {
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe() {
        this.callback([{ isIntersecting: true }] as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
      }

      unobserve() {}
      disconnect() {}
    })
    await open()
    await click(q('[data-insert-button]'))
  }
  const BOX = { id: 'x', x: 0, y: 0, width: 300, height: 120 }
  /** The live frame says it loaded, and later where its render is. */
  const rendered = async (id: string) => {
    await fromCanvas({ type: 'bildr:ready' }, undefined, liveFrame(id)!)
    await fromCanvas({ type: 'bildr:rects', requestId: 1, rects: [BOX] }, undefined, liveFrame(id)!)
  }

  it('shows a finished thumbnail as a static document in a sandboxed frame that cannot run scripts', async () => {
    await openInsert()
    expect(tile(POST_CARD)?.dataset.insertThumb).toBe('loading')
    await rendered(POST_CARD)
    expect(tile(POST_CARD)?.dataset.insertThumb).toBe('ready')
    const shown = tile(POST_CARD)!.querySelector('iframe')!
    expect(shown.hasAttribute('srcdoc')).toBe(true)
    expect(shown.hasAttribute('sandbox')).toBe(true)
    expect(shown.getAttribute('sandbox')).not.toContain('allow-scripts')
  })

  it('stores a snapshot under the signature of what the frame rendered, even when the preview changed just before it loaded', async () => {
    const card = POST_CARD
    // The cache outlives a test: a theme of its own keeps this tile from finding the snapshot the last one left.
    world.model.theme = { ...world.model.theme!, radius: world.model.theme!.radius === '0.125rem' ? '0.5rem' : '0.125rem' }
    await openInsert()
    const frame = liveFrame(card)!
    const signatures = () => {
      const source = thumbnailSource(world.model, 'component', card)!
      return { light: thumbnailSignature(source, world.model.theme!, false), dark: thumbnailSignature(source, world.model.theme!, true) }
    }
    const { light, dark } = signatures()
    // In one task: the preview turns dark, the frame loads (and is told dark), and its render is measured. The tile that
    // renders on is the dark one, and it has the dark snapshot, not a stale one filed under the light signature.
    q('[data-preview-theme]')!.click()
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'bildr:ready' }, source: frame.contentWindow, origin: window.location.origin }))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'bildr:rects', requestId: 1, rects: [BOX] }, source: frame.contentWindow, origin: window.location.origin }))
    await settle()
    expect(thumbnailSnapshots.get(light)).toBeUndefined()
    expect(thumbnailSnapshots.get(dark)).toBeDefined()
    expect(tile(card)?.dataset.insertThumb).toBe('ready')
    expect(sent('bildr:dark').at(-1)).toEqual({ type: 'bildr:dark', dark: true })
  })
})
