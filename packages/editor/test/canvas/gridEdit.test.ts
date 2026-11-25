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
 * Grid edit mode (layout-containers L6): a selected grid shows its tracks with
 * headers and − / + steps for the column and row counts, written at the
 * frame's breakpoint; the edge handles of a grid's child span it across the
 * tracks. happy-dom has no layout: the boxes and the grid's computed tracks
 * are stubbed (the frame is 800 px wide, so it renders at md: 3 columns).
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const blog = loaded.model.modules.blog!
const index = () => structuredClone(blog.pages.find(page => page.name === 'index')!)

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
const qa = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
const render = (file = index()): EditorToCanvas => ({
  type: 'bildr:render',
  file,
  components: blog.components,
  layouts: loaded.model.layouts,
  theme: loaded.model.theme!,
  breakpointBase: 'mobile',
  data: { site: { name: 'Blog' }, preferences: { showDrafts: false }, featured: [], quotes: [] },
  view: 'page'
})

/** The grid: 3 columns of 96 px and one row of 100 px, 6 px apart, at (20, 200); its text in the second column. */
const BOXES: Record<string, { left: number, top: number, width: number, height: number }> = {
  n_about: { left: 20, top: 200, width: 300, height: 100 },
  n_about_text: { left: 122, top: 200, width: 96, height: 100 }
}
const GRID = { display: 'grid', gridTemplateColumns: '96px 96px 96px', gridTemplateRows: '100px', columnGap: '6px', rowGap: '6px' }
const rect = (box: { left: number, top: number, width: number, height: number } | undefined) => {
  const b = box ?? { left: 0, top: 0, width: 0, height: 0 }
  return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => ({}) }
}
const centre = (el: HTMLElement) => ({ x: Number.parseFloat(el.style.left) + Number.parseFloat(el.style.width) / 2, y: Number.parseFloat(el.style.top) + Number.parseFloat(el.style.height) / 2 })

const pointer = (type: string, x: number, y: number) =>
  new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true })
const click = async (el: HTMLElement | undefined) => {
  if (!el) throw new Error('no step')
  const { x, y } = centre(el)
  document.dispatchEvent(pointer('pointerdown', x, y))
  await settle()
  window.dispatchEvent(pointer('pointerup', x, y))
  await settle()
}
const select = (id: string) => send({ type: 'bildr:select', nodeId: id, nodeIds: [id] })
const step = (id: string) => document.querySelector<HTMLElement>(`[data-grid-step="${id}"]`) ?? undefined

beforeEach(async () => {
  posted = []
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
  vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as CanvasToEditor)
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rect(BOXES[this.getAttribute('data-node') ?? '']) as DOMRect
  })
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const real = computed(el, pseudo)
    if (el.getAttribute('data-node') !== 'n_about') return real
    return new Proxy(real, {
      get: (target, key) => {
        if (typeof key === 'string' && key in GRID) return GRID[key as keyof typeof GRID]
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
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

describe('grid edit mode (layout-containers L6)', () => {
  it('shows a selected grid\'s tracks with a header each, and none for a node that is no grid', async () => {
    await select('n_about')
    expect(qa('[data-grid-track="col"]').map(el => el.style.left)).toEqual(['20px', '122px', '224px'])
    expect(qa('[data-grid-track="row"]')).toHaveLength(1)
    expect(qa('[data-grid-header="col"]').map(el => el.textContent?.trim())).toEqual(['96', '96', '96'])
    await select('n_about_text')
    expect(qa('[data-grid-track]')).toHaveLength(0)
  })

  it('adds and removes a column or a row at the frame\'s breakpoint; implicit rows have none to remove', async () => {
    await select('n_about')
    await click(step('col+'))
    await click(step('col-'))
    await click(step('row+'))
    expect(step('row-')!.dataset.disabled).toBe('')
    await click(step('row-'))
    expect(sent('bildr:style-commit')).toEqual([
      { type: 'bildr:style-commit', nodeId: 'n_about', style: { 'md:cols': '4' } },
      { type: 'bildr:style-commit', nodeId: 'n_about', style: { 'md:cols': '2' } },
      { type: 'bildr:style-commit', nodeId: 'n_about', style: { 'md:rows': '2' } }
    ])
    // The step took the press: nothing else was selected.
    expect(sent('bildr:click')).toEqual([])
  })

  it('keeps the steps inside the frame: a grid as wide as the page has them inside its right edge', async () => {
    Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, value: 330 })
    try {
      await select('n_about')
      const plus = step('col+')!
      expect(Number.parseFloat(plus.style.left) + Number.parseFloat(plus.style.width)).toBeLessThanOrEqual(320)
    } finally {
      Reflect.deleteProperty(document.documentElement, 'scrollWidth')
    }
  })

  it('offers no steps for auto-fit columns', async () => {
    const file = index()
    const grid = file.root.children!.find(child => child.id === 'n_about')!
    grid.style = { 'cols': '1', 'md:cols': 'auto-fit' }
    await send(render(file))
    await select('n_about')
    expect(qa('[data-grid-track="col"]')).toHaveLength(3)
    expect(step('col+')).toBeUndefined()
    expect(step('col-')).toBeUndefined()
  })

  it('spans a grid child across the columns its east edge is dragged over, previewed, then committed', async () => {
    // The fixture spans the text two columns at md: here it takes one, as its box does.
    const file = index()
    const text = file.root.children!.find(child => child.id === 'n_about')!.children!.find(child => child.id === 'n_about_text')!
    text.style = { gap: '2' }
    await send(render(file))
    await select('n_about_text')
    document.dispatchEvent(pointer('pointerdown', 218, 250))
    await settle()
    window.dispatchEvent(pointer('pointermove', 300, 250))
    await settle()
    expect(sent('bildr:style-preview').at(-1)).toEqual({ type: 'bildr:style-preview', nodeId: 'n_about_text', style: { 'md:colSpan': '2' } })
    window.dispatchEvent(pointer('pointerup', 300, 250))
    await settle()
    expect(sent('bildr:style-commit')).toEqual([{ type: 'bildr:style-commit', nodeId: 'n_about_text', style: { 'md:colSpan': '2' } }])
  })
})
