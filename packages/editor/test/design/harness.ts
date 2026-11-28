import { afterEach, beforeEach, vi } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { ComponentFile, LayoutFile, Model, ModelNode, PageFile } from '@bildr/codegen/model'
import { PALETTE } from '../../../codegen/src/edit/palette.ts'
import type { CanvasToEditor, EditorToCanvas } from '../../src/canvas/protocol.ts'
import { canvasSrc } from '../../src/design/config.ts'
import DesignView from '../../src/views/DesignView.vue'
import { blogModelFiles } from '../canvas/fixture.ts'
import { DEVICES } from '@bildr/editor-core/styleFields'
import type { DeviceId } from '@bildr/editor-core/styleFields'
import { click, mockActions, mountWithApp, settle } from '../helpers.ts'
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
  nodeTypes: PALETTE.map(entry => ({ type: entry.type, ...(entry.preset ? { preset: entry.preset } : {}), label: entry.label, description: entry.description, container: entry.container, insertable: true, props: [], defaults: { props: entry.props, style: entry.style } })),
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
const stubWindow = () => ({ postMessage: (message: EditorToCanvas) => world.posted.push(structuredClone(message)) })
export const frameWindow = stubWindow()
export const sent = <T extends EditorToCanvas['type']>(type: T) => world.posted.filter((message): message is Extract<EditorToCanvas, { type: T }> => message.type === type)

/** Each canvas iframe is its own window, as in the browser (the editor tells its frames apart by `event.source`). */
const frameWindows = new WeakMap<object, ReturnType<typeof stubWindow>>()
const windowOf = (frame: object) => {
  if (!frameWindows.has(frame)) frameWindows.set(frame, stubWindow())
  return frameWindows.get(frame)!
}
/** The canvas iframes of the editor: the active frame (titled `Canvas`) first, the others in the DOM's order. */
export const frames = () => [...document.body.querySelectorAll<HTMLIFrameElement>('iframe')].sort((a, b) => Number(b.title === 'Canvas') - Number(a.title === 'Canvas'))

/** What a canvas iframe says to the editor: the active frame's by default. */
export const fromCanvas = async (message: CanvasToEditor, origin = window.location.origin, frame: HTMLIFrameElement | undefined = frames()[0]) => {
  window.dispatchEvent(new MessageEvent('message', { data: message, source: (frame ? windowOf(frame) : frameWindow) as unknown as Window, origin }))
  await settle()
}

/** Every frame announces it has loaded, as each iframe of the board does. */
export const readyAll = async () => {
  for (const frame of frames()) await fromCanvas({ type: 'bildr:ready' }, undefined, frame)
}

export const select = (nodeId: string) => fromCanvas({ type: 'bildr:click', nodeId, shift: false, meta: false })

/** Selects a node by its layers row: the layers reach nodes inside a lock, which a canvas click does not (it selects the lock's parent). */
export const selectLayer = async (nodeId: string) => click(document.body.querySelector<HTMLElement>(`[data-layer-id="${nodeId}"]`))

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
    // The visible frames and the single-frame choice are editor preferences kept across reloads: each test starts clean.
    localStorage.removeItem('bildr:frames')
    localStorage.removeItem('bildr:canvas-frames')
    world.model = structuredClone(loaded.model)
    world.posted = []
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get(this: HTMLIFrameElement) {
        return windowOf(this)
      }
    })
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

/** Opens the Design view (the theme) from the Assets panel's Design system row, as a user does; its style guide is a canvas of its own, which then loads. */
export const openDesignSystem = async () => {
  await sidebarTab('Assets')
  const row = document.body.querySelector<HTMLElement>('[data-assets-design-system]')
  if (!row) throw new Error('no Design system row')
  row.click()
  await settle()
  await fromCanvas({ type: 'bildr:ready' }, undefined, document.body.querySelector<HTMLIFrameElement>('iframe[title="Token preview"]') ?? undefined)
}

/**
 * Edits another device as a user does on the canvas: a visible frame by its header bar, a hidden one from the "+" of a
 * bar (which shows it). The device frames are `data-frame` blocks, each with its `data-frame-label`.
 */
export const chooseDevice = async (id: DeviceId) => {
  const label = document.body.querySelector<HTMLElement>(`[data-frame="${id}"] [data-frame-label]`)
  if (label) return click(label)
  const add = document.body.querySelector<HTMLElement>('[data-frame-add] button')
  if (!add) throw new Error(`no frame bar to add ${id} from`)
  await menuItem(add, DEVICES.find(device => device.id === id)!.label)
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

/** A prop row of the hosted inspector (`data-prop-row`), e.g. `text` of a Heading. */
export const propRow = (name: string) => document.body.querySelector<HTMLElement>(`[data-prop-row="${name}"]`)

/** The text input of a prop row. */
export const propInput = (name: string) => propRow(name)?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? null

/** The inspector's head (`data-inspector-head`): the node's name and id, its breadcrumb and Duplicate and Delete. */
export const inspectorHead = () => document.body.querySelector<HTMLElement>('[data-inspector-head]')

/** A style field of the inspector (`data-style-key`, the token's key), e.g. `p`. */
export const styleField = (key: string) => document.body.querySelector<HTMLElement>(`[data-style-key="${key}"]`)

/** Types into a style scale field as a user does (focus, type, blur) and waits for the commit. */
export const typeStyle = async (key: string, value: string) => {
  const input = styleField(key)?.querySelector<HTMLInputElement>('input')
  if (!input) throw new Error(`no style field ${key}`)
  input.dispatchEvent(new Event('focus'))
  await settle()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('blur'))
  await settle()
}

/** A control by its accessible name, inside `within` (the document by default). */
export const byLabel = (label: string, within: ParentNode = document.body) => within.querySelector<HTMLElement>(`[aria-label="${label}"]`)

/** Opens a dropdown from its trigger (the keyboard does, happy-dom's pointer events don't reach it) and lists its items' labels (their first line). */
export const menuLabels = async (trigger: Element | null) => {
  if (!trigger) throw new Error('no menu trigger')
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  return [...document.body.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map(item => item.querySelector<HTMLElement>('[data-slot="itemLabel"]')?.textContent?.trim() ?? item.textContent?.trim() ?? '')
}

/** The braces button of a prop row's text field (EditorVariablePicker). */
export const variablePicker = (name: string) => propRow(name)?.querySelector<HTMLElement>('[data-variable-picker]') ?? null

/** The rows of the open data picker (EditorVariablePicker's popover): each one's label, without the suffix saying what it is. */
export const pickerLabels = () => [...document.body.querySelectorAll<HTMLElement>('[data-data-picker] [role="option"]')]
  .map(option => option.querySelector<HTMLElement>('[data-slot="itemLabelBase"]')?.textContent?.trim() ?? '')

/** Opens the data picker of a prop row's text field, as a user does, and answers its first level: the sources. */
export const openPicker = async (name: string) => {
  const trigger = variablePicker(name)
  if (!trigger) throw new Error(`no data picker on ${name}`)
  trigger.click()
  await settle()
  return pickerLabels()
}

/** The row of the open data picker labelled `label` exactly. */
export const pickerRow = (label: string) => [...document.body.querySelectorAll<HTMLElement>('[data-data-picker] [role="option"]')]
  .find(option => option.querySelector('[data-slot="itemLabelBase"]')?.textContent?.trim() === label)

/** Picks the row `label` of the open data picker (a source or a nested model opens its fields), and answers the rows then shown. */
export const pickerPick = async (label: string) => {
  const row = pickerRow(label)
  if (!row) throw new Error(`no picker row ${label}: ${pickerLabels().join(', ')}`)
  row.click()
  await settle()
  return pickerLabels()
}

/** Types into the open data picker's search, and answers the rows then shown. */
export const pickerSearch = async (term: string) => {
  const input = document.body.querySelector<HTMLInputElement>('[data-data-picker] input')
  if (!input) throw new Error('no data picker search')
  input.value = term
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  return pickerLabels()
}

/** Puts the caret at the end of a prop row's text, where the variable picker types. */
export const caretAtEnd = (name: string) => {
  const input = propInput(name)
  if (input) input.setSelectionRange(input.value.length, input.value.length)
}

/** Clicks the item of the open dropdown whose text starts with `label`. */
export const pickOpenItem = async (label: string) => {
  const item = [...document.body.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(element => element.textContent?.trim().startsWith(label))
  if (!item) throw new Error(`no menu item ${label}`)
  item.click()
  await settle()
}

/** Picks `label` in a kit select (USelect) by its trigger: the keyboard opens it, then the option is clicked. */
export const selectOption = async (trigger: Element | null, label: string) => {
  if (!trigger) throw new Error('no select trigger')
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(element => element.textContent?.trim().startsWith(label))
  if (!option) throw new Error(`no option ${label}`)
  option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  option.click()
  await settle()
}

/** The select trigger of a prop row. */
export const propSelect = (name: string) => propRow(name)?.querySelector<HTMLElement>('[role="combobox"]') ?? null

/** Resets a style field to what it was before this device (alt-click on its blue label, as the user does). */
export const resetStyle = async (key: string) => {
  const label = document.body.querySelector<HTMLElement>(`[data-field-label="${key}"] [data-field-state="set"]`)
  if (!label) throw new Error(`style field ${key} has no override to reset`)
  label.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))
  await settle()
}

/** Types a number into a kit number field (UInputNumber) as a user does: type, then leave the field. */
export const typeNumber = async (element: HTMLElement | null, value: string) => {
  const input = element?.matches('input') ? element as HTMLInputElement : element?.querySelector<HTMLInputElement>('input')
  if (!input) throw new Error('no number input')
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('blur'))
  await settle()
}

/** The element a selector finds in the document, or an error naming it. */
export const must = (selector: string): HTMLElement => {
  const element = document.body.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element
}

/** The input (or textarea) a selector finds: the element itself, or the one inside it. */
export const inputOf = (selector: string): HTMLInputElement => {
  const element = must(selector)
  return (element.matches('input, textarea') ? element : element.querySelector('input, textarea')) as HTMLInputElement
}

/** Shows variant `id` (null: the primary) of the component being edited, by its row in the Variants section (with nothing selected the panel shows only a hint, as the hosted editor's does, so the root is selected first). */
export const showVariant = async (id: string | null) => {
  const row = `[data-variant-row="${id ?? 'primary'}"] button[aria-pressed]`
  if (!document.body.querySelector(row)) {
    const owner = Object.values(world.model.modules).flatMap(entry => entry.components).find(component => id === null || component.variants.some(variant => variant.id === id))
    if (owner) await select(owner.root.id)
  }
  must(row).click()
  await settle()
}

/** The "+" of a panel section (`data-component-variants`, `data-component-properties`…). */
export const sectionAdd = (section: string) => must(`[${section}] [data-section-action="add"]`)

/** The trigger of a kit select (USelect) found by a selector: the select itself, or the combobox inside it. */
export const combo = (selector: string): HTMLElement => {
  const element = must(selector)
  return element.matches('[role="combobox"]') ? element : element.querySelector<HTMLElement>('[role="combobox"]') ?? element
}

/** Picks `label` in New collection's connection list (REST API): the project's connections, or "New connection…". */
export const chooseConnection = (label: string) => selectOption(combo('[data-new-collection-connection]'), label)

/** Flips a kit switch (USwitch) found by a selector: the switch itself, or the button inside it. */
export const toggle = async (selector: string) => {
  const element = must(selector)
  const button = element.matches('button') ? element : element.querySelector<HTMLElement>('button') ?? element
  button.click()
  await settle()
}

/** The labels of a kit select's options, once the keyboard has opened it (the menu is left open). */
export const optionLabels = async (trigger: Element | null) => {
  if (!trigger) throw new Error('no select trigger')
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  return [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].map(option => option.querySelector<HTMLElement>('[data-slot="itemLabel"]')?.textContent?.trim() ?? option.textContent?.trim() ?? '')
}
