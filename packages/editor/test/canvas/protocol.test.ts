import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import ui from '@nuxt/ui/vue-plugin'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import CanvasApp from '../../src/canvas/CanvasApp.vue'
import type { CanvasToEditor, EditorToCanvas, RenderMessage } from '../../src/canvas/protocol.ts'
import { createCanvasRouter } from '../../src/canvas/router.ts'
import { blogModelFiles } from './fixture.ts'

/**
 * The canvas's postMessage protocol (P4a, mapping §6): `bildr:render` shows a
 * `.bildr` file; pointer gestures report the node of the file being edited;
 * select, hover and measure answer as the hosted canvas did.
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const fixture = loaded.model
const blog = fixture.modules.blog!
const page = (name: string) => blog.pages.find(entry => entry.name === name)!

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

const render = (name: string, data: Record<string, unknown> = {}): RenderMessage => ({
  type: 'bildr:render',
  file: page(name),
  components: blog.components,
  layouts: fixture.layouts,
  theme: fixture.theme!,
  breakpointBase: 'mobile',
  data: { site: { name: 'Blog', description: 'About' }, preferences: { showDrafts: false }, ...data },
  view: 'page'
})

const node = (id: string) => document.querySelector<HTMLElement>(`[data-node="${id}"]:not([data-copy])`)
const sent = <T extends CanvasToEditor['type']>(type: T) => posted.filter((message): message is Extract<CanvasToEditor, { type: T }> => message.type === type)

const posts = [{ id: 'a', title: 'First', slug: 'first', body: 'One', published: true }, { id: 'b', title: 'Second', slug: 'second', body: 'Two', published: false }]

beforeEach(async () => {
  posted = []
  vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as CanvasToEditor)
  })
  wrapper = mount(CanvasApp, { attachTo: document.body, global: { plugins: [createCanvasRouter(), ui] } })
  await settle()
})

afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('render', () => {
  it('says it is ready, then renders the page it is sent with its layout and data', async () => {
    expect(posted[0]).toEqual({ type: 'bildr:ready' })
    await send(render('index', { featured: posts, quotes: [] }))
    expect(node('n_h1')?.tagName).toBe('H1')
    expect(node('n_h1')?.textContent?.trim()).toBe('Posts')
    expect(node('n_page/@n_header')?.tagName).toBe('HEADER')
    expect(node('n_card/n_title')?.textContent?.trim()).toBe('First')
    expect(document.querySelectorAll('[data-node="n_card"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-node="n_card"][data-copy]')).toHaveLength(1)
  })

  it('applies the theme as a stylesheet', async () => {
    await send(render('index'))
    expect(document.getElementById('bildr-canvas-theme')?.textContent).toContain('--ui-radius: 0.375rem;')
  })

  it('ignores messages from anywhere but its parent', async () => {
    window.dispatchEvent(new MessageEvent('message', { data: render('index'), source: null }))
    await settle()
    expect(node('n_h1')).toBeNull()
  })

  it('ignores messages from its parent window under another origin', async () => {
    window.dispatchEvent(new MessageEvent('message', { data: render('index'), source: window.parent, origin: 'https://evil.example' }))
    await settle()
    expect(node('n_h1')).toBeNull()
    await send(render('index'))
    expect(node('n_h1')).not.toBeNull()
  })
})

describe('token sheet', () => {
  it('shows the theme\'s colours with their shades, its own colours, radius, spacing and font instead of the page', async () => {
    await send({ ...render('index'), theme: { ...fixture.theme!, custom: { ink: '#112233' } }, view: 'tokens' })
    expect(document.querySelector('[data-token-sheet]')).not.toBeNull()
    expect(node('n_h1')).toBeNull()
    for (const name of ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']) {
      expect(document.querySelectorAll(`[data-token-color="${name}"] [data-shade]`), name).toHaveLength(11)
    }
    const swatch = document.querySelector<HTMLElement>('[data-token-color="primary"] [data-shade="500"]')!
    expect(swatch.style.backgroundColor).toContain('var(--ui-color-primary-500)')
    expect(document.querySelector<HTMLElement>('[data-token-custom="ink"]')?.style.backgroundColor).toContain('var(--bildr-color-ink)')
    expect(document.querySelector('[data-token-radius]')?.textContent).toContain('0.375rem')
    expect(document.querySelector('[data-token-font]')?.textContent).toContain('Inter')
  })

  it('goes back to the page when it is sent again', async () => {
    await send({ ...render('index'), view: 'tokens' })
    await send(render('index'))
    expect(document.querySelector('[data-token-sheet]')).toBeNull()
    expect(node('n_h1')).not.toBeNull()
  })
})

describe('pointer gestures', () => {
  beforeEach(() => send(render('index', { featured: posts, quotes: [] })))

  it('a click reports the node, an instance part its instance, a layout part the page root', async () => {
    node('n_h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    node('n_card/n_title')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
    node('n_page/@n_section')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sent('bildr:click')).toEqual([
      { type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false },
      { type: 'bildr:click', nodeId: 'n_card', shift: true, meta: false },
      { type: 'bildr:click', nodeId: 'n_page', shift: false, meta: false }
    ])
  })

  it('a click on a copy of a List row selects the node it repeats', async () => {
    document.querySelector<HTMLElement>('[data-node="n_card/n_title"][data-copy]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(sent('bildr:click').at(-1)).toMatchObject({ nodeId: 'n_card' })
  })

  it('a click never follows a link in edit mode', async () => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    node('n_read_more')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(sent('bildr:click').at(-1)).toMatchObject({ nodeId: 'n_read_more' })
  })

  it('hover reports the node under the pointer, and null when the pointer leaves', async () => {
    node('n_h1')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    node('n_h1')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    document.documentElement.dispatchEvent(new MouseEvent('mouseleave'))
    expect(sent('bildr:hover')).toEqual([{ type: 'bildr:hover', nodeId: 'n_h1' }, { type: 'bildr:hover', nodeId: null }])
  })

  it('a right-click reports the node at viewport coordinates', async () => {
    node('n_h1')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 34 }))
    expect(sent('bildr:contextmenu')).toEqual([{ type: 'bildr:contextmenu', nodeId: 'n_h1', x: 12, y: 34 }])
  })
})

describe('selection, hover outline and measuring', () => {
  beforeEach(async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('data-node') === 'n_h1' ? new DOMRect(10, 20, 100, 30) : new DOMRect(0, 0, 50, 10)
    })
    await send(render('index', { featured: posts, quotes: [] }))
  })

  it('outlines the selection and labels the primary one, and outlines what the editor hovers', async () => {
    await send({ type: 'bildr:select', nodeId: 'n_h1', nodeIds: ['n_h1'] })
    const box = document.querySelector<HTMLElement>('[data-selection-box="n_h1"]')
    expect(box?.style.top).toBe('20px')
    expect(box?.style.width).toBe('100px')
    expect(document.querySelector('[data-selection-label]')?.textContent?.trim()).toBe('Heading')
    await send({ type: 'bildr:hover', nodeId: 'n_card' })
    expect(document.querySelector('[data-hover-box="n_card"]')).not.toBeNull()
  })

  it('answers bildr:measure with the boxes of the nodes it has, under the same request id', async () => {
    await send({ type: 'bildr:measure', requestId: 7, nodeIds: ['n_h1', 'n_gone'] })
    expect(sent('bildr:rects')).toEqual([{ type: 'bildr:rects', requestId: 7, rects: [{ id: 'n_h1', x: 10, y: 20, width: 100, height: 30 }] }])
  })

  it('paints the padding overlay a hovered panel field asks for, on the selection', async () => {
    // happy-dom has no stylesheet: the padding the token class would give.
    node('n_h1')!.style.padding = '8px'
    await send({ type: 'bildr:select', nodeId: 'n_h1', nodeIds: ['n_h1'] })
    await send({ type: 'bildr:overlay', overlay: 'padding' })
    expect(document.querySelector('[data-spacing-overlay="padding"]')).not.toBeNull()
    await send({ type: 'bildr:overlay', overlay: null })
    expect(document.querySelector('[data-spacing-overlay]')).toBeNull()
  })
})

describe('preview mode', () => {
  it('runs component variant interactions in the canvas and reports navigation to the editor', async () => {
    await send(render('posts-new', { createPost: { pending: false, error: null } }))
    // Edit mode: a click selects; nothing runs.
    const toggle = () => node('n_tip/n_tip_toggle')!
    expect(toggle().textContent?.trim()).toBe('Show')
    toggle().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    expect(toggle().textContent?.trim()).toBe('Show')

    await send({ type: 'bildr:mode', mode: 'preview' })
    posted = []
    toggle().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    expect(toggle().textContent?.trim()).toBe('Hide')
    expect(sent('bildr:click')).toEqual([])

    node('n_cancel')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    expect(sent('bildr:interaction')).toEqual([{ type: 'bildr:interaction', nodeId: 'n_cancel', on: 'click', step: { kind: 'navigate', to: { page: 'pg_index' } } }])
  })

  it('toggles an interactive instance both ways with a real mouse: every click is preceded by a pointer move', async () => {
    await send(render('posts-new', { createPost: { pending: false, error: null } }))
    await send({ type: 'bildr:mode', mode: 'preview' })
    const toggle = () => node('n_tip/n_tip_toggle')!
    const mouseClick = async () => {
      toggle().dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      toggle().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      toggle().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      toggle().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await settle()
    }
    const labels: string[] = [toggle().textContent!.trim()]
    for (let i = 0; i < 4; i++) {
      await mouseClick()
      labels.push(toggle().textContent!.trim())
    }
    expect(labels).toEqual(['Show', 'Hide', 'Show', 'Hide', 'Show'])
  })

  it('keeps a variant a click switched to when the pointer leaves the instance, as the generated app does', async () => {
    await send(render('posts-new', { createPost: { pending: false, error: null } }))
    await send({ type: 'bildr:mode', mode: 'preview' })
    const toggle = () => node('n_tip/n_tip_toggle')!
    // The tip starts collapsed ("Show"); a click expands it ("Hide").
    expect(toggle().textContent?.trim()).toBe('Show')
    toggle().dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    toggle().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    toggle().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    toggle().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    expect(toggle().textContent?.trim()).toBe('Hide')

    node('n_cancel')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    await settle()
    expect(toggle().textContent?.trim()).toBe('Hide')
    document.documentElement.dispatchEvent(new MouseEvent('mouseleave'))
    await settle()
    expect(toggle().textContent?.trim()).toBe('Hide')
  })
})

describe('a List\'s Load more in preview', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, title: `Post ${index}`, slug: `p${index}`, body: '', published: true, publishedAt: null, createdAt: null }))
  const cards = () => document.querySelectorAll('[data-node="n_card"]').length
  const more = () => [...document.querySelectorAll<HTMLElement>('button')].find(button => button.textContent?.trim() === 'Load more')
  const click = async (target: HTMLElement) => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
  }
  const index = (count: number) => render('index', { posts: rows(count), all: rows(count), featured: [], quotes: [] })

  it('shows a page more rows for each click, until there are no more, and only in preview', async () => {
    await send(index(14))
    expect(cards()).toBe(6)
    // Edit mode: the button is not live.
    await click(more()!)
    expect(cards()).toBe(6)

    await send({ type: 'bildr:mode', mode: 'preview' })
    await click(more()!)
    expect(cards()).toBe(12)
    await click(more()!)
    expect(cards()).toBe(14)
    expect(more()).toBeUndefined()
  })

  it('starts again from the first page when the mode changes', async () => {
    await send(index(14))
    await send({ type: 'bildr:mode', mode: 'preview' })
    await click(more()!)
    expect(cards()).toBe(12)
    await send({ type: 'bildr:mode', mode: 'edit' })
    expect(cards()).toBe(6)
  })
})
