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
 * The hosted canvas's overlay layer and gestures (U6, `pages/canvas.vue`): the drag-to-reorder of the
 * selection and its drop indicator, the armed tool's insert slot, the Alt measurements with their px,
 * and the data attributes the hosted e2e scripts read. happy-dom has no layout, so the boxes are stubbed.
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

/** The page's boxes: the Row `n_head` holds the heading (20–220) and the checkbox (230–330) side by side. */
const BOXES: Record<string, { left: number, top: number, width: number, height: number }> = {
  n_page: { left: 0, top: 0, width: 400, height: 400 },
  n_head: { left: 0, top: 40, width: 400, height: 40 },
  n_h1: { left: 20, top: 40, width: 200, height: 40 },
  n_toggle: { left: 230, top: 40, width: 100, height: 40 },
  n_list: { left: 0, top: 120, width: 400, height: 100 }
}
const rect = (box?: (typeof BOXES)[string]) => ({ ...(box ?? { left: 0, top: 0, width: 0, height: 0 }), x: box?.left ?? 0, y: box?.top ?? 0, right: (box?.left ?? 0) + (box?.width ?? 0), bottom: (box?.top ?? 0) + (box?.height ?? 0), toJSON: () => ({}) })

const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}) =>
  new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...init })
const settled = async (act: () => void) => {
  act()
  await settle()
}
const press = (target: Element, x: number, y: number) => settled(() => void target.dispatchEvent(pointer('pointerdown', x, y)))
const move = (x: number, y: number, init: PointerEventInit = {}) => settled(() => void window.dispatchEvent(pointer('pointermove', x, y, init)))
const release = (x: number, y: number) => settled(() => void window.dispatchEvent(pointer('pointerup', x, y)))
const select = (...ids: string[]) => send({ type: 'bildr:select', nodeId: ids.at(-1) ?? null, nodeIds: ids })
/** The element a captured pointer is over (happy-dom has no hit testing). */
const pointerOver = (id: string) => vi.spyOn(document, 'elementFromPoint').mockImplementation(() => node(id))

beforeEach(async () => {
  posted = []
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
  vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as CanvasToEditor)
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rect(BOXES[this.getAttribute('data-node') ?? '']) as DOMRect
  })
  wrapper = mount(CanvasApp, { attachTo: document.body, global: { plugins: [createCanvasRouter(), ui] } })
  await settle()
  await send(render())
  const head = node('n_head')
  head.style.display = 'flex'
  head.style.flexDirection = 'row'
})

afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('drag-to-reorder of the selection', () => {
  it('a press that moves past 4 px drags it: the indicator shows the slot, and the release moves the node there (one bildr:drop)', async () => {
    await select('n_h1')
    pointerOver('n_toggle')
    await press(node('n_h1'), 100, 60)
    await move(102, 60)
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()

    // Over the right half of the checkbox (230–330): after it, in the Row.
    await move(300, 60)
    const indicator = document.querySelector<HTMLElement>('[data-drop-indicator]')!
    // A vertical line at the checkbox's right edge, as tall as it.
    expect([indicator.style.left, indicator.style.top, indicator.style.width, indicator.style.height]).toEqual(['329px', '40px', '2px', '40px'])

    await release(300, 60)
    expect(sent('bildr:drop')).toEqual([{ type: 'bildr:drop', parentId: 'n_head', index: 2, payload: JSON.stringify({ kind: 'node', id: 'n_h1' }) }])
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()
    // The click that ends the drag selects nothing.
    node('n_toggle').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sent('bildr:click')).toEqual([])
  })

  it('a press that never becomes a drag is no drag: its click still selects', async () => {
    await select('n_h1')
    await press(node('n_h1'), 100, 60)
    await move(102, 61)
    await release(102, 61)
    expect(sent('bildr:drop')).toEqual([])
    node('n_h1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sent('bildr:click')).toHaveLength(1)
  })

  it('Esc cancels the drag: no indicator, nothing dropped, and the key is the drag\'s own', async () => {
    await select('n_h1')
    pointerOver('n_toggle')
    await press(node('n_h1'), 100, 60)
    await move(300, 60)
    expect(document.querySelector('[data-drop-indicator]')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    await settle()
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()
    await release(300, 60)
    expect(sent('bildr:drop')).toEqual([])
    expect(sent('bildr:key')).toEqual([])
  })

  it('drops nothing where the node would stay, and a move with the button up ends the drag', async () => {
    await select('n_h1')
    pointerOver('n_h1')
    await press(node('n_h1'), 100, 60)
    await move(150, 60)
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()
    await release(150, 60)
    expect(sent('bildr:drop')).toEqual([])

    pointerOver('n_toggle')
    await press(node('n_h1'), 100, 60)
    await move(300, 60)
    await move(310, 60, { buttons: 0 })
    await release(310, 60)
    expect(sent('bildr:drop')).toEqual([])
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()
  })

  it('does not start on the root, several nodes, a node that is not under the press, or in preview mode', async () => {
    pointerOver('n_toggle')
    await select('n_page')
    await press(node('n_h1'), 100, 60)
    await move(300, 60)
    await release(300, 60)
    await select('n_h1', 'n_toggle')
    await press(node('n_h1'), 100, 60)
    await move(300, 60)
    await release(300, 60)
    // The press is on another node than the selection.
    await select('n_h1')
    await press(node('n_toggle'), 280, 60)
    await move(100, 60)
    await release(100, 60)
    await send({ type: 'bildr:mode', mode: 'preview' })
    await press(node('n_h1'), 100, 60)
    await move(300, 60)
    await release(300, 60)
    expect(sent('bildr:drop')).toEqual([])
  })
})

describe('a reorder drag that ends any other way', () => {
  const drag = async () => {
    await select('n_h1')
    pointerOver('n_toggle')
    await press(node('n_h1'), 100, 60)
    await move(300, 60)
    expect(document.querySelector('[data-drop-indicator]')).not.toBeNull()
  }
  const expectCancelled = async () => {
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()
    await release(300, 60)
    expect(sent('bildr:drop')).toEqual([])
  }

  it('pointercancel, a window blur, a lost pointer capture and the node going each drop the indicator and drop nothing', async () => {
    await drag()
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))
    await settle()
    await expectCancelled()

    await drag()
    window.dispatchEvent(new Event('blur'))
    await settle()
    await expectCancelled()

    await drag()
    document.documentElement.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }))
    await settle()
    await expectCancelled()

    await drag()
    await select('n_toggle')
    await expectCancelled()
  })

  it('a press that is still under the threshold is abandoned by a blur: no drag starts, and its click still selects', async () => {
    await select('n_h1')
    await press(node('n_h1'), 100, 60)
    window.dispatchEvent(new Event('blur'))
    await settle()
    pointerOver('n_toggle')
    await move(300, 60)
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()
    await release(300, 60)
    expect(sent('bildr:drop')).toEqual([])
  })

  it('the frame going away mid-drag leaves no listener to drop the node later', async () => {
    await drag()
    wrapper?.unmount()
    wrapper = undefined
    await move(305, 60)
    await release(305, 60)
    expect(sent('bildr:drop')).toEqual([])
  })
})

describe('the armed insert tool', () => {
  const clickAt = (target: Element, x: number, y: number) => settled(() => void target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })))
  const hoverAt = (target: Element, x: number, y: number) => settled(() => void target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y })))

  beforeEach(() => send({ type: 'bildr:tool', tool: 'Text' }))

  it('shows a crosshair, and a click in a container reports the slot between the children around the pointer, read along its axis', async () => {
    expect(document.querySelector('[data-armed-tool="Text"]')).not.toBeNull()
    await clickAt(node('n_head'), 25, 60)
    expect(sent('bildr:insert').at(-1)).toEqual({ type: 'bildr:insert', parentId: 'n_head', index: 0 })
    await clickAt(node('n_head'), 300, 60)
    expect(sent('bildr:insert').at(-1)).toEqual({ type: 'bildr:insert', parentId: 'n_head', index: 2 })
    expect(sent('bildr:click')).toEqual([])
  })

  it('a click on a leaf reports the slot right after it, and the pointer shows the slot with the drop indicator', async () => {
    await hoverAt(node('n_h1'), 30, 60)
    expect(document.querySelector('[data-drop-indicator]')).not.toBeNull()
    await clickAt(node('n_h1'), 30, 60)
    expect(sent('bildr:insert').at(-1)).toEqual({ type: 'bildr:insert', parentId: 'n_head', index: 1 })
    expect(document.querySelector('[data-drop-indicator]')).toBeNull()
  })
})

describe('the keys', () => {
  const keydown = (key: string, init: KeyboardEventInit = {}) => settled(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, code: init.code ?? `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...init })))

  it('forwards a tool letter (the frame has the focus after a click, so the editor never sees it), but not with a modifier', async () => {
    await keydown('t')
    await keydown('h')
    expect(sent('bildr:key').map(message => message.key)).toEqual(['t', 'h'])
    await keydown('t', { altKey: true })
    await keydown('x')
    expect(sent('bildr:key')).toHaveLength(2)
  })
})

describe('the overlays as the hosted canvas draws them', () => {
  it('labels the selection above its box, or inside it at the top of the frame, and names the side in data-selection-label', async () => {
    await select('n_h1')
    expect(document.querySelector('[data-selection-label]')?.getAttribute('data-selection-label')).toBe('above')
    BOXES.n_h1 = { left: 20, top: 0, width: 200, height: 40 }
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(document.querySelector('[data-selection-label]')?.getAttribute('data-selection-label')).toBe('inside')
    BOXES.n_h1 = { left: 20, top: 40, width: 200, height: 40 }
  })

  it('draws Alt\'s distance lines with their px beside them, from the selection to the hovered element', async () => {
    await select('n_h1')
    await send({ type: 'bildr:hover', nodeId: 'n_toggle' })
    await send({ type: 'bildr:alt', down: true })
    // The heading ends at 220 and the checkbox starts at 230: a 10 px line, labelled.
    const lines = [...document.querySelectorAll<HTMLElement>('[data-measure-line]')]
    expect(lines.map(line => line.dataset.measurePx)).toContain('10')
    const label = lines.find(line => line.dataset.measurePx === '10')!.querySelector('span')
    expect(label?.textContent).toBe('10')
  })

  it('tells the editor\'s accent, the armed tool and the variant a board frame shows in data attributes', async () => {
    expect(document.querySelector('[data-canvas-accent]')?.getAttribute('data-canvas-accent')).toBe('#09f')
    await send({ type: 'bildr:select', nodeId: 'n_h1', nodeIds: ['n_h1'], accent: '#85f' })
    expect(document.querySelector('[data-canvas-accent]')?.getAttribute('data-canvas-accent')).toBe('#85f')
    expect(document.querySelector('[data-armed-tool]')).toBeNull()
    expect(document.querySelector('[data-board-variant]')).toBeNull()
    await send({ ...render(), variant: { id: 'var_compact', label: 'compact' } } as EditorToCanvas)
    expect(document.querySelector('[data-board-variant]')?.getAttribute('data-board-variant')).toBe('var_compact')
    await send({ ...render(), variant: { id: null, label: 'default' } } as EditorToCanvas)
    expect(document.querySelector('[data-board-variant]')?.getAttribute('data-board-variant')).toBe('primary')
  })

  it('numbers the padding and gap areas of a spacing overlay by side', async () => {
    node('n_h1').style.padding = '8px'
    await select('n_h1')
    await send({ type: 'bildr:overlay', overlay: 'padding' })
    expect([...document.querySelectorAll('[data-padding-area]')].map(area => area.getAttribute('data-padding-area')).sort()).toEqual(['bottom', 'left', 'right', 'top'])
  })
})
