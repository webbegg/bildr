import { afterEach, beforeEach, vi } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { ComponentFile, LayoutFile, Model, ModelNode, PageFile } from '@bildr/codegen/model'
import { PALETTE } from '../../../codegen/src/edit/palette.ts'
import type { CanvasToEditor, EditorToCanvas } from '../../src/canvas/protocol.ts'
import { canvasSrc } from '../../src/design/config.ts'
import DesignView from '../../src/views/DesignView.vue'
import { blogModelFiles } from '../canvas/fixture.ts'
import { mockActions, mountWithApp, settle } from '../helpers.ts'
import type { AppRoutes } from '../helpers.ts'

/**
 * The Design screen's test harness (P4b, P4c): the blog fixture as the module's
 * model, a stub window for the canvas iframe the tests read the posted messages
 * from and answer as the canvas would, and a stand-in EventSource. Call
 * `setupHarness()` once at the top of a test file.
 */

const files = blogModelFiles()
const loaded = loadModel(files)
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const parsed = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, JSON.parse(text) as unknown]))

/** The model the mocked module serves, and what was posted to the canvas: replaced for each test. */
export const world: { model: Model, posted: EditorToCanvas[] } = { model: structuredClone(loaded.model), posted: [] }
export const modelGet = () => ({ ok: true, model: world.model, files: parsed, database: false })

export const catalog = () => ({
  nodeTypes: PALETTE.map(entry => ({ type: entry.type, label: entry.label, description: entry.description, container: entry.container, insertable: true, props: [], defaults: { props: entry.props, style: entry.style } })),
  styleTokens: [],
  breakpoints: { base: 'mobile', prefixes: ['sm', 'md', 'lg'] },
  colors: [],
  components: Object.values(world.model.modules).flatMap(entry => entry.components.map(component => ({ id: component.id, name: component.name, module: 'blog' }))),
  layouts: []
})

export const find = (tree: ModelNode, id: string): ModelNode | undefined => tree.id === id ? tree : tree.children?.map(child => find(child, id)).find(Boolean)
export const indexPage = (): PageFile => world.model.modules.blog!.pages.find(page => page.name === 'index')!
export const postCard = (): ComponentFile => world.model.modules.blog!.components.find(component => component.name === 'PostCard')!
export const mainLayout = (): LayoutFile => world.model.layouts.find(layout => layout.id === 'lay_main')!

/** A stand-in for the browser's EventSource. */
export class FakeEventSource {
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

// A real postMessage structured-clones its message (a Vue proxy throws DataCloneError), so the stand-in does too.
export const frameWindow = { postMessage: (message: EditorToCanvas) => world.posted.push(structuredClone(message)) }
export const sent = <T extends EditorToCanvas['type']>(type: T) => world.posted.filter((message): message is Extract<EditorToCanvas, { type: T }> => message.type === type)

/** What the canvas iframe says to the editor. */
export const fromCanvas = async (message: CanvasToEditor, origin = window.location.origin) => {
  window.dispatchEvent(new MessageEvent('message', { data: message, source: frameWindow as unknown as Window, origin }))
  await settle()
}

export const select = (nodeId: string) => fromCanvas({ type: 'bildr:click', nodeId, shift: false, meta: false })

const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')

export type Handlers = Record<string, (input: Record<string, unknown>) => unknown>

export const baseHandlers = (): Handlers => ({
  model_get: modelGet,
  catalog_get: catalog,
  history_get: () => ({ undo: [], redo: [] }),
  editor_context_set: () => ({ ok: true })
})

export const setupHarness = () => {
  beforeEach(() => {
    canvasSrc.value = 'about:blank'
    world.model = structuredClone(loaded.model)
    world.posted = []
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { configurable: true, get: () => frameWindow })
  })
  afterEach(() => {
    if (originalContentWindow) Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', originalContentWindow)
    else Reflect.deleteProperty(HTMLIFrameElement.prototype, 'contentWindow')
  })
}

/** A layers row of the hosted editor (`data-layer-id`), shown while the sidebar is on Layers. */
export const layer = (id: string) => document.body.querySelector<HTMLElement>(`[data-layer-id="${id}"]`)

/** Opens the Insert panel from the toolbar (the palette), if it is not open. */
const openInsert = async () => {
  if (!document.body.querySelector('[data-insert-panel]')) {
    document.body.querySelector<HTMLElement>('[data-insert-button]')!.click()
    await settle()
  }
}

/** Inserts a built-in node type from the Insert panel, as a click on its row does. */
export const insertType = async (type: string) => {
  await openInsert()
  const row = document.body.querySelector<HTMLElement>(`[data-palette-type="${type}"]`)
  if (!row) throw new Error(`no palette row for ${type}`)
  row.click()
  await settle()
}

/** Inserts an instance of a component from the Insert panel's tiles. */
export const insertComponent = async (id: string) => {
  await openInsert()
  const tile = document.body.querySelector<HTMLElement>(`[data-palette-component="${id}"]`)
  if (!tile) throw new Error(`no palette tile for ${id}`)
  tile.click()
  await settle()
}

/** Opens a dropdown from its trigger and picks the item whose text starts with `label`, as a user does. */
export const menuItem = async (trigger: Element | null, label: string) => {
  if (!trigger) throw new Error('no menu trigger')
  // The keyboard opens it (happy-dom's pointer events don't reach the trigger's handler).
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  const item = [...document.body.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(element => element.textContent?.trim().startsWith(label))
  if (!item) throw new Error(`no menu item ${label}`)
  item.click()
  await settle()
}

/** Picks a sidebar tab (Pages, Layers or Assets) as a user does. */
export const sidebarTab = async (name: 'Pages' | 'Layers' | 'Assets') => {
  const tab = [...document.body.querySelectorAll<HTMLElement>('[data-sidebar-switcher] [role="tab"]')].find(element => element.textContent?.trim() === name)
  if (!tab) throw new Error(`no sidebar tab ${name}`)
  tab.click()
  await settle()
}

/** Opens the Design view (the theme) from the Assets panel's Design system row, as a user does. */
export const openDesignSystem = async () => {
  await sidebarTab('Assets')
  const row = document.body.querySelector<HTMLElement>('[data-assets-design-system]')
  if (!row) throw new Error('no Design system row')
  row.click()
  await settle()
}

/** Opens a page (Pages), a component or a layout (Assets) by clicking its sidebar row; leaves the sidebar on Layers. */
export const openFile = async (file: string) => {
  const row = (selector: string) => {
    const element = document.body.querySelector<HTMLElement>(selector)
    if (!element) throw new Error(`no sidebar row for ${file}`)
    return element
  }
  if (world.model.layouts.some(entry => entry.id === file)) {
    await sidebarTab('Assets')
    row(`[data-layout-id="${file}"] button`).click()
  } else if (Object.values(world.model.modules).some(entry => entry.components.some(component => component.id === file))) {
    await sidebarTab('Assets')
    row(`[data-component-id="${file}"] button[draggable]`).click()
  } else {
    await sidebarTab('Pages')
    row(`[data-page-id="${file}"] button`).click()
  }
  await settle()
  await sidebarTab('Layers')
}

/** Mounts the Design screen with the base handlers plus `extra`, and opens `file` (the first page by default); the sidebar shows the layers. */
export const open = async (extra: Handlers = {}, file?: string, routes: AppRoutes = {}) => {
  const actions = mockActions({ ...baseHandlers(), ...extra }, routes)
  const mounted = await mountWithApp(DesignView, '/design')
  await fromCanvas({ type: 'bildr:ready' })
  if (file) await openFile(file)
  else await sidebarTab('Layers')
  return { actions, ...mounted }
}

/** Picks `value` in a native select (by test id) and fires `change`, as a user would. */
export const choose = async (testId: string, value: string) => {
  const element = document.body.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`no select ${testId}`)
  element.value = value
  element.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}

/** Ticks a native checkbox (by test id) and fires `change`. */
export const check = async (testId: string, on: boolean) => {
  const element = document.body.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`no checkbox ${testId}`)
  element.checked = on
  element.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}
