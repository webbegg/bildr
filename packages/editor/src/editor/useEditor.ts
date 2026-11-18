import { computed, inject, provide, reactive, ref, shallowRef, watch } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import type { Theme, ThemePatch } from '@bildr/codegen/design'
import type { ComponentFile, LayoutFile, ModelNode, PageFile, Value } from '@bildr/codegen/model'
import { isFlexType } from '@bildr/codegen/render'
import { inferAutoLayout, nearestSpacingToken } from '@bildr/editor-core/autoLayout'
import type { NodeBox } from '@bildr/editor-core/autoLayout'
import { goToLevel, leaveLevel, openLevel, pruneLevels, topLevel } from '@bildr/editor-core/editStack'
import type { EditKind, EditLevel, LevelMove } from '@bildr/editor-core/editStack'
import { canHideFrame, frameForKey, hiddenFrames, primaryFrame, visibleFrames } from '@bildr/editor-core/frames'
import { componentPrefill, uniqueName } from '@bildr/editor-core/names'
import { createStylePreview } from '@bildr/editor-core/preview'
import type { PreviewState, StylePatch } from '@bildr/editor-core/preview'
import type { SpacingOverlay } from '@bildr/editor-core/protocol'
import type { DeviceId } from '@bildr/editor-core/styleFields'
import { previewWindowFeatures } from '@bildr/editor-core/viewport'
import type { ZoomCommand } from '@bildr/editor-core/viewport'
import { callAction } from '../api.ts'
import { containsNode, findNode, findParent } from '../design/tree.ts'
import type { Design } from '../design/store.ts'
import { collapsedAncestors, insertableComponents, movesIntoItself, moveSlot, outsideInstance, parseDragPayload, parseInstancePayload, parseLayoutPayload, siblingMove, siblingMoves } from './drop.ts'
import type { DropTarget } from './drop.ts'
import { createFrames } from './frames.ts'
import { layoutSelection, pageSlots, previewPageFor } from './layouts.ts'
import { hasRouteParams, previewOf } from './preview.ts'
import { canvasMovable, drillTarget, escapeSelection, navigateSelection, nearestUnlocked, selectAllSiblings, selectionAfterDelete, siblingParent, toggleSelection, topLevelSelection } from './selection.ts'
import type { SelectionStep } from './selection.ts'
import { isInsertTool, MOVE_TOOL, selectionAccent, toolForKey } from './tools.ts'
import type { ToolId } from './tools.ts'
import type { UseEntry } from '../shared/dataArtifacts.ts'
import type { PendingMigration } from '../types.ts'
import { interactionKey, parseInteractionKey } from '../shared/interactionPanel.ts'
import { layerName } from '../shared/layers.ts'
import { createDataView } from './dataView.ts'
import { carryFile, carryPage, requestView, screenOf, takeStart } from './views.ts'
import type { DataRequest } from './views.ts'
import { boardShown, newVariantName, overrideInput, variantStylePatch } from './variants.ts'
import type { NodeOverridePatch, OverridePatch } from './variants.ts'

/**
 * `useEditor()` over the module (U2, decision U-E1): the hosted editor's
 * `useEditor` surface (`app/composables/useEditor.ts`, names, argument shapes and
 * a `reactive({...})` object whose members read without `.value`), backed by
 * `createDesign()` and the `.bildr` module actions instead of the hosted document.
 *
 * - Node data stays a `ModelNode`: there is no `DocNode` and no converter. Where the
 *   hosted editor read a `DocNode` field, the member gives the model's (see each
 *   member's comment).
 * - Every write is one module action through the store's `edit` (so undo, the event
 *   stream and the guard are the store's); the adapter only decides which action and
 *   what to select afterwards.
 * - UI state (tool, zoom requests, collapsed rows, dialogs, the breadcrumb) lives here
 *   as plain refs; the project's state (selection, file, variant, device) is the store's.
 */

/** Identifies a toast the adapter asks the shell to show (the hosted editor called `useToast`). */
export interface EditorToast {
  title: string
  description?: string
  color?: 'error' | 'warning' | 'success'
  icon?: string
}

export interface EditorOptions {
  /** Shows a toast. The hosted `useToast().add`; without it notices are dropped. */
  toast?: (toast: EditorToast) => void
  /** The view the editor starts on (the Data screen starts on `data`); default: the one that asked for this screen, else Canvas. */
  view?: EditorView
  /** The pending migration plan, when the project has a database to run it on (`status.plan`): what the Data workspace shows where the collections it changes are (S6). Default: none. */
  plan?: Ref<PendingMigration | null>
}

/** A confirm dialog (EditorConfirm) the editor asks instead of the browser's `confirm()`. */
export interface ConfirmOptions {
  title: string
  description?: string
  /** Lines listed under the description, e.g. where a component is used. */
  items?: string[]
  /** The places that use what is deleted or renamed, each a link that opens it (and answers no); the ones the module changes along with it say so. */
  uses?: UseEntry[]
  /** The change cannot go on: there is nothing to confirm, so the dialog has one Close button (which answers no) and no confirm button. */
  blocked?: boolean
  confirmLabel: string
  danger?: boolean
}

/** The "New component" / "New layout" dialog (EditorCreateDialog): the kind, and the name it opens with. */
export interface CreateRequest {
  kind: EditKind
  name: string
  /** The page nodes a component is made from, or a layout wraps around its children slot, in document order. */
  nodeIds: string[]
}

/** The "<Component> properties" / "<Layout> variables" modal: whose, the property shown, and whether its name field takes the focus. */
export interface PropertiesRequest {
  kind: EditKind
  id: string
  propertyId: string | null
  focusName: boolean
}

export type EditorView = 'build' | 'data' | 'design' | 'settings'
export type SidebarPanel = 'pages' | 'layers' | 'assets'
export type WrapType = 'Container' | 'Row' | 'Column' | 'Card' | 'Grid'
export type InteractionEvent = 'click' | 'mouseenter' | 'mouseleave' | 'appear'
export type StateKind = 'hover' | 'pressed'
export type Transition = { type: 'instant' } | { type: 'ease', duration?: number, easing?: string } | { type: 'spring', stiffness?: number, damping?: number }

/** An env var the data sources read, as `env_status` lists it (no values: the user edits `.env`). */
export interface EnvStatusEntry {
  name: string
  set: boolean
  /** Where it is set: the process env, the project's `.env`, or nowhere. */
  from: 'env' | '.env' | null
  /** The data source that reads it, and the setting of it (`baseUrl`, `secret`...). */
  datasource?: string
  setting?: string
  /** The auth secret. */
  secret?: boolean
  /** The model has a non-secret default for it, used when it is not set. */
  hasDefault?: boolean
  [key: string]: unknown
}

const DEEP_KEY = 'bildr:deep-select'
const DARK_KEY = 'bildr:canvas-dark'

const stored = (key: string): string | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the setting lasts for this session.
  }
}

/** An interaction has no id in the model: it is the `index`th of its variant (`''` the primary), written `<variant>:<index>` (see `shared/interactionPanel.ts`). */
export { interactionKey, parseInteractionKey }

export const createEditor = (design: Design, options: EditorOptions = {}) => {
  const notify = options.toast ?? (() => undefined)
  const notAvailable = (what: string) => {
    design.error.value = `${what} is not available yet`
  }

  // ── The model, the file being edited and the breadcrumb ─────────────────

  const model = design.model
  const pages = computed<PageFile[]>(() => Object.values(model.value?.modules ?? {}).flatMap(entry => entry.pages))
  /** The page the editor is on, also while the component or layout view shows. */
  const lastPage = ref<string | null>(null)
  /** The breadcrumb's levels over the page (`Home › Card › Button`); its top is the component or layout shown. */
  const editStack = ref<EditLevel[]>([])
  const currentPage = computed<PageFile | null>(() => pages.value.find(entry => entry.id === lastPage.value) ?? pages.value[0] ?? null)
  const pageId = computed(() => currentPage.value?.id ?? null)
  const component = computed<ComponentFile | null>(() => design.component.value)
  const layout = computed<LayoutFile | null>(() => design.fileKind.value === 'layout' ? design.file.value as LayoutFile : null)
  const componentId = computed(() => component.value?.id ?? null)
  const layoutId = computed(() => layout.value?.id ?? null)
  /** The tree the Canvas, the layers and the panel edit: the page, component or layout file, as authored (the canvas applies the active variant). */
  const page = design.file
  const root = () => design.file.value?.root

  // The file changed under the adapter (an `editor_navigate` event, a deleted file): the breadcrumb follows it.
  watch(design.fileId, (id) => {
    if (!id) return
    const kind = design.files.value.find(entry => entry.id === id)?.kind
    if (kind === 'page') {
      lastPage.value = id
      if (editStack.value.length) editStack.value = []
    } else if (kind && topLevel(editStack.value)?.id !== id) {
      editStack.value = [{ kind, id, back: [] }]
    }
  }, { flush: 'sync', immediate: true })

  const select = (ids: string[]) => design.select(ids)
  /** The selection in the order it was made; Shift+click adds and removes nodes. Setting it selects those nodes. */
  const selectedIds = computed<string[]>({ get: () => design.selectedIds.value, set: select })
  /** The primary (last selected) node. Setting it selects only it. */
  const selectedId = computed<string | null>({ get: () => design.selectedId.value, set: id => select(id ? [id] : []) })
  /** The primary selected node as the active variant shows it (its overrides applied), as the hosted `selected` is. */
  const selected = design.inspected
  const selectedNodes = computed<ModelNode[]>(() => {
    const tree = root()
    return tree ? selectedIds.value.map(id => findNode(tree, id)).filter(node => node !== undefined) : []
  })
  const hoveredId = design.hoveredId

  /** Makes `stack` the breadcrumb: its top is the tree the Canvas edits; `restore` (when not null) becomes the selection. */
  const applyStack = ({ stack, restore }: LevelMove) => {
    editStack.value = stack
    design.hoveredId.value = null
    const target = topLevel(stack)?.id ?? lastPage.value
    if (target) design.openFile(target)
    const tree = root()
    if (restore) select(restore.filter(id => !!tree && !!findNode(tree, id)))
  }

  // A component or layout deleted here or elsewhere leaves its level (and the ones opened from it).
  watch(model, (next) => {
    if (!next) return
    const components = Object.values(next.modules).flatMap(entry => entry.components)
    const kept = pruneLevels(editStack.value, level => (level.kind === 'component' ? components : next.layouts).some(item => item.id === level.id))
    if (kept !== editStack.value) applyStack({ stack: kept, restore: [] })
  }, { flush: 'sync' })

  /** Shows a page; it also leaves the component and layout views. */
  const selectPage = (id: string) => {
    lastPage.value = id
    carryPage(id)
    applyStack({ stack: [], restore: [] })
  }

  // The Data view is its own screen (`views.ts`): choosing a view the other screen shows opens that screen, which starts on it.
  const handed = takeStart(options.view ? screenOf(options.view) : 'design')
  const mode = ref<EditorView>(options.view ?? handed.view ?? 'build')
  const screen = screenOf(mode.value)
  /** The dialog the Data view is asked to open (Import from URL, New collection): a new request each time, so the view answers each once. */
  const dataRequest = ref<DataRequest | null>(screen === 'data' ? handed.data.dataRequest ?? null : null)
  const requestData = (kind: DataRequest['kind']) => {
    dataRequest.value = { kind, seq: (dataRequest.value?.seq ?? 0) + 1 }
  }
  // `confirm` is made below: it is only asked once the editor is in use.
  const data = createDataView(design, mode, options => confirm(options), options.plan ?? ref(null))
  if (screen === 'data') data.collectionId.value = handed.data.collectionId ?? null
  watch(mode, view => requestView(view, screen, { pageId: lastPage.value, collectionId: data.collectionId.value, dataRequest: dataRequest.value }), { flush: 'sync' })

  /** Opens a component in the component view, selecting `nodeId`. `nested` pushes it onto the breadcrumb; from Assets or ⌘K it replaces the levels. */
  const editComponent = (id: string, nodeId: string | null = null, { nested = false }: { nested?: boolean } = {}) => {
    if (!design.components.value.some(entry => entry.id === id)) return
    mode.value = 'build'
    carryFile(id)
    applyStack({ stack: openLevel(editStack.value, { kind: 'component', id }, selectedIds.value, { nested }), restore: null })
    selectedId.value = nodeId
  }

  /** Opens a layout in the layout view, selecting `nodeId`; it replaces the breadcrumb's levels. */
  const editLayout = (id: string, nodeId: string | null = null) => {
    if (!design.layouts.value.some(entry => entry.id === id)) return
    mode.value = 'build'
    carryFile(id)
    applyStack({ stack: openLevel(editStack.value, { kind: 'layout', id }, selectedIds.value), restore: null })
    selectedId.value = nodeId
  }

  /** Done, or Esc with nothing selected: up one breadcrumb level, selecting what it was opened from. */
  const leaveView = () => {
    if (editStack.value.length) applyStack(leaveLevel(editStack.value))
  }
  /** A breadcrumb click: back to that level (-1 is the page). */
  const goToCrumb = (index: number) => {
    if (index < editStack.value.length - 1) applyStack(goToLevel(editStack.value, index))
  }
  const exitLayout = () => {
    if (layoutId.value) leaveView()
  }
  const exitComponent = () => {
    if (componentId.value) leaveView()
  }

  // ── Dialogs ─────────────────────────────────────────────────────────────

  const createRequest = shallowRef<CreateRequest | null>(null)
  const propertiesRequest = shallowRef<PropertiesRequest | null>(null)
  const confirmRequest = shallowRef<(ConfirmOptions & { answer: (ok: boolean) => void }) | null>(null)

  /** Asks the user through the kit's confirm dialog (EditorConfirm); resolves false when dismissed. */
  const confirm = (confirmOptions: ConfirmOptions): Promise<boolean> => {
    confirmRequest.value?.answer(false)
    return new Promise((resolve) => {
      confirmRequest.value = {
        ...confirmOptions,
        answer: (ok) => {
          confirmRequest.value = null
          resolve(ok)
        }
      }
    })
  }

  // ── View and canvas UI state ────────────────────────────────────────────

  const spacingOverlay = ref<SpacingOverlay | null>(null)
  const tool = ref<ToolId>(MOVE_TOOL)
  /** On: a canvas click selects the innermost element. Off: Figma's drill (the first click selects a top-level element). */
  const deepSelect = ref(stored(DEEP_KEY) !== 'off')
  /** The canvas frames preview the project's dark colours; a view setting, never saved in the project. */
  const previewDark = design.dark
  if (stored(DARK_KEY) === 'on') previewDark.value = true
  /** Layers rows whose children are hidden; kept in memory only. */
  const collapsed = ref(new Set<string>())
  const renamingId = ref<string | null>(null)
  const insertOpen = ref(false)
  const searchRequest = ref(0)
  const sidebarPanel = ref<SidebarPanel>('pages')
  const quickOpen = ref(false)
  const zoomRequest = shallowRef<{ command: ZoomCommand } | null>(null)
  const variablesRequest = ref(0)
  const interactionId = ref<string | null>(null)
  const boardChoices = ref<Record<string, boolean>>({})
  const themeDraft = shallowRef<Theme | null>(null)
  const stylePreview = shallowRef<PreviewState | null>(null)
  const styles = createStylePreview((state) => {
    stylePreview.value = state
  })
  let measurer: ((nodeIds: string[]) => Promise<NodeBox[]>) | null = null

  const breakpointBase = design.base
  const deviceId = computed<DeviceId>({ get: () => design.device.value.id, set: id => design.chooseDevice(id) })
  const frameRequest = shallowRef<{ deviceId: DeviceId } | null>(null)
  const visibility = createFrames(breakpointBase)
  const frames = computed<readonly DeviceId[]>(() => visibility.shown.value)
  const visibleDevices = computed(() => visibleFrames(frames.value, breakpointBase.value))
  const hiddenDevices = computed(() => hiddenFrames(frames.value, breakpointBase.value))
  const theme = computed<Theme>(() => themeDraft.value ?? design.theme.value)

  const canvasAccent = computed(() => selectionAccent(!!(componentId.value || layoutId.value), selectedNodes.value.map(node => node.type)))
  const variantBoard = computed(() => !!component.value && boardShown(boardChoices.value[component.value.id], component.value.variants.length))

  /** The `file` the node actions take for the tree being edited (the hosted `treeRef` was `{pageId}`, `{componentId}` or `{layoutId}`). */
  const treeRef = computed(() => ({ file: design.fileId.value }))

  /** What the layers and the inspector call a node: its layer name, an instance's component's name, else its type. */
  const nodeName = (node: ModelNode): string => {
    const file = design.file.value
    return file ? layerName({ root: file.root, ...('layout' in file && typeof file.layout === 'string' ? { layout: file.layout } : {}) }, node, { components: design.components.value, layouts: design.layouts.value }) : design.nameOf(node) ?? node.type
  }

  /** The draft preview of the current page in the app the dev server runs: its path, a detail page's with the picked record (else the first) filled in; none (with a hint) when no record can fill it. */
  const preview = computed(() => previewOf(currentPage.value, design.detail.value, design.record.value))
  const previewUrl = computed(() => preview.value.url)
  const previewHint = computed(() => preview.value.hint)

  // Switching view returns to Move and closes Insert: the insert tools work on the Canvas only.
  watch(mode, () => {
    tool.value = MOVE_TOOL
    insertOpen.value = false
  }, { flush: 'sync' })

  // A selection made elsewhere (e.g. a canvas click) opens the collapsed rows hiding it.
  watch(design.selectedIds, (ids) => {
    const tree = root()
    const hidden = tree ? ids.flatMap(id => collapsedAncestors(tree, collapsed.value, id)) : []
    if (hidden.length) collapsed.value = new Set([...collapsed.value].filter(row => !hidden.includes(row)))
  }, { flush: 'sync' })

  // A preview belongs to the nodes being styled; so does a spacing overlay (its panel row may unmount under the pointer).
  watch([design.selectedIds, () => page.value?.id], () => {
    if (stylePreview.value) styles.preview(stylePreview.value.nodeId, null)
    spacingOverlay.value = null
  }, { flush: 'sync' })

  // An interaction has no id: its key is its place in the owner's list. A new component, variant list, undo or model event that adds or removes a row of the owner moves it, so the selection is dropped (never left on another interaction).
  const interactionCount = (key: string | null): number | null => {
    const parsed = key ? parseInteractionKey(key) : null
    if (!parsed) return null
    const owner = parsed.variantId ? component.value?.variants.find(entry => entry.id === parsed.variantId) : component.value
    return owner?.interactions?.length ?? null
  }
  let selectedInteractionCount: number | null = null
  watch(interactionId, (key) => {
    selectedInteractionCount = interactionCount(key)
  }, { flush: 'sync' })
  watch(() => [component.value?.id, component.value], () => {
    const parsed = interactionId.value ? parseInteractionKey(interactionId.value) : null
    if (!parsed) return
    const owner = parsed.variantId ? component.value?.variants.find(entry => entry.id === parsed.variantId) : component.value
    if (!owner?.interactions?.[parsed.index] || owner.interactions.length !== selectedInteractionCount) interactionId.value = null
  }, { flush: 'sync' })

  // ── Running actions ─────────────────────────────────────────────────────

  /** Runs a module action; a refusal sets the store's `error` and returns undefined. The hosted `run` toasted it. */
  const run = (name: string, input: Record<string, unknown> = {}) => design.edit(name, input)
  /** Like `run`, scoped to the tree being edited (node actions): `file` is the page, component or layout. */
  const runOnPage = (name: string, input: Record<string, unknown> = {}) => design.edit(name, { file: design.fileId.value, ...input })
  const reload = () => design.refresh()

  // ── Edits of a node ─────────────────────────────────────────────────────

  /** Inserts a palette component (at the selection by default, never inside an instance) and selects it. */
  const insert = async (type: string, target?: DropTarget, props?: Record<string, Value>) => {
    const tree = root()
    if (!tree) return
    await design.insert({ type, ...(props ? { props } : {}) }, target ? outsideInstance(tree, target) : undefined)
  }

  /** Inserts an instance of a component (at the selection by default) and selects it; a component never goes into itself. */
  const insertInstance = async (id: string, target?: DropTarget) => {
    const current = model.value
    const tree = root()
    if (!current || !tree || !insertableComponents(current, componentId.value).some(entry => entry.id === id)) return
    await design.insertComponent(id, target ? outsideInstance(tree, target) : undefined)
  }

  const setTool = (id: ToolId) => {
    tool.value = id
  }

  /** A canvas click with an insert tool armed: inserts its component there, selects it and returns to Move, like Figma. */
  const insertWithTool = async (target: DropTarget) => {
    const type = tool.value
    if (!isInsertTool(type)) return
    tool.value = MOVE_TOOL
    await insert(type, target)
  }

  /** Sets the current page's layout (null: none), asking first when the page would lose its layout values or own slot content. */
  const setPageLayout = async (id: string | null) => {
    const current = currentPage.value
    if (!current || id === (current.layout ?? null)) return
    const old = design.layouts.value.find(entry => entry.id === current.layout)
    const filled = old ? pageSlots(old, current).filter(entry => entry.filled) : []
    const loses = !!Object.keys(current.layoutValues ?? {}).length || filled.length > 0
    if (loses && !await confirm({
      title: 'Change the layout?',
      description: `${current.name} drops its layout values and its own slot content. Undo brings them back.`,
      items: filled.map(entry => `${entry.slot.name}: own content`),
      confirmLabel: 'Change layout'
    })) return
    await run('page_set_layout', { page: current.id, layout: id })
  }

  /** Handles a drop of a raw `application/x-bildr` payload onto a parent slot (a layout tile's sets the page layout). */
  const drop = async (payload: string, target: DropTarget) => {
    const instanceOf = parseInstancePayload(payload)
    if (instanceOf) return insertInstance(instanceOf, target)
    // An Insert layout tile frames the page wherever it lands (pages only).
    const layoutOf = parseLayoutPayload(payload)
    if (layoutOf) return componentId.value || layoutId.value ? undefined : setPageLayout(layoutOf)
    const data = parseDragPayload(payload)
    const tree = root()
    if (!data || !tree) return
    if (data.kind === 'component') return insert(data.type, target)
    const to = moveSlot(tree, data.id, outsideInstance(tree, target))
    if (movesIntoItself(tree, data.id, to)) return
    const parent = findParent(tree, data.id)
    if (parent && parent.id === to.parentId && (parent.children ?? []).findIndex(child => child.id === data.id) === to.index) return
    if (await runOnPage('node_move', { nodeId: data.id, ...to })) selectedId.value = data.id
  }

  /**
   * Deletes a node, or the whole selection by default (one undo step, never the
   * root); a deleted selection moves to a neighbour, else the parent.
   */
  const remove = async (id?: string) => {
    const tree = root()
    if (!tree) return
    const ids = topLevelSelection(tree, id ? [id] : selectedIds.value)
    if (!ids.length) return
    const gone = (other: string) => ids.some(deleted => containsNode(findNode(tree, deleted)!, other))
    let next = selectedIds.value.filter(other => !gone(other))
    if (!next.length && selectedIds.value.length) {
      const anchor = ids.includes(selectedId.value!) ? selectedId.value! : ids[0]!
      const neighbour = selectionAfterDelete(tree, anchor)
      next = [neighbour && !gone(neighbour) ? neighbour : findParent(tree, anchor)!.id]
    }
    if (await runOnPage('node_delete', ids.length > 1 ? { nodeIds: ids } : { nodeId: ids[0] })) select(next)
  }

  /** Duplicates a node, or the whole selection by default (one undo step), and selects the copies. */
  const duplicate = async (id?: string) => {
    const tree = root()
    const ids = tree ? topLevelSelection(tree, id ? [id] : selectedIds.value) : []
    if (!ids.length) return
    const result = await runOnPage('node_duplicate', ids.length > 1 ? { nodeIds: ids } : { nodeId: ids[0] })
    if (Array.isArray(result?.nodeIds)) select(result.nodeIds as string[])
  }

  /** Wraps a node, or sibling nodes in the given order, in a new container (one undo step) and selects the container. */
  const wrap = async (ids: string | string[], type?: WrapType, style?: Record<string, string>) => {
    const list = typeof ids === 'string' ? [ids] : ids
    if (!list.length || list.includes(root()?.id ?? '')) return
    const result = await runOnPage('node_wrap', { ...(list.length > 1 ? { nodeIds: list } : { nodeId: list[0] }), ...(type ? { type } : {}), ...(style ? { style } : {}) })
    if (typeof result?.nodeId === 'string') selectedId.value = result.nodeId
  }

  /** The selection without the root, if it is siblings (one parent); else a notice and null. */
  const siblingSelection = (what: string): string[] | null => {
    const tree = root()
    const ids = selectedIds.value.filter(id => id !== tree?.id)
    if (!tree || !ids.length) return null
    if (siblingParent(tree, ids)) return ids
    notify({ title: `Select siblings to ${what}`, description: 'The selected elements must share one parent.', color: 'warning', icon: 'i-lucide-circle-alert' })
    return null
  }

  const documentOrder = (tree: ModelNode, ids: string[]) => {
    const index = (id: string) => (findParent(tree, id)?.children ?? []).findIndex(child => child.id === id)
    return [...ids].sort((a, b) => index(a) - index(b))
  }

  /** Cmd/Ctrl+G: groups the selected siblings into a Container, in document order. */
  const group = async () => {
    const ids = siblingSelection('group')
    const tree = root()
    if (!ids || !tree) return
    await wrap(documentOrder(tree, ids), 'Container')
  }

  const measureNodes = (nodeIds: string[]): Promise<NodeBox[]> => measurer ? measurer(nodeIds) : Promise.resolve([])
  const setMeasurer = (fn: typeof measurer) => {
    measurer = fn
  }

  /** The tokens of one node written at once, or the same patch on several (one undo step); with a variant active they are its overrides. */
  const updateStyle = async (nodeIds: string | string[], style: StylePatch) => {
    const ids = typeof nodeIds === 'string' ? [nodeIds] : nodeIds
    const active = design.variant.value
    const tree = root()
    // Several nodes in a variant are one batched override (one undo step, all or nothing), as `updateStyles` is; one node goes through the store.
    await styles.commit(nodeIds, style, () => active && tree && ids.length > 1
      ? setOverrides(ids.map(id => ({
          nodeId: id,
          ...variantStylePatch(active.overrides[id]?.style ?? {}, design.inspected.value?.id === id ? design.inspected.value.style ?? {} : findNode(tree, id)?.style ?? {}, style)
        })))
      : design.setStyle(style, undefined, ids))
  }

  /**
   * Shift+A, Figma's "Add auto layout": wraps the selected siblings in a Row
   * (side by side) or Column (stacked) in their visual order, with the gap token
   * nearest their spacing. A single container without a direction gets one instead.
   */
  const autoLayout = async () => {
    const ids = siblingSelection('add auto layout')
    const tree = root()
    if (!ids || !tree) return
    if (ids.length === 1) {
      const node = findNode(tree, ids[0]!)!
      if (isFlexType(node.type) && node.style?.direction === undefined) {
        const boxes = await measureNodes((node.children ?? []).map(child => child.id))
        const direction = boxes.length > 1 ? inferAutoLayout(boxes).direction : 'col'
        return updateStyle(node.id, { direction })
      }
      return wrap(ids, 'Column')
    }
    const boxes = await measureNodes(ids)
    if (boxes.length !== ids.length) return wrap(ids, 'Column')
    const inferred = inferAutoLayout(boxes)
    const gap = nearestSpacingToken(inferred.gapPx, design.theme.value.spacing)
    await wrap(inferred.order, inferred.direction === 'row' ? 'Row' : 'Column', { gap })
  }

  /** Moves a node one step up (-1) or down (1) among its siblings. */
  const moveBy = async (id: string, delta: -1 | 1) => {
    const tree = root()
    const to = tree ? siblingMove(tree, id, delta) : null
    if (to && await runOnPage('node_move', { nodeId: id, ...to })) selectedId.value = id
  }

  /**
   * Arrow keys: moves every selected node one step among its siblings, as one
   * undo step (`node_move_many`; nothing moves at an end). From the canvas, locked
   * nodes (or ones inside a lock) stay where they are.
   */
  const moveSelection = async (delta: -1 | 1, { canvas = false }: { canvas?: boolean } = {}) => {
    const tree = root()
    const ids = tree ? (canvas ? canvasMovable : topLevelSelection)(tree, selectedIds.value) : []
    const moves = tree && ids.length ? siblingMoves(tree, ids, delta) : null
    if (moves) await runOnPage('node_move_many', { moves })
  }

  /**
   * A canvas click on the innermost element `id`: drills (or selects it with Deep
   * select or Cmd/Ctrl); Shift toggles. A locked element (or one inside a lock)
   * counts as its nearest unlocked ancestor; under a locked root nothing.
   */
  const canvasClick = (id: string, { shift, meta }: { shift: boolean, meta: boolean }) => {
    interactionId.value = null
    const tree = root()
    const reachable = tree ? nearestUnlocked(tree, id) : id
    if (!reachable) return
    const target = tree ? drillTarget(tree, selectedIds.value, reachable, { deep: deepSelect.value || meta }) : reachable
    if (!target) return
    if (shift) select(toggleSelection(selectedIds.value, target))
    else select([target])
  }

  /** A layers row click; Shift toggles the row in the selection. */
  const selectRow = (id: string, shift: boolean) => {
    if (shift) select(toggleSelection(selectedIds.value, id))
    else select([id])
  }

  const setDeepSelect = (value: boolean) => {
    deepSelect.value = value
    remember(DEEP_KEY, value ? 'on' : 'off')
  }
  const setPreviewDark = (value: boolean) => {
    previewDark.value = value
    remember(DARK_KEY, value ? 'on' : 'off')
  }

  /** Enter, Shift+Enter, Tab, Shift+Tab: steps the primary selection through the tree. */
  const navigate = (step: SelectionStep): boolean => {
    const tree = root()
    const next = tree && selectedId.value ? navigateSelection(tree, selectedId.value, step) : null
    if (next) selectedId.value = next
    return !!selectedId.value
  }

  /** Copy (Cmd/Ctrl+C): node `id`, or the selected node by default, to the editor clipboard (one node: the store's). */
  const copy = (id?: string) => design.copy(id)
  /** Paste (Cmd/Ctrl+V): inserts the copied node as it was, with new ids (one undo step), and selects it. */
  const paste = () => design.paste()

  /** Paste style (Cmd/Ctrl+Alt+V): gives node `id`, or the selection, the copied node's style (one undo step). */
  const pasteStyle = async (id?: string) => {
    const copied = design.clipboard.value
    const tree = root()
    const nodes = tree && copied ? (id ? [id] : selectedIds.value).map(other => findNode(tree, other)).filter(node => node !== undefined) : []
    if (!copied || !nodes.length) return
    const style = copied.style ?? {}
    const patch: StylePatch = nodes.length === 1
      ? { ...Object.fromEntries(Object.keys(nodes[0]!.style ?? {}).filter(key => !(key in style)).map(key => [key, null])), ...style }
      : { ...Object.fromEntries(nodes.flatMap(node => Object.keys(node.style ?? {})).map(key => [key, null])), ...style }
    if (Object.keys(patch).length) await updateStyle(nodes.map(node => node.id), patch)
  }

  /** Rename (Cmd/Ctrl+R): selects node `id` (the primary selection by default) and opens its layers row for an inline rename. */
  const startRename = (id: string | null = selectedId.value) => {
    const tree = root()
    if (!tree || !id || id === tree.id || !findNode(tree, id)) return
    if (!selectedIds.value.includes(id)) selectedId.value = id
    sidebarPanel.value = 'layers'
    const hidden = collapsedAncestors(tree, collapsed.value, id)
    if (hidden.length) collapsed.value = new Set([...collapsed.value].filter(row => !hidden.includes(row)))
    renamingId.value = id
  }

  /** Commits an inline rename (one undo step): an empty name removes the layer name; the unchanged or derived name changes nothing. */
  const renameNode = async (id: string, name: string) => {
    renamingId.value = null
    const tree = root()
    const node = tree ? findNode(tree, id) : undefined
    const next = name.trim()
    if (!node || next === (node.name ?? '') || (!node.name && next === nodeName(node))) return
    await runOnPage('node_rename', { nodeId: id, name: next || null })
  }

  /** Locks or unlocks nodes on the canvas (one undo step); never the root. */
  const setLocked = async (ids: string[], locked: boolean) => {
    const list = ids.filter(id => id !== root()?.id)
    if (list.length) await runOnPage('node_set_locked', { ...(list.length > 1 ? { nodeIds: list } : { nodeId: list[0] }), locked })
  }

  /** Lock / Unlock (Cmd/Ctrl+L) on node `id`, or the selection: unlocks when every one is locked, else locks them all. */
  const toggleLock = async (id?: string) => {
    const tree = root()
    const ids = tree ? topLevelSelection(tree, id ? [id] : selectedIds.value) : []
    if (!ids.length) return
    await setLocked(ids, !ids.every(other => findNode(tree!, other)?.locked === true))
  }

  /** Add to agent: reports the file and the primary selection to MCP agents now (`editor_context_set`, read with `editor_context_get`). */
  const addToAgent = async () => {
    const file = design.fileId.value
    if (!file) return
    const node = design.selected.value
    try {
      await callAction('editor_context_set', { file, nodeId: node?.id ?? null, variant: design.variantId.value ?? '' })
      notify({ title: 'Added to agent', description: `${node ? nodeName(node) : 'The page'} is now the editor context agents read (editor_context_get).`, icon: 'i-lucide-sparkles' })
    } catch (error) {
      notify({ title: 'Could not add to agent', description: (error as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }

  const setCollapsed = (id: string, value: boolean) => {
    const next = new Set(collapsed.value)
    if (value) next.add(id)
    else next.delete(id)
    collapsed.value = next
  }

  // ── Pages, layouts and components ───────────────────────────────────────

  /** Adds a page and shows it; true when it was added. */
  const addPage = async (name: string): Promise<boolean> => {
    const result = await run('page_create', { name })
    if (typeof result?.pageId === 'string') selectPage(result.pageId)
    return !!result
  }

  /** Renames the project (`project_update`); true when renamed. */
  const renameProject = async (name: string): Promise<boolean> => {
    const next = name.trim()
    if (!next || next === model.value?.project.name) return false
    return !!await run('project_update', { name: next })
  }

  /** "New layout": opens the naming dialog; Create makes the layout (a children slot only) and opens it. */
  const createLayout = () => {
    if (!model.value) return
    createRequest.value = { kind: 'layout', name: uniqueName('Layout', design.layouts.value), nodeIds: [] }
  }

  /** The selected top-level page layers "Create layout from selection" takes, or why it cannot (pages without a layout only). */
  const layoutFromSelection = computed(() => {
    if (componentId.value || layoutId.value || !currentPage.value) return { reason: 'Leave the component or layout first' }
    return layoutSelection(currentPage.value, selectedIds.value)
  })

  const createLayoutFromSelection = () => {
    const choice = layoutFromSelection.value
    if (!model.value || !('nodeIds' in choice)) return
    createRequest.value = { kind: 'layout', name: uniqueName('Layout', design.layouts.value), nodeIds: choice.nodeIds }
  }

  /**
   * "Create component" (the node menu, ⌥⌘K, ⌘K, Assets "+"): opens the naming
   * dialog for the selected siblings (in document order), named after the one
   * layer or "Component"; pages only.
   */
  const createComponent = () => {
    const ids = componentId.value || layoutId.value ? null : siblingSelection('create a component')
    const tree = root()
    if (!ids || !tree || !model.value) return
    const ordered = documentOrder(tree, ids)
    createRequest.value = { kind: 'component', name: componentPrefill(ordered.map(id => nodeName(findNode(tree, id)!)), design.components.value), nodeIds: ordered }
  }

  /** The dialog's Create: a component from the request's nodes (an instance takes their place and is selected), opened on top of the page, or a layout, opened. True when created. */
  const confirmCreate = async (name: string): Promise<boolean> => {
    const request = createRequest.value
    if (!request) return false
    if (request.kind === 'layout') {
      const fromSelection = request.nodeIds.length > 0
      const result = fromSelection
        ? await run('layout_create_from_selection', { page: currentPage.value?.id, nodeIds: request.nodeIds, name: name.trim() })
        : await run('layout_create', { name: name.trim() })
      if (typeof result?.layoutId !== 'string') return false
      createRequest.value = null
      // The selected layers moved into the layout: nothing on the page to come back to.
      if (fromSelection) select([])
      editLayout(result.layoutId)
      return true
    }
    const ids = request.nodeIds
    const result = await runOnPage('component_create', { ...(ids.length > 1 ? { nodeIds: ids } : { nodeId: ids[0] }), name: name.trim() })
    if (typeof result?.componentId !== 'string') return false
    createRequest.value = null
    if (typeof result.nodeId === 'string') selectedId.value = result.nodeId
    editComponent(result.componentId, null, { nested: true })
    return true
  }

  /** Opens the properties modal of the component or layout being edited, on `propertyId`; `focusName` puts the focus in its name field. */
  const openProperties = (propertyId: string | null = null, { focusName = false }: { focusName?: boolean } = {}) => {
    const owner = component.value ? { kind: 'component' as const, id: component.value.id } : layout.value ? { kind: 'layout' as const, id: layout.value.id } : null
    if (owner) propertiesRequest.value = { ...owner, propertyId, focusName }
  }

  /** Detach instance (⌥⌘B): the selected instance becomes the plain tree it renders, which is selected. */
  const detachInstance = async (id: string | null = selectedId.value) => {
    const tree = root()
    const node = id && tree ? findNode(tree, id) : undefined
    if (node?.type !== 'Instance') return
    const result = await runOnPage('instance_detach', { nodeId: node.id })
    if (typeof result?.nodeId === 'string') selectedId.value = result.nodeId
  }

  /** Replace with ›: instance `nodeId` of the tree being edited (or with `all`, every instance of its component) becomes an instance of `componentId`. */
  const replaceInstance = async (nodeId: string, withComponent: string, { all = false }: { all?: boolean } = {}) => {
    await runOnPage('instance_replace', { nodeId, component: withComponent, ...(all ? { all: true } : {}) })
  }

  // ── Variants, states, interactions ──────────────────────────────────────

  /** Shows a variant of the component being edited (null: the primary); prop and style edits then override it. */
  const selectVariant = (id: string | null) => design.selectVariant(component.value?.variants.find(entry => entry.id === id)?.id ?? null)

  /** The Board toggle: shows (or hides) the variant board for the component being edited, remembered for it until the editor closes. */
  const setVariantBoard = (on: boolean) => {
    if (component.value) boardChoices.value = { ...boardChoices.value, [component.value.id]: on }
  }

  /** Adds a variant to the component being edited (`Variant N`, like the primary) and makes it the active one. */
  const addVariant = async () => {
    const def = component.value
    if (!def) return
    const result = await run('component_variant_add', { component: def.id, name: newVariantName(def) })
    if (typeof result?.variantId === 'string') selectVariant(result.variantId)
  }

  /** Adds a hover or pressed state of base variant `baseId` (null: the primary) and makes it the active one. */
  const addState = async (baseId: string | null, kind: StateKind) => {
    const def = component.value
    if (!def) return
    const result = await run('component_state_add', { component: def.id, baseVariant: baseId ?? '', kind })
    if (typeof result?.variantId === 'string') selectVariant(result.variantId)
  }

  /** Adds an interaction to variant `fromId` (null: the primary) going to `to` (`''`: the primary), selects it and returns its key (`interactionKey`). */
  const addInteraction = async (fromId: string | null, on: InteractionEvent, to: string, delay?: number): Promise<string | undefined> => {
    const def = component.value
    if (!def) return undefined
    const result = await run('component_interaction_add', { component: def.id, ...(fromId ? { variant: fromId } : {}), on, to, ...(delay ? { delay } : {}) })
    if (typeof result?.index !== 'number') return undefined
    interactionId.value = interactionKey(fromId, result.index)
    return interactionId.value
  }

  /** Changes an interaction's event, target or delay (null removes the delay). */
  const updateInteraction = async (key: string, patch: { on?: InteractionEvent, to?: string, delay?: number | null }) => {
    const target = parseInteractionKey(key)
    if (component.value && target) await run('component_interaction_update', { component: component.value.id, variant: target.variantId, index: target.index, ...patch })
  }

  /** Removes an interaction (one undo step) and drops it from the board's selection. */
  const removeInteraction = async (key: string) => {
    const target = parseInteractionKey(key)
    if (!component.value || !target) return
    if (interactionId.value === key) interactionId.value = null
    await run('component_interaction_remove', { component: component.value.id, variant: target.variantId, index: target.index })
  }

  /** Sets the transition of variant `id` (null: the component's own, the default of every variant); null clears it. */
  const setTransition = async (id: string | null, transition: Transition | null) => {
    if (component.value) await run('component_transition_set', { component: component.value.id, ...(id ? { variant: id } : {}), transition })
  }

  /** Opens the app on the first page showing component `id` (the one being edited), or says how to get one. */
  const previewInteractions = (id: string | undefined = component.value?.id) => {
    const shown = model.value && id ? previewPageFor(model.value, id, page => !hasRouteParams(page.path)) : null
    if (shown) {
      window.open(shown.path, '_blank')
      return
    }
    notify({ title: 'Nothing to preview yet', description: 'Place this component on a page to preview its interactions.', icon: 'i-lucide-zap' })
  }

  /** Renames a variant of the component being edited; a blank or unchanged name does nothing. */
  const renameVariant = async (id: string, name: string) => {
    const def = component.value
    const current = def?.variants.find(entry => entry.id === id)
    const next = name.trim()
    if (def && current && next && next !== current.name) await run('component_variant_rename', { component: def.id, variant: id, name: next })
  }

  /** `setOverride` for several nodes: one `component_variant_set_override` (a batch for several), so one undo step, all or nothing. */
  const setOverrides = async (patches: NodeOverridePatch[]) => {
    const input = overrideInput(patches)
    if (!component.value || !design.variant.value || !input) return undefined
    return run('component_variant_set_override', { component: component.value.id, variant: design.variant.value.id, ...input })
  }
  /** Overrides props and design tokens of one definition node in the active variant; a null resets (removes) one, `unset` removes primary tokens. */
  const setOverride = (nodeId: string, patch: OverridePatch) => setOverrides([{ nodeId, ...patch }])

  const updateProps = async (nodeId: string, props: Record<string, Value | null>) => {
    await design.setProps(nodeId, props)
  }

  /** Previews a style patch on a canvas node, or on several, without saving it; null ends the preview. */
  const previewStyle = (nodeIds: string | string[], style: StylePatch | null) => styles.preview(nodeIds, style)

  /** Commits a different style patch per node, as one undo step (all or nothing), e.g. a selection colour swap. */
  const updateStyles = async (updates: { nodeId: string, style: StylePatch }[]) => {
    if (!updates.length) return
    if (design.variant.value) {
      await setOverrides(updates)
      return
    }
    await runOnPage('node_update_style', updates.length === 1 ? updates[0]! : { updates })
  }

  // ── Theme ───────────────────────────────────────────────────────────────

  /** Previews a theme change in the canvas without committing it. */
  const previewTheme = (patch: ThemePatch) => {
    const base = design.theme.value
    themeDraft.value = { ...base, ...patch, colors: { ...base.colors, ...patch.colors } }
  }

  /** Commits a theme change (one undo step) and drops any preview. */
  const updateTheme = async (patch: ThemePatch) => {
    await run('theme_update', patch)
    themeDraft.value = null
  }

  // ── History, devices, preview ───────────────────────────────────────────

  const undo = async () => {
    if (design.history.value.undo) await design.undo()
  }
  const redo = async () => {
    if (design.history.value.redo) await design.redo()
  }

  const requestZoom = (command: ZoomCommand) => {
    zoomRequest.value = { command }
  }

  /** Edits another device: its frame becomes the active one and the canvas pans to it; the selection stays. */
  const setDevice = (id: DeviceId) => {
    design.chooseDevice(id)
    frameRequest.value = { deviceId: id }
  }
  /** The frame bar's "+": shows a hidden frame and edits it. */
  const showFrame = (id: DeviceId) => {
    visibility.show(id)
    setDevice(id)
  }
  /** Hides a frame (never the Primary); hiding the edited one goes back to the Primary. */
  const hideFrame = (id: DeviceId) => {
    if (!canHideFrame(id, breakpointBase.value)) return
    visibility.hide(id)
    if (deviceId.value === id) setDevice(primaryFrame(breakpointBase.value))
  }

  /** Opens the app on the current page in a new tab, or with a frame's `width` in a popup that wide; in the component view, on a page showing the component (its interactions run there). */
  const openPreview = (width?: number) => {
    if (component.value) return previewInteractions()
    if (!previewUrl.value) {
      notify({ title: 'Nothing to preview yet', description: previewHint.value, icon: 'i-lucide-play' })
      return
    }
    if (width) window.open(previewUrl.value, `bildr-preview-${width}`, previewWindowFeatures(width, window.screen.availHeight))
    else window.open(previewUrl.value, '_blank')
  }

  // ── The app's data ──────────────────────────────────────────────────────

  /** Previews record `key` (the value of the detail page's key field) on the detail page. */
  const setPreviewRecord = async (key: string) => {
    design.pickRecord(key)
  }
  const reloadDetailRecords = () => design.rowsOf.refresh()

  /** The env vars the data sources read and whether each is set (`env_status`; values are never returned). */
  const env = shallowRef<EnvStatusEntry[]>([])
  const reloadEnv = async () => {
    try {
      env.value = (await callAction<{ variables: EnvStatusEntry[] }>('env_status')).variables
    } catch {
      // The data screens show no variables until the next load.
    }
  }

  /** Not in the module yet: a detail page is made by hand (a path with a parameter and a query use). */
  const setPageCollection = async (_slug: string | null, _field?: string) => notAvailable('Making a page a detail page')
  const createDetailPage = async (_collectionSlug: string): Promise<string | undefined> => {
    notAvailable('Creating a detail page')
    return undefined
  }

  const start = async () => {
    await design.start()
    // The page chosen on the other screen (⌘K → a page) is the one this screen opens.
    if (handed.data.pageId && pages.value.some(entry => entry.id === handed.data.pageId)) selectPage(handed.data.pageId)
    // A component or layout opened from the Data workspace ("Used in") is shown in its own view.
    const file = handed.data.fileId
    if (file && design.components.value.some(entry => entry.id === file)) editComponent(file)
    else if (file && design.layouts.value.some(entry => entry.id === file)) editLayout(file)
    await reloadEnv()
  }

  // ── Shortcuts ───────────────────────────────────────────────────────────

  /**
   * Editor shortcuts, Figma's where they exist; returns true when `key` was handled
   * (the hosted `shortcut`: same keys, same order). `nav` allows the keys that also
   * move focus or scroll (Enter, Tab, arrows); `canvas` marks a key from the canvas
   * iframe, where the arrows leave locked nodes in place. Callers skip keys typed into fields.
   */
  const shortcut = (key: string, meta: boolean, shift: boolean, nav = false, { code = '', alt = false, canvas = false }: { code?: string, alt?: boolean, canvas?: boolean } = {}): boolean => {
    const lower = key.toLowerCase()
    if (meta && alt && !shift && code === 'KeyK') {
      if (mode.value !== 'build') return false
      createComponent()
      return true
    }
    if (meta && alt && !shift && code === 'KeyB') {
      if (mode.value !== 'build') return false
      void detachInstance()
      return true
    }
    if (meta && !shift && lower === 'p') {
      openPreview()
      return true
    }
    if (meta && !shift && lower === 'k') {
      quickOpen.value = !quickOpen.value
      return true
    }
    // The Canvas view's shortcuts would act on a page the Data and Settings views do not show.
    if (mode.value !== 'build' && !(meta && (lower === 'z' || lower === 'y'))) return false
    const armed = toolForKey({ key, meta, shift })
    const deviceKey = frameForKey(frames.value, { code, alt, meta, shift }, breakpointBase.value)
    const tree = root()
    if (deviceKey) setDevice(deviceKey)
    else if (meta && !shift && lower === 'f') searchRequest.value++
    else if (!meta && !shift && lower === 'i') insertOpen.value = true
    else if (meta && lower === 'z') void (shift ? redo() : undo())
    else if (meta && lower === 'y') void redo()
    else if (meta && !shift && lower === 'c' && selectedId.value) copy()
    else if (meta && !shift && alt && code === 'KeyV') void pasteStyle()
    else if (meta && !shift && lower === 'v') void paste()
    else if (meta && !shift && lower === 'r' && selectedId.value) startRename()
    else if (meta && !shift && lower === 'l' && selectedId.value) void toggleLock()
    else if (meta && lower === 'd') void duplicate()
    else if (meta && lower === 'g') void group()
    else if (meta && lower === 'a' && tree) select(selectAllSiblings(tree, selectedIds.value))
    else if (!meta && shift && lower === 'a') void autoLayout()
    else if (!meta && (key === 'Delete' || key === 'Backspace') && interactionId.value && component.value) void removeInteraction(interactionId.value)
    else if (!meta && (key === 'Delete' || key === 'Backspace')) void remove()
    else if (key === 'Escape' && design.dragging.value) design.dragCancels.value++
    else if (key === 'Escape' && tool.value !== MOVE_TOOL) tool.value = MOVE_TOOL
    else if (key === 'Escape' && interactionId.value) interactionId.value = null
    else if (key === 'Escape' && !selectedIds.value.length && editStack.value.length) leaveView()
    else if (key === 'Escape') select(tree ? escapeSelection(tree, selectedIds.value) : [])
    else if (armed) tool.value = armed
    else if (nav && !meta && key === 'Enter') return navigate(shift ? 'parent' : 'child')
    else if (nav && !meta && key === 'Tab') return navigate(shift ? 'prev' : 'next')
    else if (nav && !meta && !shift && (key === 'ArrowUp' || key === 'ArrowLeft') && selectedIds.value.length) void moveSelection(-1, { canvas })
    else if (nav && !meta && !shift && (key === 'ArrowDown' || key === 'ArrowRight') && selectedIds.value.length) void moveSelection(1, { canvas })
    else return false
    return true
  }

  return reactive({
    // The project and the file being edited. `project` is `model` (a `.bildr` model, not a hosted Project); `treeRef` is `{ file }`; `page` is the file as authored (no `slug`: see `currentPage.path`).
    model, pages, pageId, componentId, component, layoutId, layout, editStack, createRequest, propertiesRequest, confirmRequest, canvasAccent, variantId: design.variantId, variant: design.variant, variantBoard, interactionId, currentPage, treeRef, page,
    // Selection and canvas UI state.
    selectedId, selectedIds, hoveredId, spacingOverlay, tool, deepSelect, previewDark, collapsed, renamingId, clipboard: design.clipboard, history: design.history, mode, insertOpen, searchRequest, sidebarPanel, quickOpen, zoomRequest, previewUrl, previewHint, breakpointBase, deviceId, device: design.device, frameRequest, frames, visibleDevices, hiddenDevices, themeDraft, stylePreview, selected, selectedNodes, nodeName, theme,
    dataRequest, requestData, variablesRequest, env,
    // The Data view: collections are entities, connections REST data sources; the rows are the app's or the fixtures, never written (U7).
    collections: data.collections,
    connections: data.connections,
    queries: data.queries,
    actions: data.actions,
    queryId: data.queryId,
    actionId: data.actionId,
    dataQuery: data.dataQuery,
    dataAction: data.dataAction,
    collectionId: data.collectionId,
    collection: data.collection,
    connectionId: data.connectionId,
    connection: data.connection,
    dataFiles: data.dataFiles,
    dataSpecial: data.dataSpecial,
    dataShown: data.dataShown,
    dataMigrations: data.dataMigrations,
    dataPlan: data.dataPlan,
    dataMigration: data.dataMigration,
    planShown: data.planShown,
    dataFile: data.dataFile,
    dataDirty: data.dataDirty,
    leaveData: data.leaveData,
    leaveDeclined: data.leaveDeclined,
    dataItem: data.dataItem,
    dataCollection: data.dataCollection,
    dataConnection: data.dataConnection,
    dataTabs: data.dataTabs,
    dataTab: data.dataTab,
    rowsPreference: data.rowsPreference,
    rowsEditable: data.rowsEditable,
    recordId: data.recordId,
    collectionRows: data.collectionRows,
    rowsSource: data.rowsSource,
    rowsFallback: data.rowsFallback,
    recordsError: data.recordsError,
    recordsTotal: data.recordsTotal,
    recordsLoading: data.recordsLoading,
    collectionCounts: data.collectionCounts,
    reloadRecords: data.reloadRecords,
    createCollection: data.createCollection,
    // The app's data (P5): the detail page's records stand where the hosted Data mode's collection records did.
    records: design.records, record: design.record, pickRecord: design.pickRecord, rowsOf: design.rowsOf, detail: design.detail, data: design.data, detailCollection: design.detail, detailRecords: design.records, previewRecord: design.record, reloadDetailRecords, setPreviewRecord, setPageCollection, createDetailPage,
    // The store's own state the ported panels read (P4/P5 logic stays behind the adapter).
    loading: design.loading, error: design.error, errorCode: design.errorCode, dismissError: design.dismissError, regenerated: design.regenerated, problems: design.problems, files: design.files, components: design.components, layouts: design.layouts, catalog: design.catalog, dragging: design.dragging, dragCancels: design.dragCancels, canvasMode: design.mode, pagePaths: design.pagePaths,
    isContainer: design.isContainer, scopeOf: design.scopeOf, pendingInsert: design.pendingInsert, confirmInsert: design.confirmInsert, pendingForm: design.pendingForm, confirmForm: design.confirmForm, formActions: design.formActions, refreshDataSoon: design.refreshDataSoon, select, selectNode: design.selectNode, start, dispose: design.dispose,
    // Operations.
    notify, reload, reloadEnv, run, runOnPage, selectPage, editComponent, exitComponent, editLayout, exitLayout, leaveView, goToCrumb, confirm, createLayout, layoutFromSelection, createLayoutFromSelection, setPageLayout, confirmCreate, openProperties, detachInstance, replaceInstance, selectVariant, setVariantBoard, addVariant, addState, addInteraction, updateInteraction, removeInteraction, setTransition, previewInteractions, renameVariant, setOverride, insertInstance, createComponent, addPage, insert, openPreview, renameProject, requestZoom, setDevice, showFrame, hideFrame, setTool, insertWithTool, drop, remove, duplicate, wrap, group, autoLayout, moveBy, moveSelection,
    copy, paste, pasteStyle, startRename, renameNode, setLocked, toggleLock, addToAgent,
    canvasClick, selectRow, setDeepSelect, setPreviewDark, navigate, setMeasurer, measureNodes, setCollapsed, updateProps, previewStyle, updateStyle, updateStyles, previewTheme, updateTheme, undo, redo, shortcut
  })
}

export type Editor = ReturnType<typeof createEditor>

export const EDITOR_KEY: InjectionKey<Editor> = Symbol('bildr-editor')

/** Provides `editor` to the components below (the hosted editor page did `provide(EDITOR_KEY, createEditor(...))`). */
export const provideEditor = (editor: Editor): Editor => {
  provide(EDITOR_KEY, editor)
  return editor
}

export const useEditor = (): Editor => {
  const editor = inject(EDITOR_KEY)
  if (!editor) throw new Error('useEditor() called outside the editor')
  return editor
}
