import { computed, inject, ref, shallowRef } from 'vue'
import type { InjectionKey } from 'vue'
import { DEFAULT_THEME } from '@bildr/codegen/design'
import { bindingScope } from '@bildr/codegen/edit'
import type { ScopeName } from '@bildr/codegen/edit'
import type { BreakpointBase, Theme } from '@bildr/codegen/design'
import type { ComponentFile, LayoutFile, Model as ProjectModel, ModelNode, PageFile, PropertyDef, Value } from '@bildr/codegen/model'
import { primaryFrame } from '@bildr/editor-core/frames'
import { devicesFor } from '@bildr/editor-core/styleFields'
import type { Device, DeviceId } from '@bildr/editor-core/styleFields'
import { callAction, errorMessage, subscribeEvents } from '../api.ts'
import type { BildrEvent } from '../api.ts'
import type { CanvasFile } from '../canvas/render.ts'
import type { CanvasMode, CanvasToEditor, CanvasView } from '../canvas/protocol.ts'
import type { ModelProblem } from '../types.ts'
import type { Row } from '@bildr/codegen/query'
import { designData, detailField, routeParams } from './data.ts'
import { createLiveRows } from './liveRows.ts'
import { findNode, findParent, moveTarget, nodeIds, slotIndex } from './tree.ts'
import type { DropPosition } from './tree.ts'

/**
 * The Design screen's state (P4b, V1/V2): the loaded model, the file being
 * edited and its selection, the device, and every edit as one module action.
 * `.bildr/` is the only store: an edit calls its action (P3a), reads the model
 * again, and the screen renders what it reads. Module events (P3b: `model`,
 * `regenerated`, `navigate`) do the same refresh for changes made elsewhere
 * (undo from an agent, a hand edit on disk), keeping the selection where its
 * node still exists. Edits run one at a time, in order.
 */

/** How long after a form is submitted in preview the app's rows are read again. */
export const DATA_REFRESH_DELAY_MS = 500

export type FileKind = 'page' | 'component' | 'layout'

export interface FileRef {
  id: string
  kind: FileKind
  name: string
  module?: string
  path: string
}

export interface CatalogNodeType {
  type: string
  label: string
  description: string
  container: boolean
  insertable?: boolean
  props: string[]
  defaults: { props: Record<string, Value>, style: Record<string, string> }
}

export interface Catalog {
  nodeTypes: CatalogNodeType[]
  components: Array<{ id: string, name: string, module: string }>
  layouts: Array<{ id: string, name: string }>
}

type Variant = ComponentFile['variants'][number]
type Override = Variant['overrides'][string]

type ModelResult = { ok: true, model: ProjectModel } | { ok: false, problems: ModelProblem[] }

export type Edit = (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>

const FALLBACK_CONTAINERS = ['Page', 'Container', 'Row', 'Column', 'Grid', 'Card', 'Form', 'List', 'Link', 'SlotFill']
export const WRAP_TYPES = ['Container', 'Row', 'Column', 'Card', 'Grid'] as const

/** What a copy holds: the node as a spec `node_insert` takes (no ids; it mints new ones). */
const toSpec = (node: ModelNode): Record<string, unknown> => ({
  type: node.type,
  ...(node.name ? { name: node.name } : {}),
  ...(node.locked ? { locked: true } : {}),
  ...(node.props ? { props: structuredClone(node.props) } : {}),
  ...(node.style ? { style: { ...node.style } } : {}),
  ...(node.interactions ? { interactions: structuredClone(node.interactions) } : {}),
  ...(node.children ? { children: node.children.map(toSpec) } : {})
})

export const createDesign = () => {
  const result = shallowRef<ModelResult | null>(null)
  const loading = ref(true)
  /** The last action's refusal, or a failed read. It stays until dismissed or the next edit; a refresh never clears an action's. */
  const error = ref<string | null>(null)
  let errorFromRead = false
  const zoom = ref(1)
  const regenerated = ref<{ ok: boolean, problems?: ModelProblem[], error?: string } | null>(null)
  const fileId = ref<string | null>(null)
  const selectedIds = ref<string[]>([])
  const hoveredId = ref<string | null>(null)
  /** The node a canvas handle drag is previewing (`bildr:style-preview` until the commit or cancel), so Esc cancels it instead of clearing the selection. */
  const dragging = ref<string | null>(null)
  /** Counts the Esc presses that ask the canvas to cancel its drag. */
  const dragCancels = ref(0)
  const deviceChoice = ref<DeviceId | null>(null)
  const mode = ref<CanvasMode>('edit')
  const catalog = shallowRef<Catalog | null>(null)
  const history = ref({ undo: 0, redo: 0 })
  const clipboard = shallowRef<ModelNode | null>(null)
  /** The variant of the component being edited that edits are recorded in (null: the primary, whose edits change the component itself). */
  const variantId = ref<string | null>(null)
  /** Previews the project's dark colours in the canvas. */
  const dark = ref(false)
  /** What the canvas shows: the file, or the theme's token sheet. */
  const view = ref<CanvasView>('page')

  const model = computed<ProjectModel | null>(() => result.value?.ok ? result.value.model : null)
  const problems = computed<ModelProblem[]>(() => result.value && !result.value.ok ? result.value.problems : [])
  const base = computed<BreakpointBase>(() => model.value?.project.breakpointBase ?? 'mobile')
  const theme = computed<Theme>(() => model.value?.theme ?? DEFAULT_THEME)
  const components = computed<ComponentFile[]>(() => Object.values(model.value?.modules ?? {}).flatMap(entry => entry.components))
  const layouts = computed<LayoutFile[]>(() => model.value?.layouts ?? [])

  const files = computed<FileRef[]>(() => {
    const current = model.value
    if (!current) return []
    const pathOf = (id: string) => current.paths[id] ?? ''
    return [
      ...Object.entries(current.modules).flatMap(([module, entry]) => entry.pages.map((page): FileRef => ({ id: page.id, kind: 'page', name: page.name, module, path: pathOf(page.id) }))),
      ...Object.entries(current.modules).flatMap(([module, entry]) => entry.components.map((component): FileRef => ({ id: component.id, kind: 'component', name: component.name, module, path: pathOf(component.id) }))),
      ...current.layouts.map((layout): FileRef => ({ id: layout.id, kind: 'layout', name: layout.name, path: pathOf(layout.id) }))
    ]
  })

  const file = computed<CanvasFile | null>(() => {
    const ref = files.value.find(entry => entry.id === fileId.value)
    if (!ref || !model.value) return null
    if (ref.kind === 'page') return Object.values(model.value.modules).flatMap(entry => entry.pages).find(page => page.id === ref.id) ?? null
    if (ref.kind === 'component') return components.value.find(component => component.id === ref.id) ?? null
    return layouts.value.find(layout => layout.id === ref.id) ?? null
  })
  /** Page id → route path, which the canvas links its page links to. */
  const pagePaths = computed<Record<string, string>>(() => Object.fromEntries(Object.values(model.value?.modules ?? {}).flatMap(entry => entry.pages.map(page => [page.id, page.path]))))
  const fileKind = computed(() => files.value.find(entry => entry.id === fileId.value)?.kind ?? null)
  const page = computed<PageFile | undefined>(() => fileKind.value === 'page' ? file.value as PageFile : undefined)

  // ── The app's data (P5) ───────────────────────────────────────────────

  /** The entities the page's queries read: the rows the canvas needs. */
  const neededEntities = computed<string[]>(() => {
    const queries = Object.values(model.value?.modules ?? {}).flatMap(entry => entry.queries)
    return [...new Set((page.value?.uses?.queries ?? []).flatMap(use => queries.find(query => query.id === use.query)?.from ?? []))]
  })
  const rowsOf = createLiveRows(model, neededEntities)
  /** The record picked on a detail page (its key value), until another is picked. */
  const recordKey = ref<string | null>(null)
  /** A detail page: the entity its record comes from and the field (and route parameter) that picks it. */
  const detail = computed<{ entity: string, field: string, param: string, label: string } | null>(() => {
    const current = model.value
    const shown = page.value
    if (!current || !shown?.params?.length) return null
    const queries = Object.values(current.modules).flatMap(entry => entry.queries)
    for (const param of shown.params) {
      const field = detailField(queries, shown, param.name)
      const use = (shown.uses?.queries ?? []).find(entry => Object.values(entry.args ?? {}).some(value => typeof value === 'object' && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).$route === param.name))
      const entity = queries.find(query => query.id === use?.query)?.from
      if (field && entity) {
        const fields = Object.values(current.modules).flatMap(entry => entry.entities).find(candidate => candidate.id === entity)?.fields ?? []
        return { entity, field, param: param.name, label: fields.find(candidate => candidate.type === 'text' && candidate.name !== field)?.name ?? field }
      }
    }
    return null
  })
  /** The records the picker offers: the app's rows, else the model's fixtures. */
  const records = computed<Row[]>(() => {
    const picked = detail.value
    if (!picked || !model.value) return []
    return rowsOf.rows.value[picked.entity] ?? Object.values(model.value.modules).flatMap(entry => entry.fixtures).find(entry => entry.entity === picked.entity)?.rows ?? []
  })
  const record = computed<Row | undefined>(() => {
    const picked = detail.value
    if (!picked) return undefined
    return records.value.find(row => String(row[picked.field]) === recordKey.value) ?? records.value[0]
  })
  const data = computed(() => model.value
    ? designData(model.value, page.value, { rows: rowsOf.rows.value, route: routeParams(model.value, page.value, record.value) })
    : {})

  const device = computed<Device>(() => {
    const set = devicesFor(base.value)
    return set.find(entry => entry.id === deviceChoice.value) ?? set.find(entry => entry.id === primaryFrame(base.value))!
  })
  const devices = computed(() => devicesFor(base.value))

  /** The component being edited, and its active variant (a variant being edited records overrides). */
  const component = computed<ComponentFile | null>(() => fileKind.value === 'component' ? file.value as ComponentFile : null)
  const variant = computed<Variant | null>(() => component.value?.variants.find(entry => entry.id === variantId.value) ?? null)

  const selectedId = computed(() => selectedIds.value.at(-1) ?? null)
  const selected = computed<ModelNode | null>(() => file.value && selectedId.value ? findNode(file.value.root, selectedId.value) ?? null : null)
  const selectedParent = computed<ModelNode | null>(() => file.value && selectedId.value ? findParent(file.value.root, selectedId.value) ?? null : null)

  /** What the active variant overrides of `nodeId`: its base variant's (a state's), then its own. */
  const overrideOf = (nodeId: string): Required<Override> => {
    const active = variant.value
    const base = active?.state?.of ? component.value?.variants.find(entry => entry.id === active.state!.of)?.overrides[nodeId] : undefined
    const own = active?.overrides[nodeId]
    return { props: { ...base?.props, ...own?.props }, style: { ...base?.style, ...own?.style }, unset: [...base?.unset ?? [], ...own?.unset ?? []] }
  }
  /** The selected node as the active variant shows it: its overrides applied, its unset tokens removed. */
  const inspected = computed<ModelNode | null>(() => {
    const node = selected.value
    if (!node || !variant.value) return node
    const override = overrideOf(node.id)
    const style = { ...node.style, ...override.style }
    for (const key of override.unset) Reflect.deleteProperty(style, key)
    return { ...node, props: { ...node.props, ...override.props }, style }
  })
  /** What a layer is called: its own name, or for an instance its component's. */
  const nameOf = (node: ModelNode): string | undefined => node.name ?? (node.type === 'Instance' ? components.value.find(entry => entry.id === node.props?.component)?.name : undefined)
  /** The layers from the root to the selected node, for the breadcrumbs. */
  const breadcrumbs = computed<Array<{ id: string, label: string }>>(() => {
    const root = file.value?.root
    if (!root || !selectedId.value) return []
    const chain: ModelNode[] = []
    const walk = (node: ModelNode): boolean => {
      chain.push(node)
      if (node.id === selectedId.value || node.children?.some(walk)) return true
      chain.pop()
      return false
    }
    walk(root)
    return chain.map(node => ({ id: node.id, label: nameOf(node) ?? node.type }))
  })

  const isContainer = (type: string) => catalog.value?.nodeTypes.find(entry => entry.type === type)?.container ?? FALLBACK_CONTAINERS.includes(type)

  // ── Loading ──────────────────────────────────────────────────────────

  const keepSelection = () => {
    const root = file.value?.root
    const kept = root ? selectedIds.value.filter(id => findNode(root, id)) : []
    if (kept.length !== selectedIds.value.length) selectedIds.value = kept
  }

  let reading: Promise<void> | undefined
  let readAgain = false
  const readModel = async () => {
    try {
      const next = await callAction<{ ok: boolean, model?: ProjectModel, problems?: ModelProblem[] }>('model_get')
      result.value = next.ok && next.model ? { ok: true, model: next.model } : { ok: false, problems: next.problems ?? [] }
      if (errorFromRead) error.value = null
      if (!files.value.some(entry => entry.id === fileId.value)) fileId.value = files.value.find(entry => entry.kind === 'page')?.id ?? files.value[0]?.id ?? null
      if (variantId.value && !variant.value) variantId.value = null
      keepSelection()
    } catch (caught) {
      error.value = errorMessage(caught)
      errorFromRead = true
    }
    try {
      const steps = await callAction<{ undo: unknown[], redo: unknown[] }>('history_get', { limit: 1 })
      history.value = { undo: steps.undo.length, redo: steps.redo.length }
    } catch {
      // The buttons stay enabled and the action refuses when there is nothing to undo.
    }
  }
  /** Reads the model; a read that is already running reads once more when it ends, so the last change always shows. */
  const refresh = (): Promise<void> => {
    if (reading) {
      readAgain = true
      return reading
    }
    reading = (async () => {
      do {
        readAgain = false
        await readModel()
      } while (readAgain)
    })().finally(() => {
      reading = undefined
      loading.value = false
    })
    return reading
  }

  const loadCatalog = async () => {
    try {
      catalog.value = await callAction<Catalog>('catalog_get')
    } catch {
      // The palette falls back to its built-in container list and has no entries until the next load.
    }
  }

  // ── Edits ────────────────────────────────────────────────────────────

  let queue: Promise<unknown> = Promise.resolve()
  const edit: Edit = (name, input) => {
    const run = queue.then(async () => {
      error.value = null
      try {
        const out = await callAction<Record<string, unknown>>(name, input)
        await refresh()
        return out
      } catch (caught) {
        error.value = errorMessage(caught)
        errorFromRead = false
        return undefined
      }
    })
    queue = run
    return run
  }

  const dismissError = () => {
    error.value = null
  }

  const select = (ids: string[]) => {
    selectedIds.value = ids
    reportContext()
  }
  const selectNode = (id: string, additive = false) => {
    if (!additive) return select([id])
    select(selectedIds.value.includes(id) ? selectedIds.value.filter(entry => entry !== id) : [...selectedIds.value, id])
  }
  const openFile = (id: string) => {
    if (id === fileId.value) return
    fileId.value = id
    recordKey.value = null
    variantId.value = null
    selectedIds.value = []
    reportContext()
  }
  /** Edits a variant of the component being edited (null: the primary). */
  const selectVariant = (id: string | null) => {
    variantId.value = id
    reportContext()
  }

  /** Tells the module what the editor shows, for agents (`editor_context_get`). Best effort. */
  const reportContext = () => {
    if (!fileId.value) return
    const picked = detail.value && record.value ? String(record.value[detail.value.field]) : null
    void callAction('editor_context_set', { file: fileId.value, nodeId: selectedId.value, variant: variantId.value, ...(picked ? { record: picked } : {}) }).catch(() => {})
  }
  /** Picks the record a detail page shows. */
  const pickRecord = (key: string) => {
    recordKey.value = key
    reportContext()
  }

  const fileInput = () => fileId.value!

  const undo = async () => {
    await edit('history_undo', {})
  }
  const redo = async () => {
    await edit('history_redo', {})
  }

  /** Where a new node goes: into the selected container (at its end), after a selected leaf, else at the root's end. */
  const insertionPoint = (): { parentId?: string, index?: number } => {
    const node = selected.value
    const parent = selectedParent.value
    if (!node) return {}
    if (isContainer(node.type) && node.type !== 'Instance') return { parentId: node.id }
    if (!parent) return {}
    return { parentId: parent.id, index: parent.children!.findIndex(child => child.id === node.id) + 1 }
  }

  /** The actions a Form of the page can run: those of the page's module that take an entity (what the Form's fields edit). */
  const formActions = () => {
    const current = model.value
    const id = page.value?.id
    const module = current && id ? Object.values(current.modules).find(mod => mod.pages.some(entry => entry.id === id)) : undefined
    return (module?.actions ?? []).filter(action => !!action.input.entity)
  }
  /** A Form insertion waiting for its action (`FormActionDialog`): a Form without one can't be generated. */
  const pendingForm = shallowRef<{ at: { parentId?: string, index?: number } } | null>(null)

  const insert = async (spec: { type: string, props?: Record<string, Value> }, at: { parentId?: string, index?: number } = insertionPoint()) => {
    if (!fileId.value) return
    if (spec.type === 'Form' && spec.props?.action === undefined && page.value) {
      pendingForm.value = { at }
      return
    }
    const out = await edit('node_insert', { file: fileInput(), ...at, ...spec })
    if (typeof out?.nodeId === 'string') select([out.nodeId])
  }
  /** The names a node of the file being edited can bind; `within`: what something put inside it can (a List's item counts). */
  const scopeOf = (nodeId?: string | null, within = false): ScopeName[] =>
    model.value && fileId.value ? bindingScope(model.value, fileId.value, nodeId ?? undefined, { within }) : []

  /** A component insertion waiting for the values its required properties need (`RequiredValuesDialog`). */
  const pendingInsert = shallowRef<{ component: ComponentFile, at: { parentId?: string, index?: number }, needs: PropertyDef[], scope: ScopeName[] } | null>(null)
  const insertComponent = async (id: string, at: { parentId?: string, index?: number } = insertionPoint()) => {
    const component = components.value.find(entry => entry.id === id)
    // A required property without a default has no value to fall back on: the instance must give it (the model refuses it otherwise).
    const needs = component?.properties.filter(property => property.required && property.kind !== 'slot' && property.default === undefined) ?? []
    if (component && needs.length && file.value) {
      pendingInsert.value = { component, at, needs, scope: scopeOf(at.parentId ?? file.value.root.id, true) }
      return
    }
    await insert({ type: 'Instance', props: { component: id } }, at)
  }
  const confirmInsert = async (values: Record<string, Value>) => {
    const pending = pendingInsert.value
    pendingInsert.value = null
    if (pending) await insert({ type: 'Instance', props: { component: pending.component.id, values } }, pending.at)
  }

  const confirmForm = async (action: string) => {
    const pending = pendingForm.value
    pendingForm.value = null
    if (pending) await insert({ type: 'Form', props: { action, fields: [] } }, pending.at)
  }

  const moveNode = async (nodeId: string, parentId: string, index: number) => {
    if (fileId.value) await edit('node_move', { file: fileInput(), nodeId, parentId, index })
  }
  const dropOnLayer = async (draggedId: string, overId: string, position: DropPosition) => {
    const root = file.value?.root
    const target = root ? moveTarget(root, draggedId, overId, position) : null
    if (target) await moveNode(draggedId, target.parentId, target.index)
  }

  const ids = () => selectedIds.value
  const duplicate = async () => {
    if (!ids().length) return
    const out = await edit('node_duplicate', { file: fileInput(), nodeIds: ids() })
    if (Array.isArray(out?.nodeIds)) select(out.nodeIds as string[])
  }
  const remove = async () => {
    if (!ids().length) return
    const done = await edit('node_delete', { file: fileInput(), nodeIds: ids() })
    if (done) select([])
  }
  const wrap = async (type: typeof WRAP_TYPES[number] = 'Container') => {
    if (!ids().length) return
    const out = await edit('node_wrap', { file: fileInput(), nodeIds: ids(), type })
    if (typeof out?.nodeId === 'string') select([out.nodeId])
  }
  const makeComponent = async (name?: string) => {
    if (!selectedId.value) return
    const out = await edit('component_create', { file: fileInput(), ...(ids().length > 1 ? { nodeIds: ids() } : { nodeId: selectedId.value }), ...(name?.trim() ? { name: name.trim() } : {}) })
    if (typeof out?.nodeId === 'string') select([out.nodeId])
  }
  const setLocked = async (id: string, locked: boolean) => {
    await edit('node_set_locked', { file: fileInput(), nodeIds: [id], locked })
  }
  const rename = async (id: string, name: string) => {
    await edit('node_rename', { file: fileInput(), nodeId: id, name: name.trim() || null })
  }
  const copy = () => {
    if (selected.value) clipboard.value = structuredClone(selected.value)
  }
  const paste = async () => {
    if (!clipboard.value || !fileId.value) return
    const out = await edit('node_insert', { file: fileInput(), ...insertionPoint(), exact: true, nodes: [toSpec(clipboard.value)] })
    if (Array.isArray(out?.nodeIds)) select(out.nodeIds as string[])
  }

  /** An edit of a component node while a variant is active: recorded in the variant, not in the node (`component_variant_set_override`). */
  const override = (nodeId: string, patch: { props?: Record<string, Value | null>, style?: Record<string, string | null>, unset?: string[] }) =>
    edit('component_variant_set_override', { component: fileId.value!, variant: variantId.value!, nodeId, ...patch })

  /** The release of a canvas handle drag: its tokens are already keyed at the breakpoint the frame is at. */
  const commitStyle = (nodeId: string, style: Record<string, string | null>) => variant.value
    ? override(nodeId, { style })
    : edit('node_update_style', { file: fileInput(), nodeIds: [nodeId], style })

  const setProps = (nodeId: string, props: Record<string, Value | null>) => variant.value
    ? override(nodeId, { props })
    : edit('node_update_props', { file: fileInput(), nodeId, props })

  /**
   * Writes style tokens of the selection at the device's breakpoint (the base
   * for a token without breakpoint variants). With a variant active they are
   * its overrides: clearing a token the variant overrides gives back the
   * primary's, clearing one only the primary sets removes it in the variant.
   */
  const setStyle = async (style: Record<string, string | null>, breakpoint: string | undefined) => {
    if (!variant.value) return edit('node_update_style', { file: fileInput(), nodeIds: ids(), ...(breakpoint ? { breakpoint } : {}), style })
    const prefix = breakpoint ? `${breakpoint}:` : ''
    let out: Record<string, unknown> | undefined
    for (const id of ids()) {
      const own = variant.value.overrides[id]?.style ?? {}
      const shown = inspected.value?.id === id ? inspected.value.style ?? {} : {}
      const patch: { style: Record<string, string | null>, unset: string[] } = { style: {}, unset: [] }
      for (const [key, value] of Object.entries(style)) {
        const full = prefix + key
        if (value !== null) patch.style[full] = value
        else if (full in own) patch.style[full] = null
        else if (full in shown) patch.unset.push(full)
      }
      if (!Object.keys(patch.style).length && !patch.unset.length) continue
      out = await override(id, { ...(Object.keys(patch.style).length ? { style: patch.style } : {}), ...(patch.unset.length ? { unset: patch.unset } : {}) })
    }
    return out
  }

  // ── The canvas's drops, keys and the editor's own keys ──────────────────

  const onDrop = async (parentId: string, index: number, payload: string) => {
    let drop: { insert?: unknown, move?: unknown, component?: unknown }
    try {
      drop = JSON.parse(payload) as typeof drop
    } catch {
      return
    }
    const root = file.value?.root
    if (typeof drop.insert === 'string') await insert({ type: drop.insert }, { parentId, index })
    else if (typeof drop.component === 'string') await insertComponent(drop.component, { parentId, index })
    else if (typeof drop.move === 'string' && root) await moveNode(drop.move, parentId, slotIndex(root, drop.move, parentId, index))
  }

  type Key = Extract<CanvasToEditor, { type: 'bildr:key' }>
  /** The editor's shortcuts, for keys typed in the editor or the canvas. Returns whether it took the key. */
  const onKey = (key: Pick<Key, 'key' | 'code' | 'meta' | 'shift' | 'alt'>): boolean => {
    const lower = key.key.toLowerCase()
    if (key.meta && !key.alt) {
      if (lower === 'z') void (key.shift ? redo() : undo())
      else if (lower === 'y') void redo()
      else if (lower === 'd') void duplicate()
      else if (lower === 'g') void wrap()
      else if (lower === 'c') copy()
      else if (lower === 'v') void paste()
      else if (lower === 'l' && selectedId.value) void setLocked(selectedId.value, !selected.value?.locked)
      else if (lower === 'a' && file.value) select(nodeIds(file.value.root).slice(1))
      else return false
      return true
    }
    if (key.meta || key.alt) return false
    if (key.key === 'Delete' || key.key === 'Backspace') void remove()
    else if (key.key === 'Escape') {
      if (dragging.value) dragCancels.value++
      else select([])
    } else return false
    return true
  }

  // ── Events ───────────────────────────────────────────────────────────

  const onEvent = (event: BildrEvent) => {
    if (event.type === 'model' || event.type === 'version') void refresh()
    else if (event.type === 'regenerated') {
      regenerated.value = { ok: event.ok, ...(event.problems ? { problems: event.problems } : {}), ...(event.error ? { error: event.error } : {}) }
      void refresh()
      // The app's data layer may have changed with it (and the dev server may still be restarting).
      void rowsOf.refresh()
    } else if (event.type === 'navigate') {
      void refresh().then(() => {
        if (files.value.some(entry => entry.id === event.target.file)) {
          fileId.value = event.target.file
          selectedIds.value = event.target.nodeId ? [event.target.nodeId] : []
        }
      })
    }
  }

  /** The app's data may have changed (a form submitted in preview): read it again shortly, once for a burst. */
  let later: ReturnType<typeof setTimeout> | undefined
  const refreshDataSoon = () => {
    clearTimeout(later)
    later = setTimeout(() => void rowsOf.refresh(), DATA_REFRESH_DELAY_MS)
  }

  /** Back to where the last session was: its file and the record it picked (best effort; the module may have none). */
  const restoreContext = async () => {
    try {
      const stored = await callAction<{ file?: string, record?: string | null } | null>('editor_context_get')
      if (!stored?.file || !files.value.some(entry => entry.id === stored.file)) return
      fileId.value = stored.file
      recordKey.value = stored.record ?? null
    } catch {
      // A fresh editor: the first page.
    }
  }

  let stop: (() => void) | undefined
  const start = async () => {
    stop = subscribeEvents(onEvent)
    await Promise.all([refresh(), loadCatalog()])
    await restoreContext()
    reportContext()
  }
  const dispose = () => {
    stop?.()
    stop = undefined
    clearTimeout(later)
  }

  return {
    page, rowsOf, detail, records, record, pickRecord, result, loading, error, zoom, regenerated, model, problems, pagePaths, base, theme, components, layouts, files, file, fileId, fileKind, data, catalog,
    selectedIds, selectedId, selected, selectedParent, hoveredId, dragging, dragCancels, device, devices, deviceChoice, mode, history, clipboard,
    component, variantId, variant, inspected, breadcrumbs, nameOf, dark, view, selectVariant, override, commitStyle,
    isContainer, scopeOf, pendingInsert, confirmInsert, pendingForm, confirmForm, formActions, refresh, edit, dismissError, select, selectNode, openFile, undo, redo, insert, insertComponent, moveNode, dropOnLayer, duplicate, remove, wrap, makeComponent,
    setLocked, rename, copy, paste, setProps, setStyle, onDrop, onKey, start, dispose, refreshDataSoon,
    chooseDevice: (id: DeviceId) => {
      deviceChoice.value = id
    }
  }
}

export type Design = ReturnType<typeof createDesign>

export const DESIGN_KEY: InjectionKey<Design> = Symbol('bildr-design')

export const useDesign = (): Design => {
  const design = inject(DESIGN_KEY)
  if (!design) throw new Error('The design state is not provided (see DesignView.vue)')
  return design
}
