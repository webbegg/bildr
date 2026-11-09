import type { InjectionKey } from 'vue'
import type { DataRecord } from '#shared/data/records'
import type { Theme, ThemePatch } from '#shared/design/theme'
import type { Project } from '#shared/document/schema'
import type { PropValue } from '#shared/document/components'
import { isFlexType } from '#shared/document/components'
import { containsNode, findNode, findParent } from '#shared/document/tree'
import type { NodeBox } from '#shared/editor/autoLayout'
import { inferAutoLayout, nearestSpacingToken } from '#shared/editor/autoLayout'
import { collapsedAncestors, siblingMove, siblingMoves } from '#shared/editor/layers'
import type { DropTarget } from '#shared/editor/dropTarget'
import { insertTargetForSelection, moveTarget, parseDragPayload } from '#shared/editor/dropTarget'
import type { ToolId } from '#shared/editor/insertTools'
import { isInsertTool, MOVE_TOOL, toolForKey } from '#shared/editor/insertTools'
import type { PreviewState, StylePatch } from '#shared/editor/preview'
import { createStylePreview } from '#shared/editor/preview'
import type { SelectionStep } from '#shared/editor/selection'
import { drillTarget, navigateSelection, selectAllSiblings, selectionAfterDelete, siblingParent, toggleSelection, topLevelSelection } from '#shared/editor/selection'
import { listKey, listNodes, listQueryOf, listRecords } from '#shared/runtime/list'
import type { DeviceId } from '#shared/editor/styleFields'
import { DEVICES } from '#shared/editor/styleFields'

/** Identifies this editor tab on change events, so it can skip its own echoes. */
export const TAB_ID = import.meta.client ? crypto.randomUUID() : 'server'

/** Calls an action over HTTP; the editor mutates documents only through this. */
export function callAction<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  return $fetch<T, string>(`/api/actions/${name}`, { method: 'POST', body: input, headers: { 'x-bildr-source': TAB_ID } }) as Promise<T>
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
  /** The view, Framer's: Canvas (`build`) edits the pages, Data the collections and records, Settings the project. */
  const mode = ref<'build' | 'data' | 'settings'>('build')
  /** The Insert panel (`I`, or the sidebar's "+"): components to click or drag in. */
  const insertOpen = ref(false)
  /** Bumped by Cmd/Ctrl+F; the sidebar focuses its search on each bump. */
  const searchRequest = ref(0)
  /** The canvas width, and the breakpoint the style panel edits (Mobile is the base, mobile-first). */
  const deviceId = ref<DeviceId>('mobile')
  const device = computed(() => DEVICES.find(d => d.id === deviceId.value)!)
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
  /** Why the shown collection's records could not load, e.g. an API source that failed. */
  const recordsError = ref('')

  const page = computed(() => project.value?.pages.find(p => p.id === pageId.value) ?? project.value?.pages[0] ?? null)
  const selected = computed(() => (page.value && selectedId.value ? findNode(page.value.root, selectedId.value) ?? null : null))
  const selectedNodes = computed(() => (page.value ? selectedIds.value.map(id => findNode(page.value!.root, id)).filter(n => n !== undefined) : []))
  /** The theme the canvas renders: the draft while previewing, else the project's. */
  const theme = computed(() => themeDraft.value ?? project.value?.theme ?? null)
  const collection = computed(() => project.value?.collections.find(c => c.id === collectionId.value) ?? project.value?.collections[0] ?? null)

  /** Collections the current page's Lists show, and their records by collection id, for the canvas. */
  const listCollections = computed(() => {
    const slugs = new Set(page.value ? listNodes(page.value.root).map(node => listQueryOf(node.props).collection) : [])
    return project.value?.collections.filter(c => slugs.has(c.slug)) ?? []
  })
  const listCollectionRecords = shallowRef<Record<string, DataRecord[]>>({})
  /** What each List on the page shows, by `listKey`; Lists of unknown collections have no entry. */
  const lists = computed(() => {
    const out: Record<string, DataRecord[]> = {}
    for (const node of page.value ? listNodes(page.value.root) : []) {
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

  // API collections are mapped on the server, so a new source or mapping needs a reload too.
  watch(() => JSON.stringify(listCollections.value.map(c => (c.source.type === 'api' ? [c.id, c.source, c.fields] : c.id))), () => void reloadListRecords().catch(() => {}))

  async function reload(): Promise<void> {
    const [next, nextHistory] = await Promise.all([
      callAction<Project>('project_get', { projectId }),
      callAction<{ undo: string | null, redo: string | null }>('history_get', { projectId })
    ])
    project.value = next
    history.value = nextHistory
    if (!next.pages.some(p => p.id === pageId.value)) pageId.value = next.pages[0]!.id
    if (selectedIds.value.some(id => !findNode(page.value!.root, id))) selectedIds.value = selectedIds.value.filter(id => findNode(page.value!.root, id))
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

  /** Loads the records of the shown collection (the first 500, creation order). */
  async function reloadRecords(): Promise<void> {
    const shown = collection.value
    if (!shown) {
      records.value = []
      recordsTotal.value = 0
      return
    }
    const result = await callAction<{ total: number, records: DataRecord[] }>('record_list', { projectId, collection: shown.id, limit: 500 })
    if (collection.value?.id !== shown.id) return
    records.value = result.records
    recordsTotal.value = result.total
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

  // A schema change (or another collection) changes how records read.
  watch(() => [mode.value, collection.value] as const, ([current]) => {
    if (current !== 'data') return
    recordsError.value = ''
    void reloadRecords().catch((error) => {
      records.value = []
      recordsTotal.value = 0
      recordsError.value = actionErrorMessage(error)
    })
  })

  /** Like `run`, scoped to the current page (for node actions). */
  function runOnPage<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T | undefined> {
    return run<T>(name, { pageId: page.value!.id, ...input })
  }

  function selectPage(id: string): void {
    pageId.value = id
    selectedId.value = null
    hoveredId.value = null
  }

  /** Adds a page and shows it; true when it was added. */
  async function addPage(name: string): Promise<boolean> {
    const result = await run<{ pageId: string }>('page_add', { name })
    if (result) selectPage(result.pageId)
    return !!result
  }

  /** Inserts a palette component (at the selection by default) and selects it. */
  async function insert(type: string, target?: DropTarget): Promise<void> {
    const at = target ?? insertTargetForSelection(page.value!.root, selectedId.value)
    const result = await runOnPage<{ nodeId: string }>('node_insert', { type, ...at })
    if (result) selectedId.value = result.nodeId
  }

  /** The draft preview of the current page: unpublished edits included. */
  const previewUrl = computed(() => `/preview/${projectId}/${page.value?.slug ?? ''}`)

  function openPreview(): void {
    window.open(previewUrl.value, '_blank')
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
    const data = parseDragPayload(payload)
    const root = page.value?.root
    if (!data || !root) return
    if (data.kind === 'component') return insert(data.type, target)
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

  async function updateProps(nodeId: string, props: Record<string, PropValue | null>): Promise<void> {
    await runOnPage('node_update_props', { nodeId, props })
  }

  /** Previews a style patch on a canvas node, or on several, without saving it; null ends the preview. */
  function previewStyle(nodeIds: string | string[], style: StylePatch | null): void {
    styles.preview(nodeIds, style)
  }

  /** Commits a style patch to a node, or the same patch to several (one undo step); the canvas shows it until the reload has rendered it. */
  async function updateStyle(nodeIds: string | string[], style: StylePatch): Promise<void> {
    const target = typeof nodeIds === 'string' || nodeIds.length === 1 ? { nodeId: typeof nodeIds === 'string' ? nodeIds : nodeIds[0] } : { nodeIds }
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
   * Framer, rather than arming Image. Cmd/Ctrl+P opens the draft preview and
   * Cmd/Ctrl+F the sidebar search. Callers skip keys typed into fields.
   */
  function shortcut(key: string, meta: boolean, shift: boolean, nav = false): boolean {
    const lower = key.toLowerCase()
    if (meta && !shift && lower === 'p') {
      openPreview()
      return true
    }
    // The Canvas view's shortcuts would act on a page the Data and Settings views do not show.
    if (mode.value !== 'build' && !(meta && (lower === 'z' || lower === 'y'))) return false
    const armed = toolForKey({ key, meta, shift })
    if (meta && !shift && lower === 'f') searchRequest.value++
    else if (!meta && !shift && lower === 'i') insertOpen.value = true
    else if (meta && lower === 'z') (shift ? redo : undo)()
    else if (meta && lower === 'y') redo()
    else if (meta && lower === 'd') duplicate()
    else if (meta && lower === 'g') group()
    else if (meta && lower === 'a' && page.value) selectedIds.value = selectAllSiblings(page.value.root, selectedIds.value)
    else if (!meta && shift && lower === 'a') autoLayout()
    else if (!meta && (key === 'Delete' || key === 'Backspace')) remove()
    else if (key === 'Escape' && tool.value !== MOVE_TOOL) tool.value = MOVE_TOOL
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
    projectId, project, pageId, selectedId, selectedIds, hoveredId, tool, deepSelect, previewDark, collapsed, history, mode, insertOpen, searchRequest, previewUrl, deviceId, device, themeDraft, stylePreview, page, selected, selectedNodes, theme,
    collectionId, collection, records, recordsTotal, recordsError, listCollections, lists,
    reload, run, runOnPage, reloadRecords, reloadListRecords, runData, selectPage, addPage, insert, openPreview, setTool, insertWithTool, drop, remove, duplicate, wrap, group, autoLayout, moveBy, moveSelection,
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
