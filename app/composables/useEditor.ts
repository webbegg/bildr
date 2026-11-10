import type { InjectionKey } from 'vue'
import { sourcePaging } from '#shared/data/paging'
import type { DataRecord } from '#shared/data/records'
import { loadMoreLimit, tableLimit } from '#shared/data/table'
import type { Theme, ThemePatch } from '#shared/design/theme'
import type { DocNode, Page, Project } from '#shared/document/schema'
import type { EnvListEntry, EnvValues } from '#shared/env/variables'
import type { PropValue } from '#shared/document/components'
import { INSTANCE_TYPE, isFlexType } from '#shared/document/components'
import { containsNode, findNode, findParent } from '#shared/document/tree'
import type { NodeBox } from '#shared/editor/autoLayout'
import { inferAutoLayout, nearestSpacingToken } from '#shared/editor/autoLayout'
import type { EditorView, SidebarPanel } from '#shared/editor/commands'
import { collapsedAncestors, layerName, siblingMove, siblingMoves } from '#shared/editor/layers'
import type { DropTarget } from '#shared/editor/dropTarget'
import { insertTargetForSelection, moveTarget, parseDragPayload } from '#shared/editor/dropTarget'
import type { ToolId } from '#shared/editor/insertTools'
import { isInsertTool, MOVE_TOOL, toolForKey } from '#shared/editor/insertTools'
import type { PreviewState, StylePatch } from '#shared/editor/preview'
import { createStylePreview } from '#shared/editor/preview'
import type { SelectionStep } from '#shared/editor/selection'
import { drillTarget, navigateSelection, selectAllSiblings, selectionAfterDelete, siblingParent, toggleSelection, topLevelSelection } from '#shared/editor/selection'
import { resolvePageWithLayout } from '#shared/runtime/layouts'
import { listKey, listNodes, listQueryOf, listRecords } from '#shared/runtime/list'
import type { ZoomCommand } from '#shared/editor/viewport'
import { previewWindowFeatures } from '#shared/editor/viewport'
import type { DeviceId } from '#shared/editor/styleFields'
import { DEVICES } from '#shared/editor/styleFields'
import { deviceForKey } from '#shared/editor/devices'
import { insertableComponents, outsideInstance, parseInstancePayload, uniqueComponentName } from './componentEditor'
import { activeVariant, applyVariant } from './componentVariants'

/** Identifies this editor tab on change events, so it can skip its own echoes. */
export const TAB_ID = import.meta.client ? crypto.randomUUID() : 'server'

/** Calls an action over HTTP; the editor mutates documents only through this. */
export function callAction<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  return $fetch<T, string>(`/api/actions/${name}`, { method: 'POST', body: input, headers: { 'x-bildr-source': TAB_ID } }) as Promise<T>
}

/** The public variables of an `env_list` by name; secrets have no value to show. */
export function listedPublicEnv(entries: EnvListEntry[]): EnvValues {
  return Object.fromEntries(entries.flatMap(v => (v.secret ? [] : [[v.name, v.value]])))
}

export function actionErrorMessage(error: unknown): string {
  const data = (error as { data?: { data?: { message?: string }, message?: string } }).data
  return data?.data?.message ?? data?.message ?? String(error)
}

/**
 * Editor state for one project. The server document is the source of truth:
 * every edit is an action call followed by a reload, so edits from agents
 * and from the UI follow the same path.
 */
export function createEditor(projectId: string) {
  const toast = useToast()

  const project = ref<Project | null>(null)
  const pageId = ref<string | null>(null)
  /** The component the Canvas edits instead of the page (the component view); null edits the page. */
  const componentId = ref<string | null>(null)
  /** The layout the Canvas edits instead of the page (the layout view); null edits the page. Never set with `componentId`. */
  const layoutId = ref<string | null>(null)
  /** In the component view, the variant the Canvas shows and prop/style edits override; null is the primary (the definition itself). */
  const variantId = ref<string | null>(null)
  /** The selection in the order it was made; Shift+click adds and removes nodes. */
  const selectedIds = ref<string[]>([])
  /** The primary (last selected) node: the one the panel edits alone, and the editor context reports. Setting it selects only it. */
  const selectedId = computed<string | null>({
    get: () => selectedIds.value.at(-1) ?? null,
    set: (id) => {
      selectedIds.value = id ? [id] : []
    }
  })
  const hoveredId = ref<string | null>(null)
  /** The canvas tool: Move, Hand (drags pan), or a component type the next canvas click inserts. */
  const tool = ref<ToolId>(MOVE_TOOL)
  const DEEP_KEY = 'bildr:deep-select'
  /** On: a canvas click selects the innermost element. Off: Figma's drill (the first click selects a top-level element). */
  const deepSelect = ref(!import.meta.client || localStorage.getItem(DEEP_KEY) !== 'off')
  const DARK_KEY = 'bildr:canvas-dark'
  /** The canvas frames preview the project's dark colours; a view setting, never saved in the project. */
  const previewDark = ref(import.meta.client && localStorage.getItem(DARK_KEY) === 'on')
  /** Measures node boxes in the active canvas frame; set by the canvas while it is mounted. */
  let measurer: ((nodeIds: string[]) => Promise<NodeBox[]>) | null = null
  /** Layers rows whose children are hidden; kept in memory only. */
  const collapsed = ref(new Set<string>())
  const history = ref<{ undo: string | null, redo: string | null }>({ undo: null, redo: null })
  /** The view, Framer's: Canvas (`build`) edits the pages, Data the collections and records, Design the theme and the theme library, Settings the project. */
  const mode = ref<EditorView>('build')
  /** The Insert panel (`I`, or the sidebar's "+"): components to click or drag in. */
  const insertOpen = ref(false)
  /** Bumped by Cmd/Ctrl+F; the sidebar focuses its search on each bump. */
  const searchRequest = ref(0)
  /** The Canvas view's sidebar panel: Pages, Layers or Assets. */
  const sidebarPanel = ref<SidebarPanel>('pages')
  /** The `⌘K` quick actions palette. */
  const quickOpen = ref(false)
  /** The last zoom asked for outside the canvas (quick actions); the canvas applies each new one. */
  const zoomRequest = shallowRef<{ command: ZoomCommand } | null>(null)
  /** The canvas width, and the breakpoint the style panel edits (Mobile is the base, mobile-first). */
  const deviceId = ref<DeviceId>('mobile')
  const device = computed(() => DEVICES.find(d => d.id === deviceId.value)!)
  /** The last device frame asked to be shown (the floating bar's switch, ⌥1–3, ⌘K); the canvas pans each new one into view. */
  const frameRequest = shallowRef<{ deviceId: DeviceId } | null>(null)
  /** An uncommitted theme previewed in the canvas, e.g. while a colour picker drags. */
  const themeDraft = shallowRef<Theme | null>(null)
  /** An uncommitted style patch the canvas shows on one node, e.g. while a field scrubs. */
  const stylePreview = shallowRef<PreviewState | null>(null)
  const styles = createStylePreview((state) => {
    stylePreview.value = state
  })
  /** The collection the Data mode shows, and its records (live data, not in the document). */
  const collectionId = ref<string | null>(null)
  const records = shallowRef<DataRecord[]>([])
  const recordsTotal = ref(0)
  /** Whether a paged collection has more items past the loaded ones. */
  const recordsHasMore = ref(false)
  /** How many records the table loads; null starts from the collection's default (50 when paged, else 500). */
  const recordsLimit = ref<number | null>(null)
  /** Why the shown collection's records could not load, e.g. an API source that failed. */
  const recordsError = ref('')
  /** The record the Data view's right panel shows; null shows the collection and its fields. */
  const recordId = ref<string | null>(null)
  /** The connection the Data view's right panel shows (its folder was clicked); null shows the collection. */
  const connectionId = ref<string | null>(null)
  /** Bumped by "Import from API" outside the sidebar (the empty state, ⌘K); the sidebar opens its import dialog on each bump. */
  const importRequest = ref(0)
  /** Bumped by "Environment variables" (⌘K); the Settings view scrolls to its Variables section on each bump. */
  const variablesRequest = ref(0)
  /** The project's variables as `env_list` shows them (stored outside the document, so not in `project`). */
  const env = shallowRef<EnvListEntry[]>([])
  /** The public variables by name, which the canvas resolves `{{ env.NAME }}` with. */
  const publicEnv = computed(() => listedPublicEnv(env.value))
  let envLoaded = false

  /** The page the editor is on, also while the component view shows. */
  const currentPage = computed(() => project.value?.pages.find(p => p.id === pageId.value) ?? project.value?.pages[0] ?? null)
  const component = computed(() => project.value?.components.find(c => c.id === componentId.value) ?? null)
  const layout = computed(() => project.value?.layouts.find(l => l.id === layoutId.value) ?? null)
  const variant = computed(() => activeVariant(component.value, variantId.value))
  /**
   * The tree the Canvas, the layers and the panel edit: the current page, or
   * in the component view the component's definition, as a page of its own
   * (no layout) whose root is the definition root, with the active variant
   * applied, or in the layout view the layout's tree, as a page of its own.
   */
  const page = computed<Page | null>(() => {
    if (component.value) return { id: component.value.id, name: component.value.name, slug: currentPage.value?.slug ?? '', root: applyVariant(component.value.root, variant.value, component.value.properties) }
    if (layout.value) return { id: layout.value.id, name: layout.value.name, slug: currentPage.value?.slug ?? '', root: layout.value.root }
    return currentPage.value
  })
  /** The `pageId`, `componentId` or `layoutId` the node actions take for that tree. */
  const treeRef = computed(() => {
    if (component.value) return { componentId: component.value.id }
    return layout.value ? { layoutId: layout.value.id } : { pageId: currentPage.value?.id }
  })
  const selected = computed(() => (page.value && selectedId.value ? findNode(page.value.root, selectedId.value) ?? null : null))
  const selectedNodes = computed(() => (page.value ? selectedIds.value.map(id => findNode(page.value!.root, id)).filter(n => n !== undefined) : []))
  /** What the layers and the inspector call a node of `page`: an instance its component's name, a slot fill its slot's (see `layerName`). */
  function nodeName(node: DocNode): string {
    return page.value && project.value ? layerName(page.value, node, project.value) : node.type
  }
  /** The theme the canvas renders: the draft while previewing, else the project's. */
  const theme = computed(() => themeDraft.value ?? project.value?.theme ?? null)
  const collection = computed(() => project.value?.collections.find(c => c.id === collectionId.value) ?? project.value?.collections[0] ?? null)
  const connection = computed(() => project.value?.connections.find(c => c.id === connectionId.value) ?? null)

  /** Collections the current page's Lists show, and their records by collection id, for the canvas. */
  const listCollections = computed(() => {
    const slugs = new Set(page.value ? listNodes(resolvePageWithLayout(page.value, project.value?.layouts ?? [], project.value?.components ?? []), project.value?.components).map(node => listQueryOf(node.props).collection) : [])
    return project.value?.collections.filter(c => slugs.has(c.slug)) ?? []
  })
  const listCollectionRecords = shallowRef<Record<string, DataRecord[]>>({})
  /** What each List on the page shows, by `listKey`; Lists of unknown collections have no entry. */
  const lists = computed(() => {
    const out: Record<string, DataRecord[]> = {}
    for (const node of page.value ? listNodes(resolvePageWithLayout(page.value, project.value?.layouts ?? [], project.value?.components ?? []), project.value?.components) : []) {
      const query = listQueryOf(node.props)
      const shown = listCollections.value.find(c => c.slug === query.collection)
      if (shown) out[listKey(query)] = listRecords(shown, listCollectionRecords.value[shown.id] ?? [], query)
    }
    return out
  })

  let listLoad = 0
  /** Loads the records of every collection a List on the page shows (the first 500 of each). */
  async function reloadListRecords(): Promise<void> {
    const load = ++listLoad
    const entries = await Promise.all(listCollections.value.map(async (c) => {
      const result = await callAction<{ records: DataRecord[] }>('record_list', { projectId, collection: c.id, limit: 500 })
      return [c.id, result.records] as const
    }))
    if (load === listLoad) listCollectionRecords.value = Object.fromEntries(entries)
  }

  // API and connection collections are mapped on the server, so a new source, mapping or connection needs a reload too.
  watch(() => JSON.stringify([
    listCollections.value.map(c => (c.source.type === 'internal' ? c.id : [c.id, c.source, c.fields])),
    listCollections.value.some(c => c.source.type === 'connection') ? project.value?.connections : null
  ]), () => void reloadListRecords().catch(() => {}))

  async function reload(): Promise<void> {
    const [next, nextHistory] = await Promise.all([
      callAction<Project>('project_get', { projectId }),
      callAction<{ undo: string | null, redo: string | null }>('history_get', { projectId })
    ])
    project.value = next
    history.value = nextHistory
    if (!envLoaded) await reloadEnv()
    if (!next.pages.some(p => p.id === pageId.value)) pageId.value = next.pages[0]!.id
    // A component deleted here or elsewhere leaves its view.
    if (componentId.value && !next.components.some(c => c.id === componentId.value)) {
      componentId.value = null
      selectedIds.value = []
    }
    if (layoutId.value && !next.layouts.some(l => l.id === layoutId.value)) {
      layoutId.value = null
      selectedIds.value = []
    }
    if (variantId.value && !variant.value) variantId.value = null
    if (selectedIds.value.some(id => !findNode(page.value!.root, id))) selectedIds.value = selectedIds.value.filter(id => findNode(page.value!.root, id))
  }

  async function reloadEnv(): Promise<void> {
    const result = await callAction<{ variables: EnvListEntry[] }>('env_list', { projectId })
    env.value = result.variables
    envLoaded = true
  }

  /** Runs an `env_*` action, then reloads the variables (the document is unchanged); failures become a toast and return undefined. */
  async function runEnv<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T | undefined> {
    try {
      const result = await callAction<T>(name, { projectId, ...input })
      await reloadEnv()
      return result
    } catch (error) {
      toast.add({ title: 'Action failed', description: actionErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
      return undefined
    }
  }

  /** Runs an action on this project; failures become a toast and return undefined. */
  async function run<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T | undefined> {
    try {
      const result = await callAction<T>(name, { projectId, ...input })
      await reload()
      return result
    } catch (error) {
      toast.add({ title: 'Action failed', description: actionErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
      return undefined
    }
  }

  /** Loads the records of the shown collection (the first `recordsLimit`, creation order). */
  async function reloadRecords(): Promise<void> {
    const shown = collection.value
    if (!shown) {
      records.value = []
      recordsTotal.value = 0
      recordsHasMore.value = false
      return
    }
    const limit = recordsLimit.value ?? tableLimit(sourcePaging(shown.source))
    const result = await callAction<{ total: number, records: DataRecord[], hasMore?: boolean }>('record_list', { projectId, collection: shown.id, limit })
    if (collection.value?.id !== shown.id) return
    records.value = result.records
    recordsTotal.value = result.total
    recordsHasMore.value = result.hasMore ?? false
    recordsLimit.value = limit
  }

  /** Loads one page more of the shown collection (see `loadMoreLimit`). */
  async function loadMoreRecords(): Promise<void> {
    const shown = collection.value
    const next = shown && recordsLimit.value !== null ? loadMoreLimit(recordsLimit.value, sourcePaging(shown.source)) : null
    if (next === null) return
    const previous = recordsLimit.value
    recordsLimit.value = next
    try {
      await reloadRecords()
    } catch (error) {
      recordsLimit.value = previous
      throw error
    }
  }

  /** Runs a record action on the shown collection, then reloads its records (the document is unchanged). */
  async function runData<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T | undefined> {
    try {
      const result = await callAction<T>(name, { projectId, collection: collection.value!.id, ...input })
      await reloadRecords()
      return result
    } catch (error) {
      toast.add({ title: 'Action failed', description: actionErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
      return undefined
    }
  }

  watch(() => collection.value?.id, () => {
    recordId.value = null
    recordsLimit.value = null
  })

  // Adding or removing a paging starts again from that kind's first load.
  watch(() => collection.value && !!sourcePaging(collection.value.source), () => {
    recordsLimit.value = null
  })

  watch(collectionId, () => {
    connectionId.value = null
  })

  // A schema change (or another collection) changes how records read.
  watch(() => [mode.value, collection.value] as const, ([current]) => {
    if (current !== 'data') return
    recordsError.value = ''
    void reloadRecords().catch((error) => {
      records.value = []
      recordsTotal.value = 0
      recordsHasMore.value = false
      recordsError.value = actionErrorMessage(error)
    })
  })

  /** Like `run`, scoped to the tree being edited (for node actions): the current page, or the component in the component view. */
  function runOnPage<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T | undefined> {
    return run<T>(name, { ...treeRef.value, ...input })
  }

  /** Shows a page; it also leaves the component and layout views. */
  function selectPage(id: string): void {
    pageId.value = id
    componentId.value = null
    layoutId.value = null
    variantId.value = null
    selectedId.value = null
    hoveredId.value = null
  }

  /** Opens a component in the component view: the Canvas edits its definition until `exitComponent` (Escape, Done, or a page). */
  function editComponent(id: string, nodeId: string | null = null): void {
    if (!project.value?.components.some(c => c.id === id)) return
    mode.value = 'build'
    if (componentId.value !== id) variantId.value = null
    componentId.value = id
    layoutId.value = null
    selectedId.value = nodeId
    hoveredId.value = null
  }

  /** Opens a layout in the layout view: the Canvas edits its tree until `exitLayout` (Escape, Done, or a page). */
  function editLayout(id: string, nodeId: string | null = null): void {
    if (!project.value?.layouts.some(l => l.id === id)) return
    mode.value = 'build'
    componentId.value = null
    variantId.value = null
    layoutId.value = id
    selectedId.value = nodeId
    hoveredId.value = null
  }

  function exitLayout(): void {
    if (!layoutId.value) return
    layoutId.value = null
    selectedId.value = null
    hoveredId.value = null
  }

  /** Creates a layout (a children slot only) and opens it in the layout view. */
  async function createLayout(): Promise<void> {
    const result = await run<{ layoutId: string }>('layout_create', { name: uniqueComponentName('Layout', project.value?.layouts ?? []) })
    if (result) editLayout(result.layoutId)
  }

  function exitComponent(): void {
    if (!componentId.value) return
    componentId.value = null
    variantId.value = null
    selectedId.value = null
    hoveredId.value = null
  }

  /** Inserts an instance of a component (at the selection by default) and selects it; a component never goes into itself. */
  async function insertInstance(id: string, target?: DropTarget): Promise<void> {
    if (!project.value || !insertableComponents(project.value, componentId.value).some(c => c.id === id)) return
    await insert(INSTANCE_TYPE, target, { component: id })
  }

  /** Turns the selected siblings (in document order) into a component, leaving an instance selected in their place; not in the component view. */
  async function createComponent(): Promise<void> {
    const ids = componentId.value || layoutId.value ? null : siblingSelection('create a component')
    const root = page.value?.root
    if (!ids || !root) return
    const ordered = [...ids].sort((a, b) => findParent(root, a)!.index - findParent(root, b)!.index)
    const base = ordered.length === 1 ? findNode(root, ordered[0]!)!.type : 'Component'
    const result = await runOnPage<{ nodeId: string }>('component_create', {
      ...(ordered.length > 1 ? { nodeIds: ordered } : { nodeId: ordered[0] }),
      name: uniqueComponentName(base, project.value?.components ?? [])
    })
    if (result) selectedId.value = result.nodeId
  }

  /** Adds a page and shows it; true when it was added. */
  async function addPage(name: string): Promise<boolean> {
    const result = await run<{ pageId: string }>('page_add', { name })
    if (result) selectPage(result.pageId)
    return !!result
  }

  /** Inserts a palette component (at the selection by default, never inside an instance) and selects it. */
  async function insert(type: string, target?: DropTarget, props?: Record<string, PropValue>): Promise<void> {
    const root = page.value!.root
    const at = outsideInstance(root, target ?? insertTargetForSelection(root, selectedId.value))
    const result = await runOnPage<{ nodeId: string }>('node_insert', { type, ...at, ...(props ? { props } : {}) })
    if (result) selectedId.value = result.nodeId
  }

  /** The draft preview of the current page: unpublished edits included. */
  const previewUrl = computed(() => `/preview/${projectId}/${page.value?.slug ?? ''}`)

  /** Opens the draft preview in a new tab, or with a frame's `width` in a popup that wide. */
  function openPreview(width?: number): void {
    if (width) window.open(previewUrl.value, `bildr-preview-${width}`, previewWindowFeatures(width, window.screen.availHeight))
    else window.open(previewUrl.value, '_blank')
  }

  /** Publishes the draft, refreshes the top bar's published info and toasts the live URL. */
  async function publish(): Promise<void> {
    const result = await run<{ url: string, version: number }>('project_publish')
    if (!result) return
    await refreshNuxtData(`published-${projectId}`)
    toast.add({
      title: 'Published',
      description: `Version ${result.version} is live at ${result.url}`,
      color: 'success',
      icon: 'i-lucide-rocket',
      actions: [{ label: 'Open', to: result.url, target: '_blank', color: 'neutral', variant: 'outline' }]
    })
  }

  /** Renames the project (the slug and published URLs stay); true when renamed. */
  async function renameProject(name: string): Promise<boolean> {
    const next = name.trim()
    if (!next || next === project.value?.name) return false
    return !!await run('project_rename', { name: next })
  }

  function requestZoom(command: ZoomCommand): void {
    zoomRequest.value = { command }
  }

  /** Edits another device: its frame becomes the active one and the canvas pans to it; the selection stays. */
  function setDevice(id: DeviceId): void {
    deviceId.value = id
    frameRequest.value = { deviceId: id }
  }

  /** Picks a canvas tool: Move, Hand, or an insert tool to arm. */
  function setTool(id: ToolId): void {
    tool.value = id
  }

  // The insert tools work on the Canvas only, so a view switch returns to Move.
  watch(mode, () => {
    tool.value = MOVE_TOOL
    insertOpen.value = false
  })

  /** A canvas click with an insert tool armed: inserts its component there, selects it and returns to Move, like Figma. */
  async function insertWithTool(target: DropTarget): Promise<void> {
    const type = tool.value
    if (!isInsertTool(type)) return
    tool.value = MOVE_TOOL
    await insert(type, target)
  }

  /** Handles a drop of a raw `application/x-bildr` payload onto a parent slot. */
  async function drop(payload: string, target: DropTarget): Promise<void> {
    const instanceOf = parseInstancePayload(payload)
    if (instanceOf) return insertInstance(instanceOf, target)
    const data = parseDragPayload(payload)
    const root = page.value?.root
    if (!data || !root) return
    if (data.kind === 'component') return insert(data.type, target)
    target = outsideInstance(root, target)
    const node = findNode(root, data.id)
    if (!node || node === root || containsNode(node, target.parentId)) return
    const to = moveTarget(root, data.id, target)
    const from = findParent(root, data.id)
    if (from && from.parent.id === to.parentId && from.index === to.index) return
    if (await runOnPage('node_move', { nodeId: data.id, ...to })) selectedId.value = data.id
  }

  /**
   * Deletes a node, or the whole selection by default (one undo step, never
   * the page root); a deleted selection moves to a neighbour, else the parent.
   */
  async function remove(id?: string): Promise<void> {
    const root = page.value?.root
    if (!root) return
    const ids = topLevelSelection(root, id ? [id] : selectedIds.value)
    if (!ids.length) return
    const gone = (other: string) => ids.some(deleted => containsNode(findNode(root, deleted)!, other))
    let next = selectedIds.value.filter(other => !gone(other))
    if (!next.length && selectedIds.value.length) {
      const anchor = ids.includes(selectedId.value!) ? selectedId.value! : ids[0]!
      const neighbour = selectionAfterDelete(root, anchor)
      next = [neighbour && !gone(neighbour) ? neighbour : findParent(root, anchor)!.parent.id]
    }
    if (await runOnPage('node_delete', ids.length > 1 ? { nodeIds: ids } : { nodeId: ids[0] })) selectedIds.value = next
  }

  /** Duplicates a node, or the whole selection by default (one undo step), and selects the copies. */
  async function duplicate(id?: string): Promise<void> {
    const root = page.value?.root
    const ids = root ? topLevelSelection(root, id ? [id] : selectedIds.value) : []
    if (!ids.length) return
    const result = await runOnPage<{ nodeIds: string[] }>('node_duplicate', ids.length > 1 ? { nodeIds: ids } : { nodeId: ids[0] })
    if (result) selectedIds.value = result.nodeIds
  }

  type WrapType = 'Container' | 'Row' | 'Column' | 'Card' | 'Grid'

  /** Wraps a node, or sibling nodes in the given order, in a new container (one undo step) and selects the container. */
  async function wrap(ids: string | string[], type?: WrapType, style?: Record<string, string>): Promise<void> {
    const list = typeof ids === 'string' ? [ids] : ids
    if (!list.length || list.includes(page.value?.root.id ?? '')) return
    const result = await runOnPage<{ nodeId: string }>('node_wrap', { ...(list.length > 1 ? { nodeIds: list } : { nodeId: list[0] }), type, style })
    if (result) selectedId.value = result.nodeId
  }

  /** The selection without the page root, if it is siblings (one parent); else a toast and null. */
  function siblingSelection(what: string): string[] | null {
    const root = page.value?.root
    const ids = selectedIds.value.filter(id => id !== root?.id)
    if (!root || !ids.length) return null
    if (siblingParent(root, ids)) return ids
    toast.add({ title: `Select siblings to ${what}`, description: 'The selected elements must share one parent.', color: 'warning', icon: 'i-lucide-circle-alert' })
    return null
  }

  /** The boxes of nodes in the active frame; none without a canvas. */
  function measureNodes(nodeIds: string[]): Promise<NodeBox[]> {
    return measurer ? measurer(nodeIds) : Promise.resolve([])
  }

  function setMeasurer(fn: typeof measurer): void {
    measurer = fn
  }

  /** Cmd/Ctrl+G: groups the selected siblings into a Container, in document order. */
  async function group(): Promise<void> {
    const ids = siblingSelection('group')
    const root = page.value?.root
    if (!ids || !root) return
    await wrap([...ids].sort((a, b) => findParent(root, a)!.index - findParent(root, b)!.index), 'Container')
  }

  /**
   * Shift+A, Figma's "Add auto layout": wraps the selected siblings in a Row
   * (side by side) or Column (stacked) in their visual order, with the gap
   * token nearest their spacing. A single container without a direction gets
   * one instead (from how its children sit); any other single node is wrapped
   * in a Column.
   */
  async function autoLayout(): Promise<void> {
    const ids = siblingSelection('add auto layout')
    const root = page.value?.root
    if (!ids || !root) return
    if (ids.length === 1) {
      const node = findNode(root, ids[0]!)!
      if (isFlexType(node.type) && node.style.direction === undefined) {
        const boxes = await measureNodes(node.children.map(child => child.id))
        const direction = boxes.length > 1 ? inferAutoLayout(boxes).direction : 'col'
        return updateStyle(node.id, { direction })
      }
      return wrap(ids, 'Column')
    }
    const boxes = await measureNodes(ids)
    if (boxes.length !== ids.length) return wrap(ids, 'Column')
    const layout = inferAutoLayout(boxes)
    const gap = nearestSpacingToken(layout.gapPx, project.value?.theme.spacing ?? 'default')
    await wrap(layout.order, layout.direction === 'row' ? 'Row' : 'Column', { gap })
  }

  /** Moves a node one step up (-1) or down (1) among its siblings. */
  async function moveBy(id: string, delta: -1 | 1): Promise<void> {
    const to = page.value ? siblingMove(page.value.root, id, delta) : null
    if (to && await runOnPage('node_move', { nodeId: id, ...to })) selectedId.value = id
  }

  /** Arrow keys: moves every selected node one step among its siblings, as one undo step (nothing moves at an end). */
  async function moveSelection(delta: -1 | 1): Promise<void> {
    const root = page.value?.root
    const ids = root ? topLevelSelection(root, selectedIds.value) : []
    const moves = root && ids.length ? siblingMoves(root, ids, delta) : null
    if (moves) await runOnPage('node_move_many', { moves })
  }

  /** A canvas click on the innermost element `id`: drills (or selects it with Deep select or Cmd/Ctrl); Shift toggles. */
  function canvasClick(id: string, { shift, meta }: { shift: boolean, meta: boolean }): void {
    const root = page.value?.root
    const target = root ? drillTarget(root, selectedIds.value, id, { deep: deepSelect.value || meta }) : id
    if (!target) return
    if (shift) selectedIds.value = toggleSelection(selectedIds.value, target)
    else selectedId.value = target
  }

  /** A layers row click; Shift toggles the row in the selection. */
  function selectRow(id: string, shift: boolean): void {
    if (shift) selectedIds.value = toggleSelection(selectedIds.value, id)
    else selectedId.value = id
  }

  function setDeepSelect(value: boolean): void {
    deepSelect.value = value
    localStorage.setItem(DEEP_KEY, value ? 'on' : 'off')
  }

  function setPreviewDark(value: boolean): void {
    previewDark.value = value
    localStorage.setItem(DARK_KEY, value ? 'on' : 'off')
  }

  /** Enter, Shift+Enter, Tab, Shift+Tab: steps the primary selection through the tree. */
  function navigate(step: SelectionStep): boolean {
    const root = page.value?.root
    const next = root && selectedId.value ? navigateSelection(root, selectedId.value, step) : null
    if (next) selectedId.value = next
    return !!selectedId.value
  }

  function setCollapsed(id: string, value: boolean): void {
    const next = new Set(collapsed.value)
    if (value) next.add(id)
    else next.delete(id)
    collapsed.value = next
  }

  // A selection made elsewhere (e.g. a canvas click) opens the collapsed rows hiding it.
  watch(selectedIds, (ids) => {
    const hidden = page.value ? ids.flatMap(id => collapsedAncestors(page.value!.root, collapsed.value, id)) : []
    if (hidden.length) collapsed.value = new Set([...collapsed.value].filter(row => !hidden.includes(row)))
  })

  /** Shows a variant of the component being edited (null: the primary); prop and style edits then override it. */
  function selectVariant(id: string | null): void {
    variantId.value = activeVariant(component.value, id)?.id ?? null
  }

  /** Overrides props and design tokens of one definition node in the active variant; a null resets (removes) one. */
  async function setOverride(nodeId: string, patch: { props?: Record<string, PropValue | null>, style?: StylePatch }): Promise<unknown> {
    if (!component.value || !variant.value) return undefined
    return run('component_variant_set_override', { componentId: component.value.id, variantId: variant.value.id, nodeId, ...patch })
  }

  async function updateProps(nodeId: string, props: Record<string, PropValue | null>): Promise<void> {
    if (variant.value) await setOverride(nodeId, { props })
    else await runOnPage('node_update_props', { nodeId, props })
  }

  /** Previews a style patch on a canvas node, or on several, without saving it; null ends the preview. */
  function previewStyle(nodeIds: string | string[], style: StylePatch | null): void {
    styles.preview(nodeIds, style)
  }

  /** Commits a style patch to a node, or the same patch to several (one undo step); the canvas shows it until the reload has rendered it. */
  async function updateStyle(nodeIds: string | string[], style: StylePatch): Promise<void> {
    const target = typeof nodeIds === 'string' || nodeIds.length === 1 ? { nodeId: typeof nodeIds === 'string' ? nodeIds : nodeIds[0] } : { nodeIds }
    if (variant.value) {
      const ids = typeof nodeIds === 'string' ? [nodeIds] : nodeIds
      await styles.commit(nodeIds, style, async () => {
        for (const id of ids) await setOverride(id, { style })
      })
      return
    }
    await styles.commit(nodeIds, style, () => runOnPage('node_update_style', { ...target, style }))
  }

  // A preview belongs to the nodes being styled.
  watch([selectedIds, () => page.value?.id], () => {
    if (stylePreview.value) styles.preview(stylePreview.value.nodeId, null)
  })

  /** Previews a theme change in the canvas without committing it. */
  function previewTheme(patch: ThemePatch): void {
    const base = project.value?.theme
    if (base) themeDraft.value = { ...base, ...patch, colors: { ...base.colors, ...patch.colors } }
  }

  /** Commits a theme change (one undo step) and drops any preview. */
  async function updateTheme(patch: ThemePatch): Promise<void> {
    await run('theme_update', patch)
    themeDraft.value = null
  }

  async function undo(): Promise<void> {
    if (history.value.undo) await run('history_undo')
  }

  async function redo(): Promise<void> {
    if (history.value.redo) await run('history_redo')
  }

  /**
   * Editor shortcuts, Figma's where they exist; returns true when `key` was
   * handled. `nav` allows the keys that also move focus or scroll (Enter, Tab,
   * arrows): the canvas and the layers tree pass it, a focused button does not.
   * Escape disarms an insert tool, else clears the selection (Figma would
   * select the parent; Shift+Enter does). Bare letters pick the canvas tools
   * (V Move, H Hand, and the insert tools); `I` opens the Insert panel, as in
   * Framer, rather than arming Image. Cmd/Ctrl+P opens the draft preview,
   * Cmd/Ctrl+F the sidebar search and Cmd/Ctrl+K the quick actions (in any
   * view). Alt/Option + 1–3 edits Desktop, Tablet or Mobile, matched on the
   * physical `code`. Callers skip keys typed into fields.
   */
  function shortcut(key: string, meta: boolean, shift: boolean, nav = false, { code = '', alt = false }: { code?: string, alt?: boolean } = {}): boolean {
    const lower = key.toLowerCase()
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
    const deviceKey = deviceForKey({ code, alt, meta, shift })
    if (deviceKey) setDevice(deviceKey)
    else if (meta && !shift && lower === 'f') searchRequest.value++
    else if (!meta && !shift && lower === 'i') insertOpen.value = true
    else if (meta && lower === 'z') (shift ? redo : undo)()
    else if (meta && lower === 'y') redo()
    else if (meta && lower === 'd') duplicate()
    else if (meta && lower === 'g') group()
    else if (meta && lower === 'a' && page.value) selectedIds.value = selectAllSiblings(page.value.root, selectedIds.value)
    else if (!meta && shift && lower === 'a') autoLayout()
    else if (!meta && (key === 'Delete' || key === 'Backspace')) remove()
    else if (key === 'Escape' && tool.value !== MOVE_TOOL) tool.value = MOVE_TOOL
    else if (key === 'Escape' && !selectedIds.value.length && componentId.value) exitComponent()
    else if (key === 'Escape' && !selectedIds.value.length && layoutId.value) exitLayout()
    else if (key === 'Escape') selectedId.value = null
    else if (armed) tool.value = armed
    else if (nav && !meta && key === 'Enter') return navigate(shift ? 'parent' : 'child')
    else if (nav && !meta && key === 'Tab') return navigate(shift ? 'prev' : 'next')
    else if (nav && !meta && !shift && (key === 'ArrowUp' || key === 'ArrowLeft') && selectedIds.value.length) moveSelection(-1)
    else if (nav && !meta && !shift && (key === 'ArrowDown' || key === 'ArrowRight') && selectedIds.value.length) moveSelection(1)
    else return false
    return true
  }

  return reactive({
    projectId, project, pageId, componentId, component, layoutId, layout, variantId, variant, currentPage, treeRef, selectedId, selectedIds, hoveredId, tool, deepSelect, previewDark, collapsed, history, mode, insertOpen, searchRequest, sidebarPanel, quickOpen, zoomRequest, previewUrl, deviceId, device, frameRequest, themeDraft, stylePreview, page, selected, selectedNodes, nodeName, theme,
    collectionId, collection, connectionId, connection, records, recordsTotal, recordsHasMore, recordsLimit, recordsError, recordId, importRequest, variablesRequest, listCollections, lists, env, publicEnv,
    reload, reloadEnv, runEnv, run, runOnPage, reloadRecords, loadMoreRecords, reloadListRecords, runData, selectPage, editComponent, exitComponent, editLayout, exitLayout, createLayout, selectVariant, setOverride, insertInstance, createComponent, addPage, insert, openPreview, publish, renameProject, requestZoom, setDevice, setTool, insertWithTool, drop, remove, duplicate, wrap, group, autoLayout, moveBy, moveSelection,
    canvasClick, selectRow, setDeepSelect, setPreviewDark, navigate, setMeasurer, measureNodes, setCollapsed, updateProps, previewStyle, updateStyle, previewTheme, updateTheme, undo, redo, shortcut
  })
}

export type Editor = ReturnType<typeof createEditor>

export const EDITOR_KEY: InjectionKey<Editor> = Symbol('bildr-editor')

export function useEditor(): Editor {
  const editor = inject(EDITOR_KEY)
  if (!editor) throw new Error('useEditor() called outside the editor')
  return editor
}
