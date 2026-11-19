import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import ui from '@nuxt/ui/vue-plugin'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { ModelNode } from '../../../codegen/src/model/schemas.ts'
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
  it('shows the hosted style guide (EditorTokenSheet): the theme\'s colours with their shades, the type scale, radii and spacing, instead of the page', async () => {
    await send({ ...render('index'), view: 'tokens' })
    expect(document.querySelector('[data-style-guide]')).not.toBeNull()
    expect(node('n_h1')).toBeNull()
    for (const name of ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']) {
      expect(document.querySelectorAll(`[data-token-color="${name}"] [data-token-shade]`), name).toHaveLength(11)
    }
    const swatch = document.querySelector<HTMLElement>('[data-token-shade="primary-500"]')!
    expect(swatch.style.background).toContain('var(--ui-color-primary-500)')
    expect(document.querySelectorAll('[data-type-sample]')).toHaveLength(5)
    expect(document.querySelectorAll('[data-token-radius]').length).toBeGreaterThan(3)
    expect(document.querySelectorAll('[data-token-spacing]').length).toBeGreaterThan(3)
  })

  it('goes back to the page when it is sent again', async () => {
    await send({ ...render('index'), view: 'tokens' })
    await send(render('index'))
    expect(document.querySelector('[data-style-guide]')).toBeNull()
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

describe('Set state in preview (B5)', () => {
  const click = async (target: HTMLElement) => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
  }
  const toggle = () => node('n_toggle')!
  /** The checkbox's control (the node's element) and the label beside it. */
  const box = toggle
  const label = () => document.querySelector<HTMLElement>(`label[for="${toggle().id}"]`)!
  const reported = () => sent('bildr:interaction').map(message => message.step)
  const set = (value: unknown) => ({ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value })
  const find = (tree: ModelNode, id: string): ModelNode | undefined => tree.id === id ? tree : tree.children?.map(child => find(child, id)).find(Boolean)
  /** The index page with the toggle's change setting the field to `value`. */
  const withChange = (value: unknown): RenderMessage => {
    const file = structuredClone(page('index'))
    find(file.root, 'n_toggle')!.interactions = [{ on: 'change', do: [set(value)] }] as ModelNode['interactions']
    return { ...render('index', { featured: posts, quotes: [] }), file }
  }

  it('draws the checkbox as the State field it is bound to: off by default, on once the State says so', async () => {
    await send(render('index', { featured: posts, quotes: [] }))
    expect(box().getAttribute('aria-checked')).toBe('false')
    await send(render('index', { featured: posts, quotes: [], preferences: { showDrafts: true } }))
    expect(box().getAttribute('aria-checked')).toBe('true')
    await send(render('index', { featured: posts, quotes: [], preferences: {} }))
    expect(box().getAttribute('aria-checked')).toBe('false')
  })

  it('selects, and reports nothing to set, in edit mode', async () => {
    await send(render('index', { featured: posts, quotes: [] }))
    await click(box())
    expect(sent('bildr:click').map(message => message.nodeId)).toEqual(['n_toggle'])
    expect(sent('bildr:interaction')).toEqual([])
  })

  it('reports the new value of the checkbox, as its change gives it: on, then off once the State says on', async () => {
    await send(render('index', { featured: posts, quotes: [] }))
    await send({ type: 'bildr:mode', mode: 'preview' })
    await click(box())
    expect(reported()).toEqual([set(true)])
    expect(sent('bildr:interaction')[0]).toMatchObject({ nodeId: 'n_toggle', on: 'change' })
    expect(sent('bildr:click')).toEqual([])

    await send(render('index', { featured: posts, quotes: [], preferences: { showDrafts: true } }))
    await click(box())
    expect(reported()).toEqual([set(true), set(false)])
  })

  it('reports one change for a click on the checkbox\'s label too', async () => {
    await send(render('index', { featured: posts, quotes: [] }))
    await send({ type: 'bildr:mode', mode: 'preview' })
    await click(label())
    expect(reported()).toEqual([set(true)])
  })

  it('works the value out in the canvas: a fixed value, the opposite of a binding, a bound value, a template', async () => {
    const data = { featured: posts, quotes: [], preferences: { showDrafts: true, name: 'ada' } }
    await send({ type: 'bildr:mode', mode: 'preview' })
    for (const value of [false, 'text', 4, { not: { $bind: 'preferences.showDrafts' } }, { $bind: 'preferences.name' }, { $template: 'hi {preferences.name}' }]) {
      posted = []
      await send({ ...withChange(value), data: { site: { name: 'Blog' }, ...data } })
      await click(box())
      expect(reported()).toEqual([set(typeof value === 'object' ? { not: false, $bind: 'ada', $template: 'hi ada' }[Object.keys(value)[0] as 'not'] : value)])
    }
  })

  it('says nothing for a value it cannot work out', async () => {
    await send({ type: 'bildr:mode', mode: 'preview' })
    await send(withChange({ $bind: 'nowhere.field' }))
    await click(box())
    await send(withChange({ $bind: 'featured' }))
    await click(box())
    expect(sent('bildr:interaction')).toEqual([])
  })

  it('keeps working after a render that changes nothing about the checkbox, and starts over when the mode changes', async () => {
    await send({ type: 'bildr:mode', mode: 'preview' })
    await send(render('index', { featured: posts, quotes: [] }))
    await send(render('index', { featured: posts, quotes: [], site: { name: 'Other' } }))
    await click(box())
    expect(reported()).toEqual([set(true)])
    await send({ type: 'bildr:mode', mode: 'edit' })
    posted = []
    await click(box())
    expect(sent('bildr:interaction')).toEqual([])
  })

  describe('on the exact row that was clicked', () => {
    const rows = [...posts, { id: 'c', title: 'Third', slug: 'third', body: 'Three', published: true }]
    const copies = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-node="${id}"]`)]
    /** The index page with `added` as one more child of `parent`, and the rows as the featured posts. */
    const withChild = (parent: string, added: ModelNode): RenderMessage => {
      const file = structuredClone(page('index'))
      find(file.root, parent)!.children!.push(added)
      return { ...render('index', { featured: rows, quotes: [] }), file }
    }
    const step = (value: unknown, field = 'showDrafts') => ({ kind: 'setState', state: 'st_preferences', field, value })
    const on = (event: string, value: unknown): ModelNode['interactions'] => [{ on: event, do: [step(value)] }] as ModelNode['interactions']

    it('works a bound value out in row 3, not in the first row', async () => {
      await send(withChild('n_list', { id: 'n_row', type: 'Button', props: { label: 'Pick' }, interactions: on('click', { $bind: 'post.slug' }) } as ModelNode))
      await send({ type: 'bildr:mode', mode: 'preview' })
      expect(copies('n_row')).toHaveLength(3)
      await click(copies('n_row')[2]!)
      await click(copies('n_row')[0]!)
      await click(copies('n_row')[1]!)
      expect(reported()).toEqual([set('third'), set('first'), set('second')])
    })

    it('reports the new value of the checkbox of that row: a bound one from its own row, not the first row\'s', async () => {
      await send(withChild('n_list', { id: 'n_pub', type: 'Checkbox', props: { label: 'Published', value: { $bind: 'post.published' } }, interactions: on('change', { $event: 'checked' }) } as ModelNode))
      await send({ type: 'bildr:mode', mode: 'preview' })
      expect(copies('n_pub').map(entry => entry.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true'])
      await click(copies('n_pub')[1]!)
      await click(copies('n_pub')[2]!)
      expect(reported()).toEqual([set(true), set(false)])
    })

    it('an unbound checkbox starts off and alternates, as the app\'s does; each row has its own, and leaving preview starts them over', async () => {
      await send(withChild('n_list', { id: 'n_free', type: 'Checkbox', props: { label: 'Free' }, interactions: on('change', { $event: 'checked' }) } as ModelNode))
      await send({ type: 'bildr:mode', mode: 'preview' })
      const state = () => copies('n_free').map(entry => entry.getAttribute('aria-checked'))
      expect(state()).toEqual(['false', 'false', 'false'])
      await click(copies('n_free')[0]!)
      await click(copies('n_free')[0]!)
      await click(copies('n_free')[2]!)
      expect(reported()).toEqual([set(true), set(false), set(true)])
      expect(state()).toEqual(['false', 'false', 'true'])
      await send({ type: 'bildr:mode', mode: 'edit' })
      await send({ type: 'bildr:mode', mode: 'preview' })
      expect(state()).toEqual(['false', 'false', 'false'])
      posted = []
      await click(copies('n_free')[2]!)
      expect(reported()).toEqual([set(true)])
    })

    it('an unbound checkbox outside a List alternates too', async () => {
      await send(withChild('n_head', { id: 'n_free', type: 'Checkbox', props: { label: 'Free' }, interactions: on('change', { $event: 'checked' }) } as ModelNode))
      await send({ type: 'bildr:mode', mode: 'preview' })
      await click(node('n_free')!)
      await click(node('n_free')!)
      await click(node('n_free')!)
      expect(reported()).toEqual([set(true), set(false), set(true)])
    })
  })

  describe('steps in order', () => {
    const titles = () => document.body.textContent ?? ''
    const withSteps = (steps: unknown[]): RenderMessage => {
      const file = structuredClone(page('index'))
      find(file.root, 'n_toggle')!.interactions = [{ on: 'change', do: steps }] as ModelNode['interactions']
      return { ...render('index', { featured: posts, quotes: [] }), file }
    }
    // The toasts of the canvas outlive a test: each one has its own title.
    const toast = (title: string) => ({ kind: 'toast', title })

    it('shows a message after the Set state before it was reported', async () => {
      await send(withSteps([set(true), toast('Saved it')]))
      await send({ type: 'bildr:mode', mode: 'preview' })
      const seen: boolean[] = []
      vi.mocked(window.parent.postMessage).mockImplementation((message: unknown) => {
        posted.push(message as CanvasToEditor)
        seen.push(titles().includes('Saved it'))
      })
      await click(box())
      expect(reported()).toEqual([set(true)])
      expect(seen).toEqual([false])
      expect(titles()).toContain('Saved it')
    })

    it('stops at a Set state it cannot work out, as a failed action does: the message after it does not show', async () => {
      await send(withSteps([set({ $bind: 'nowhere.field' }), toast('Too early')]))
      await send({ type: 'bildr:mode', mode: 'preview' })
      await click(box())
      expect(sent('bildr:interaction')).toEqual([])
      expect(titles()).not.toContain('Too early')
    })

    it('runs the steps before an unresolved one', async () => {
      await send(withSteps([toast('Went first'), set({ $bind: 'nowhere.field' }), { kind: 'navigate', to: { page: 'pg_index' } }]))
      await send({ type: 'bildr:mode', mode: 'preview' })
      await click(box())
      expect(titles()).toContain('Went first')
      expect(sent('bildr:interaction')).toEqual([])
    })
  })

  describe('keys', () => {
    const key = async (target: EventTarget, type: 'keydown' | 'keyup', code: string, name: string) => {
      target.dispatchEvent(new KeyboardEvent(type, { code, key: name, bubbles: true, cancelable: true }))
      await settle()
    }
    const space = (target: EventTarget, type: 'keydown' | 'keyup' = 'keydown') => key(target, type, 'Space', ' ')

    it('Space on the focused checkbox toggles it in preview, and does not pan', async () => {
      await send(render('index', { featured: posts, quotes: [] }))
      await send({ type: 'bildr:mode', mode: 'preview' })
      await space(box())
      await space(box(), 'keyup')
      expect(reported()).toEqual([set(true)])
      expect(sent('bildr:space')).toEqual([])
    })

    it('Enter on the focused checkbox toggles it in preview, and is not the editor\'s key', async () => {
      await send(render('index', { featured: posts, quotes: [] }))
      await send({ type: 'bildr:mode', mode: 'preview' })
      await key(box(), 'keydown', 'Enter', 'Enter')
      expect(reported()).toEqual([set(true)])
      expect(sent('bildr:key')).toEqual([])
    })

    it('Space pans when no control is focused in preview, and in edit mode even over a checkbox', async () => {
      await send(render('index', { featured: posts, quotes: [] }))
      await send({ type: 'bildr:mode', mode: 'preview' })
      await space(document.body)
      expect(sent('bildr:space')).toEqual([{ type: 'bildr:space', down: true }])
      await send({ type: 'bildr:mode', mode: 'edit' })
      posted = []
      await space(box())
      expect(sent('bildr:space')).toEqual([{ type: 'bildr:space', down: true }])
      expect(sent('bildr:interaction')).toEqual([])
    })
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
