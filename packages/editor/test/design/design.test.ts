import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { ModelNode } from '../../../codegen/src/model/schemas.ts'
import { catalogGet } from '../../../codegen/src/edit/theme.ts'
import { PALETTE } from '../../../codegen/src/edit/palette.ts'
import type { CanvasToEditor, EditorToCanvas } from '../../src/canvas/protocol.ts'
import { canvasSrc } from '../../src/design/config.ts'
import DesignView from '../../src/views/DesignView.vue'
import { blogModelFiles } from '../canvas/fixture.ts'
import { byTestId, click, Failure, mockActions, mountWithApp, settle, typeInto } from '../helpers.ts'
import { byLabel, chooseDevice, inspectorHead, insertType, propInput, sidebarTab, typeStyle } from './harness.ts'

/**
 * The Design screen (P4b, V1): page picker, layers, the canvas frame, inspector,
 * palette and undo/redo over the P3 actions. The canvas iframe is a stub window
 * the tests read the posted messages from and answer as the canvas would.
 */

const files = blogModelFiles()
const loaded = loadModel(files)
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const parsed = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, JSON.parse(text) as unknown]))
const blank = () => structuredClone(loaded.model)

let model = blank()
const modelGet = () => ({ ok: true, model, files: parsed, database: false })
const catalog = () => ({
  nodeTypes: PALETTE.map(entry => ({ type: entry.type, label: entry.label, description: entry.description, container: entry.container, insertable: true, props: [], defaults: { props: entry.props, style: entry.style } })),
  styleTokens: [],
  breakpoints: { base: 'mobile', prefixes: ['sm', 'md', 'lg'] },
  colors: [],
  components: [{ id: 'cmp_post_card', name: 'PostCard', module: 'blog' }],
  layouts: []
})
void catalogGet

const find = (tree: ModelNode, id: string): ModelNode | undefined => tree.id === id ? tree : tree.children?.map(child => find(child, id)).find(Boolean)
const indexPage = () => model.modules.blog!.pages.find(page => page.name === 'index')!

/** A stand-in for the browser's EventSource. */
class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []
  readyState = FakeEventSource.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  send(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
  }
}

let posted: EditorToCanvas[] = []
// A real postMessage structured-clones its message (a Vue proxy throws DataCloneError), so the stand-in does too.
const frameWindow = { postMessage: (message: EditorToCanvas) => posted.push(structuredClone(message)) }
const sent = <T extends EditorToCanvas['type']>(type: T) => posted.filter((message): message is Extract<EditorToCanvas, { type: T }> => message.type === type)

/** What the canvas iframe says to the editor. */
const fromCanvas = async (message: CanvasToEditor, origin = window.location.origin) => {
  window.dispatchEvent(new MessageEvent('message', { data: message, source: frameWindow as unknown as Window, origin }))
  await settle()
}

const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')

const handlers = () => ({
  model_get: modelGet,
  catalog_get: catalog,
  history_get: () => ({ undo: [{ action: 'node_update_props' }], redo: [{ action: 'node_update_props' }] }),
  node_update_props: (input: Record<string, unknown>) => {
    const node = find(indexPage().root, String(input.nodeId))!
    Object.assign(node.props ??= {}, input.props as Record<string, never>)
    return { changed: ['.bildr/modules/blog/pages/index.json'] }
  },
  node_update_style: (input: Record<string, unknown>) => {
    const node = find(indexPage().root, String(input.nodeId))!
    const prefix = input.breakpoint ? `${String(input.breakpoint)}:` : ''
    for (const [key, value] of Object.entries(input.style as Record<string, string | null>)) {
      node.style ??= {}
      if (value === null) Reflect.deleteProperty(node.style, prefix + key)
      else node.style[prefix + key] = value
    }
    return { changed: ['.bildr/modules/blog/pages/index.json'] }
  },
  node_insert: () => ({ nodeId: 'n_button_1', changed: ['.bildr/modules/blog/pages/index.json'] }),
  node_move: () => ({ changed: [] }),
  node_delete: () => ({ changed: [] }),
  node_duplicate: () => ({ nodeId: 'n_h1_copy', nodeIds: ['n_h1_copy'], changed: [] }),
  node_rename: () => ({ changed: [] }),
  node_set_locked: () => ({ changed: [] }),
  history_undo: () => ({ action: 'node_update_props', files: [] }),
  history_redo: () => ({ action: 'node_update_props', files: [] })
})

beforeEach(() => {
  canvasSrc.value = 'about:blank'
  localStorage.removeItem('bildr:frames')
  model = blank()
  posted = []
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { configurable: true, get: () => frameWindow })
})

afterEach(() => {
  if (originalContentWindow) Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', originalContentWindow)
  else Reflect.deleteProperty(HTMLIFrameElement.prototype, 'contentWindow')
})

const open = async (extra: Record<string, (input: Record<string, unknown>) => unknown> = {}) => {
  const actions = mockActions({ ...handlers(), ...extra })
  const mounted = await mountWithApp(DesignView, '/design')
  await fromCanvas({ type: 'bildr:ready' })
  await sidebarTab('Layers')
  return { actions, ...mounted }
}

const layer = (id: string) => document.body.querySelector<HTMLElement>(`[data-layer-id="${id}"]`)
const control = (label: string) => document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)

describe('Design screen', () => {
  it('lists the pages, defaults to the first one and renders it in the canvas with its project context', async () => {
    await open()

    // The page switcher names the current page by its path, and the Pages panel lists them all.
    expect(document.body.querySelector('[data-page-switcher]')?.textContent).toContain('Home')
    await sidebarTab('Pages')
    expect([...document.body.querySelectorAll('[data-page-id]')].map(row => row.getAttribute('data-page-id'))).toEqual(expect.arrayContaining(['pg_index', 'pg_post_detail']))
    expect(document.body.querySelector('[data-page-id="pg_index"] button')?.getAttribute('aria-current')).toBe('page')
    await sidebarTab('Assets')
    expect(document.body.querySelector('[data-component-id="cmp_post_card"]')).not.toBeNull()
    expect(document.body.querySelector('[data-layout-id="lay_main"]')).not.toBeNull()
    const [render] = sent('bildr:render').slice(-1)
    expect(render?.file.id).toBe('pg_index')
    expect(render?.components.map(component => component.id)).toContain('cmp_post_card')
    expect(render?.layouts.map(entry => entry.id)).toContain('lay_main')
    expect(render?.theme).toBeDefined()
    expect(render?.view).toBe('page')
    // Page links point at their pages; the canvas sits on the current page's route, so its links are active.
    expect(render?.paths).toMatchObject({ pg_index: '/' })
    expect(render?.path).toBe('/')
  })

  it('ignores messages that are not from its own canvas frame and origin', async () => {
    await open()
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false }, source: window, origin: window.location.origin }))
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false }, 'https://evil.example')
    expect(inspectorHead()).toBeNull()
  })

  it('select in the canvas → layers highlight it and the inspector shows its props; the canvas is told', async () => {
    await open()
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })

    expect(layer('n_h1')?.getAttribute('aria-selected')).toBe('true')
    expect(inspectorHead()?.textContent).toContain('Heading')
    expect(inspectorHead()?.textContent).toContain('n_h1')
    expect(propInput('text')?.value).toBe('Posts')
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_h1', nodeIds: ['n_h1'] })
  })

  it('editing a prop calls node_update_props, then reads the model again and re-renders the canvas with the change', async () => {
    const { actions } = await open()
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })
    const renders = sent('bildr:render').length

    await typeInto(propInput('text'), 'Articles')

    expect(actions.named('node_update_props').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1', props: { text: 'Articles' } }])
    const last = sent('bildr:render').at(-1)!
    expect(sent('bildr:render').length).toBeGreaterThan(renders)
    expect(find(last.file.root, 'n_h1')?.props?.text).toBe('Articles')
    // The selection survives the re-render.
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_h1' })
  })

  it('writes style tokens at the device\'s breakpoint, and the base token on the primary device', async () => {
    const { actions } = await open()
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_head', shift: false, meta: false })

    await typeStyle('gap', '4')
    await chooseDevice('tablet')
    await typeStyle('gap', '8')

    // The hosted fields write the key at the device (`md:gap`) into one patch.
    const calls = actions.named('node_update_style').map(call => call.input)
    expect(calls[0]).toEqual({ file: 'pg_index', nodeIds: ['n_head'], style: { gap: '4' } })
    expect(calls[1]).toEqual({ file: 'pg_index', nodeIds: ['n_head'], style: { 'md:gap': '8' } })
    expect(sent('bildr:render').at(-1)?.breakpointBase).toBe('mobile')
  })

  it('re-renders on a model event and keeps the selection', async () => {
    await open()
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })
    find(indexPage().root, 'n_h1')!.props!.text = 'Changed on disk'
    const before = sent('bildr:render').length

    FakeEventSource.instances.at(-1)!.send({ type: 'model', version: 7, files: ['.bildr/modules/blog/pages/index.json'], source: 'disk' })
    await settle()

    expect(sent('bildr:render').length).toBeGreaterThan(before)
    expect(find(sent('bildr:render').at(-1)!.file.root, 'n_h1')?.props?.text).toBe('Changed on disk')
    expect(layer('n_h1')?.getAttribute('aria-selected')).toBe('true')
  })

  it('drops the selection of a node an event removed', async () => {
    await open()
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })
    const head = find(indexPage().root, 'n_head')!
    head.children = head.children!.filter(child => child.id !== 'n_h1')

    FakeEventSource.instances.at(-1)!.send({ type: 'regenerated', version: 8, ok: true })
    await settle()

    expect(inspectorHead()).toBeNull()
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: null, nodeIds: [] })
  })

  it('undo and redo call history_undo and history_redo, then refresh', async () => {
    const { actions } = await open()
    const reads = actions.named('model_get').length
    await click(control('Undo'))
    await click(control('Redo'))
    expect(actions.named('history_undo')).toHaveLength(1)
    expect(actions.named('history_redo')).toHaveLength(1)
    expect(actions.named('model_get').length).toBeGreaterThan(reads)
  })

  it('inserts a palette type next to the selection with node_insert, and selects the new node', async () => {
    const { actions } = await open()
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })

    await insertType('Button')

    // n_h1 is a leaf in n_head (index 0): the new node goes right after it.
    expect(actions.named('node_insert').map(call => call.input)).toEqual([{ file: 'pg_index', parentId: 'n_head', index: 1, type: 'Button' }])
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_button_1' })
  })

  it('a palette drop on the canvas inserts at the slot; a layer dropped there moves', async () => {
    const { actions } = await open()
    await fromCanvas({ type: 'bildr:drop', parentId: 'n_page', index: 1, payload: JSON.stringify({ kind: 'component', type: 'Text' }) })
    await fromCanvas({ type: 'bildr:drop', parentId: 'n_page', index: 4, payload: JSON.stringify({ kind: 'node', id: 'n_head' }) })

    expect(actions.named('node_insert').map(call => call.input)).toEqual([{ file: 'pg_index', parentId: 'n_page', index: 1, type: 'Text' }])
    // n_head is the page's first child: moving it to slot 4 is index 3 once it is out.
    expect(actions.named('node_move').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_head', parentId: 'n_page', index: 3 }])
  })

  it('renames, locks and reorders layers through node_rename, node_set_locked and node_move', async () => {
    const { actions } = await open({
      node_set_locked: (input) => {
        find(indexPage().root, String(input.nodeId))!.locked = input.locked === true
        return { changed: [] }
      }
    })
    // Cmd+L locks the selection; its row then shows a lock that unlocks it.
    await click(layer('n_h1'))
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', metaKey: true, bubbles: true }))
    await settle()
    expect(actions.named('node_set_locked').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1', locked: true }])
    expect(layer('n_h1')?.hasAttribute('data-layer-locked')).toBe(true)
    await click(layer('n_h1')!.querySelector('[data-layer-lock]'))
    expect(actions.named('node_set_locked').at(-1)?.input).toEqual({ file: 'pg_index', nodeId: 'n_h1', locked: false })

    layer('n_h1')!.querySelector('[data-layer-name]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await settle()
    const field = layer('n_h1')!.querySelector<HTMLInputElement>('[data-layer-rename]')!
    await typeInto(field, 'Title')
    field.dispatchEvent(new Event('blur'))
    await settle()
    expect(actions.named('node_rename').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1', name: 'Title' }])

    const dataTransfer = new DataTransfer()
    layer('n_about')!.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer }))
    const target = layer('n_head')!
    target.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}) })
    target.dispatchEvent(Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer, clientY: 1 }))
    target.dispatchEvent(Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer, clientY: 1 }))
    await settle()
    expect(actions.named('node_move').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_about', parentId: 'n_page', index: 0 }])
  })

  it('node actions: duplicate and delete in the inspector head (wrap and make component are the node menu\'s, see shell.test)', async () => {
    const { actions } = await open()
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })

    await click(byLabel('Duplicate', inspectorHead()!))
    expect(actions.named('node_duplicate').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1' }])
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_h1_copy' })

    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })
    await click(byLabel('Delete', inspectorHead()!))
    expect(actions.named('node_delete').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1' }])
  })

  it('the page root has no Duplicate or Delete', async () => {
    await open()
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_page', shift: false, meta: false })
    expect(inspectorHead()).not.toBeNull()
    expect(byLabel('Duplicate', inspectorHead()!)).toBeNull()
    expect(byLabel('Delete', inspectorHead()!)).toBeNull()
  })

  it('keyboard: Delete removes the selection, Cmd+Z undoes, from the canvas or the editor', async () => {
    const { actions } = await open()
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })

    await fromCanvas({ type: 'bildr:key', key: 'z', code: 'KeyZ', meta: true, shift: false, alt: false })
    expect(actions.named('history_undo')).toHaveLength(1)

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }))
    await settle()
    expect(actions.named('node_delete').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1' }])

    // Typing in a field is not a shortcut.
    await fromCanvas({ type: 'bildr:click', nodeId: 'n_h1', shift: false, meta: false })
    propInput('text')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true }))
    await settle()
    expect(actions.named('node_delete')).toHaveLength(1)
  })

  it('keeps a refused edit\'s message after a regenerated event', async () => {
    const message = 'Can\'t change n_h1: the text must be a string'
    await open({ node_update_props: () => new Failure(422, 'invalid', message) })
    await click(layer('n_h1'))
    await typeInto(propInput('text'), 'Articles')
    FakeEventSource.instances.at(-1)!.send({ type: 'regenerated', version: 9, ok: true })
    await settle()
    expect(byTestId('design-error')?.textContent?.trim()).toBe(message)
  })

  it('dismisses an action error, and the next edit clears it', async () => {
    await open({ node_update_props: () => new Failure(422, 'invalid', 'nope') })
    await click(layer('n_h1'))
    await typeInto(propInput('text'), 'Articles')
    expect(byTestId('design-error')?.textContent?.trim()).toBe('nope')
    await click(byTestId('design-error-dismiss'))
    expect(byTestId('design-error')).toBeNull()
    await typeInto(propInput('text'), 'Articles 2')
    expect(byTestId('design-error')?.textContent?.trim()).toBe('nope')
    await click(layer('n_h1'))
    await click(control('Undo'))
    expect(byTestId('design-error')).toBeNull()
  })

  it('the preview toggle switches the canvas mode', async () => {
    await open()
    await click(byTestId('preview-toggle'))
    expect(sent('bildr:mode').at(-1)).toEqual({ type: 'bildr:mode', mode: 'preview' })
    await click(byTestId('preview-toggle'))
    expect(sent('bildr:mode').at(-1)).toEqual({ type: 'bildr:mode', mode: 'edit' })
  })

  it('lists the layers of the selected file and switches file from the sidebar', async () => {
    await open()
    expect([...document.body.querySelectorAll('[data-layer-id]')].map(row => row.getAttribute('data-layer-id'))).toEqual(expect.arrayContaining(['n_page', 'n_head', 'n_h1']))
    await sidebarTab('Assets')
    await click(document.body.querySelector('[data-component-id="cmp_post_card"] button[draggable]'))
    expect(sent('bildr:render').at(-1)?.file.id).toBe('cmp_post_card')
    await sidebarTab('Layers')
    expect(layer('n_card')).not.toBeNull()
  })
})
