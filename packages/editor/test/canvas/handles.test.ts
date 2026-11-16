import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import ui from '@nuxt/ui/vue-plugin'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import CanvasApp from '../../src/canvas/CanvasApp.vue'
import type { CanvasToEditor, EditorToCanvas } from '../../src/canvas/protocol.ts'
import { createCanvasRouter } from '../../src/canvas/router.ts'
import { blogModelFiles } from './fixture.ts'

/**
 * Direct manipulation in the canvas (P4c, hosted #23): the resize handles of
 * a single selected node and the padding and gap handles of its spacing
 * overlays. A drag snaps to the token scale and previews live
 * (`bildr:style-preview`); the release commits once (`bildr:style-commit`);
 * Esc cancels. happy-dom has no layout, so the boxes are stubbed.
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const fixture = loaded.model
const blog = fixture.modules.blog!
const index = blog.pages.find(page => page.name === 'index')!

let posted: CanvasToEditor[] = []
let wrapper: VueWrapper | undefined

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
const send = async (message: EditorToCanvas) => {
  window.dispatchEvent(new MessageEvent('message', { data: message, source: window.parent, origin: window.location.origin }))
  await settle()
}
const sent = <T extends CanvasToEditor['type']>(type: T) => posted.filter((message): message is Extract<CanvasToEditor, { type: T }> => message.type === type)
const node = (id: string) => document.querySelector<HTMLElement>(`[data-node="${id}"]:not([data-copy])`)!
const handle = (id: string) => document.querySelector<HTMLElement>(`[data-resize-handle="${id}"]`)

const render = (): EditorToCanvas => ({
  type: 'bildr:render',
  file: index,
  components: blog.components,
  layouts: fixture.layouts,
  theme: fixture.theme!,
  breakpointBase: 'mobile',
  data: { site: { name: 'Blog' }, preferences: { showDrafts: false }, featured: [], quotes: [] },
  view: 'page'
})

/** The heading's box: 200 × 40 at (20, 40), so its east handle is at (220, 60). */
const BOX = { left: 20, top: 40, width: 200, height: 40 }
const rect = (box: typeof BOX | null) => ({ ...(box ?? { left: 0, top: 0, width: 0, height: 0 }), x: box?.left ?? 0, y: box?.top ?? 0, right: (box?.left ?? 0) + (box?.width ?? 0), bottom: (box?.top ?? 0) + (box?.height ?? 0), toJSON: () => ({}) })

const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}) =>
  new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...init })
const press = async (x: number, y: number) => {
  document.dispatchEvent(pointer('pointerdown', x, y))
  await settle()
}
const move = async (x: number, y: number, init: PointerEventInit = {}) => {
  window.dispatchEvent(pointer('pointermove', x, y, init))
  await settle()
}
const release = async (x: number, y: number) => {
  window.dispatchEvent(pointer('pointerup', x, y))
  await settle()
}
const select = (...ids: string[]) => send({ type: 'bildr:select', nodeId: ids.at(-1) ?? null, nodeIds: ids })

beforeEach(async () => {
  posted = []
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
  vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as CanvasToEditor)
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rect(this.getAttribute('data-node') === 'n_h1' ? BOX : null) as DOMRect
  })
  wrapper = mount(CanvasApp, { attachTo: document.body, global: { plugins: [createCanvasRouter(), ui] } })
  await settle()
  await send(render())
})

afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('resize handles', () => {
  it('show eight around a single selected node, at its corners and edge middles', async () => {
    await select('n_h1')
    expect(document.querySelectorAll('[data-resize-handle]')).toHaveLength(8)
    // 7 px dots at screen size, centred on the points of the box (zoom 1).
    expect(handle('e')!.style.left).toBe('216.5px')
    expect(handle('e')!.style.top).toBe('56.5px')
    expect(handle('nw')!.style.left).toBe('16.5px')
  })

  it('are not drawn for the root, several nodes, preview mode or a frame that is not the active one', async () => {
    await select('n_page')
    expect(handle('e')).toBeNull()
    await select('n_h1', 'n_head')
    expect(handle('e')).toBeNull()
    await select('n_h1')
    expect(handle('e')).not.toBeNull()
    await send({ type: 'bildr:active', active: false, zoom: 1, viewportHeight: 800 })
    expect(handle('e')).toBeNull()
    await send({ type: 'bildr:active', active: true, zoom: 1, viewportHeight: 800 })
    await send({ type: 'bildr:mode', mode: 'preview' })
    expect(handle('e')).toBeNull()
  })

  it('dragging the east handle previews a snapped width live, and the release commits it once', async () => {
    await select('n_h1')
    await press(220, 60)
    await move(280, 60)

    expect(sent('bildr:style-preview').at(-1)).toEqual({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { w: '64' } })
    expect(node('n_h1').className).toContain('w-64')
    expect(document.querySelector('[data-drag-label]')?.textContent).toContain('w-64')
    expect(sent('bildr:style-commit')).toEqual([])

    await release(280, 60)
    expect(sent('bildr:style-commit')).toEqual([{ type: 'bildr:style-commit', nodeId: 'n_h1', style: { w: '64' } }])
    expect(document.querySelector('[data-drag-label]')).toBeNull()
  })

  it('a drag writes the breakpoint key of the width it is on', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    await send({ type: 'bildr:active', active: true, zoom: 1, viewportHeight: 800 })
    await select('n_h1')
    await press(120, 80)
    await move(120, 120)
    await release(120, 120)
    // 40 px high + 40 px down = 80 px = 20 units.
    expect(sent('bildr:style-commit').at(-1)).toMatchObject({ nodeId: 'n_h1', style: { 'md:h': '20' } })
  })

  // U8 (breakpoints-p2): a handle drag starts on any frame, whatever its breakpoint; what decides it is where the press lands.
  it.each([[800, 'md:w'], [700, 'sm:w']])('a drag on the handle of a %ipx frame (not the Primary) starts and writes %s', async (width, key) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    await send({ type: 'bildr:active', active: true, zoom: 1, viewportHeight: 800 })
    await select('n_h1')
    await press(220, 60)
    await move(160, 60)
    expect(document.querySelector('[data-drag-label]')).not.toBeNull()
    await release(160, 60)
    expect(sent('bildr:style-commit').at(-1)).toMatchObject({ nodeId: 'n_h1', style: { [key]: expect.any(String) } })
  })

  it('zoomed far out (fit-all) the drawn handle dot is always pressable, and deeper inside the box the press drags the node, on every frame', async () => {
    // At zoom 0.14 the 7 px dot is 25 canvas px across each side of the handle. Inside a 200 × 40 box a quarter of the
    // smaller side (10) would make the dot unpressable; the hit zone is never smaller than the dot (hitRadius floor).
    for (const width of [400, 800, 700]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      await send({ type: 'bildr:active', active: true, zoom: 0.14, viewportHeight: 800 })
      await select('n_h1')
      await press(206, 60)
      await move(150, 60)
      expect(document.querySelector('[data-drag-label]'), `${width}px, 14 px inside the handle (on the dot)`).not.toBeNull()
      await release(150, 60)
      await press(180, 60)
      await move(150, 60)
      expect(document.querySelector('[data-drag-label]'), `${width}px, 40 px inside the handle (past the dot)`).toBeNull()
      await release(150, 60)
    }
  })

  it('Esc cancels the drag: the preview is dropped and nothing is committed; the click that ends it selects nothing', async () => {
    await select('n_h1')
    await press(220, 60)
    await move(280, 60)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    await settle()
    expect(sent('bildr:style-preview').at(-1)).toEqual({ type: 'bildr:style-preview', nodeId: 'n_h1', style: null })
    expect(node('n_h1').className).not.toContain('w-64')
    await release(280, 60)
    expect(sent('bildr:style-commit')).toEqual([])
    expect(sent('bildr:key')).toEqual([])
  })

  it('the editor\'s cancel-drag message (Esc went to the editor, the canvas has no focus) cancels the drag the same way', async () => {
    await select('n_h1')
    await press(220, 60)
    await move(280, 60)
    await send({ type: 'bildr:cancel-drag' })
    expect(sent('bildr:style-preview').at(-1)).toEqual({ type: 'bildr:style-preview', nodeId: 'n_h1', style: null })
    expect(node('n_h1').className).not.toContain('w-64')
    await release(280, 60)
    expect(sent('bildr:style-commit')).toEqual([])
  })

  it('a press on the handle that never moves is not a drag: nothing is previewed or committed', async () => {
    await select('n_h1')
    await press(220, 60)
    await release(220, 60)
    expect(sent('bildr:style-preview')).toEqual([])
    expect(sent('bildr:style-commit')).toEqual([])
  })

  it('a move with the button up (released outside the frame) ends the drag without a commit', async () => {
    await select('n_h1')
    await press(220, 60)
    await move(280, 60)
    await move(300, 60, { buttons: 0 })
    await release(300, 60)
    expect(sent('bildr:style-commit')).toEqual([])
    expect(sent('bildr:style-preview').at(-1)?.style).toBeNull()
  })

  it('the click that follows a drag selects nothing', async () => {
    await select('n_h1')
    await press(220, 60)
    await move(280, 60)
    await release(280, 60)
    node('n_h1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sent('bildr:click')).toEqual([])
    node('n_h1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sent('bildr:click')).toHaveLength(1)
  })
})

describe('everything that ends a gesture drops its preview', () => {
  // A handle drag in flight: the east handle, previewing w-64.
  const drag = async () => {
    await select('n_h1')
    await press(220, 60)
    await move(280, 60)
    expect(sent('bildr:style-preview').at(-1)).toEqual({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { w: '64' } })
  }
  /** The drag is over: its preview was dropped, nothing commits, and no listener of it is left to preview again. */
  const expectEnded = async () => {
    expect(sent('bildr:style-preview').at(-1)).toEqual({ type: 'bildr:style-preview', nodeId: 'n_h1', style: null })
    const before = posted.length
    await move(300, 60)
    await release(300, 60)
    expect(sent('bildr:style-commit')).toEqual([])
    expect(posted.slice(before).filter(message => message.type === 'bildr:style-preview')).toEqual([])
    expect(document.querySelector('[data-drag-label]')).toBeNull()
  }

  it('pointercancel (the browser took the pointer) cancels the drag', async () => {
    await drag()
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))
    await settle()
    await expectEnded()
  })

  it('the window losing focus cancels the drag', async () => {
    await drag()
    window.dispatchEvent(new Event('blur'))
    await settle()
    await expectEnded()
  })

  it('losing the pointer capture cancels the drag', async () => {
    await drag()
    document.documentElement.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }))
    await settle()
    await expectEnded()
  })

  it('another pointer\'s cancel, blur-less events or lost capture do not end it', async () => {
    await drag()
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 2, bubbles: true }))
    document.documentElement.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 2, bubbles: true }))
    await settle()
    expect(sent('bildr:style-preview').at(-1)?.style).toEqual({ w: '64' })
    await release(280, 60)
    expect(sent('bildr:style-commit')).toHaveLength(1)
  })

  it('the dragged node going (another selection, or none) cancels the drag', async () => {
    await drag()
    await select('n_head')
    await expectEnded()
  })

  it('the dragged node being deselected cancels the drag', async () => {
    await drag()
    await select()
    await expectEnded()
  })

  it('the frame going away mid-drag (dispose) cancels it too: the preview is dropped, no listener is left', async () => {
    await drag()
    wrapper?.unmount()
    wrapper = undefined
    await expectEnded()
  })
})

describe('padding and gap handles', () => {
  it('a padding handle drags the side\'s key inward, snapped to the scale', async () => {
    // happy-dom has no stylesheet: the padding the token class would give (8 px = 2 units).
    node('n_h1').style.padding = '8px'
    await select('n_h1')
    await send({ type: 'bildr:overlay', overlay: 'padding' })
    expect(document.querySelectorAll('[data-spacing-handle]')).toHaveLength(4)

    // The top handle is 8 px in from the top edge (y = 48); dragging 16 px down makes the padding 24 px = 6 units.
    await press(120, 48)
    await move(120, 64)
    expect(sent('bildr:style-preview').at(-1)).toEqual({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { pt: '6' } })
    await release(120, 64)
    expect(sent('bildr:style-commit')).toEqual([{ type: 'bildr:style-commit', nodeId: 'n_h1', style: { pt: '6' } }])
  })

  it('a gap handle drags the gap of a flex layout along its axis', async () => {
    const row = node('n_head')
    row.style.display = 'flex'
    row.style.columnGap = '8px'
    const [first, second] = [...row.children] as HTMLElement[]
    // Own properties: spying on the instance would replace the prototype's stub every element shares.
    const boxOf = (el: Element, box: typeof BOX) => Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: () => rect(box) })
    boxOf(row, { left: 0, top: 100, width: 400, height: 40 })
    boxOf(first!, { left: 0, top: 100, width: 100, height: 40 })
    boxOf(second!, { left: 108, top: 100, width: 100, height: 40 })
    await select('n_head')
    await send({ type: 'bildr:overlay', overlay: 'gap' })
    const gap = document.querySelector<HTMLElement>('[data-spacing-handle="gap"]')!
    expect(gap).not.toBeNull()

    // The gap is 8 px (x 100–108), its handle at x 104; 8 px further right is 16 px = 4 units.
    await press(104, 120)
    await move(112, 120)
    await release(112, 120)
    expect(sent('bildr:style-commit').at(-1)).toEqual({ type: 'bildr:style-commit', nodeId: 'n_head', style: { gap: '4' } })
  })
})

describe('the gesture lifecycle acts only on checked messages (U-E1, V6)', () => {
  const other = { postMessage: () => {} } as unknown as Window
  it('a cancel-drag from another origin, a null origin, another window or a null source does not cancel the drag', async () => {
    await select('n_h1')
    await press(220, 60)
    await move(280, 60)
    const forged = { type: 'bildr:cancel-drag' }
    for (const [source, origin] of [[window.parent, 'https://evil.test'], [window.parent, 'null'], [other, window.location.origin], [null, window.location.origin]] as const)
      window.dispatchEvent(new MessageEvent('message', { data: forged, source: source as Window | null, origin }))
    await settle()
    expect(sent('bildr:style-preview').at(-1)).toEqual({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { w: '64' } })
    await release(280, 60)
    expect(sent('bildr:style-commit')).toEqual([{ type: 'bildr:style-commit', nodeId: 'n_h1', style: { w: '64' } }])
  })

  it('a forged bildr:select from another window shows no handles', async () => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'bildr:select', nodeId: 'n_h1', nodeIds: ['n_h1'] }, source: other, origin: window.location.origin }))
    await settle()
    expect(document.querySelectorAll('[data-resize-handle]')).toHaveLength(0)
  })
})
