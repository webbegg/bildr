import type { InjectionKey } from 'vue'
import type { Project } from '#shared/document/schema'
import type { PropValue } from '#shared/document/components'
import { containsNode, findNode, findParent } from '#shared/document/tree'
import type { DropTarget } from '#shared/editor/dropTarget'
import { insertTargetForSelection, moveTarget, parseDragPayload } from '#shared/editor/dropTarget'
import { selectionAfterDelete } from '#shared/editor/selection'

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
  const selectedId = ref<string | null>(null)
  const hoveredId = ref<string | null>(null)
  const history = ref<{ undo: string | null, redo: string | null }>({ undo: null, redo: null })

  const page = computed(() => project.value?.pages.find(p => p.id === pageId.value) ?? project.value?.pages[0] ?? null)
  const selected = computed(() => (page.value && selectedId.value ? findNode(page.value.root, selectedId.value) ?? null : null))

  async function reload(): Promise<void> {
    const [next, nextHistory] = await Promise.all([
      callAction<Project>('project_get', { projectId }),
      callAction<{ undo: string | null, redo: string | null }>('history_get', { projectId })
    ])
    project.value = next
    history.value = nextHistory
    if (!next.pages.some(p => p.id === pageId.value)) pageId.value = next.pages[0]!.id
    if (selectedId.value && !findNode(page.value!.root, selectedId.value)) selectedId.value = null
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

  /** Like `run`, scoped to the current page (for node actions). */
  function runOnPage<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T | undefined> {
    return run<T>(name, { pageId: page.value!.id, ...input })
  }

  function selectPage(id: string): void {
    pageId.value = id
    selectedId.value = null
    hoveredId.value = null
  }

  /** Inserts a palette component (at the selection by default) and selects it. */
  async function insert(type: string, target?: DropTarget): Promise<void> {
    const at = target ?? insertTargetForSelection(page.value!.root, selectedId.value)
    const result = await runOnPage<{ nodeId: string }>('node_insert', { type, ...at })
    if (result) selectedId.value = result.nodeId
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

  /** Deletes the selection (never the page root) and selects a neighbour. */
  async function remove(): Promise<void> {
    const id = selectedId.value
    const root = page.value?.root
    if (!id || !root || id === root.id) return
    const next = selectionAfterDelete(root, id)
    if (await runOnPage('node_delete', { nodeId: id })) selectedId.value = next
  }

  async function duplicate(): Promise<void> {
    const id = selectedId.value
    if (!id || id === page.value?.root.id) return
    const result = await runOnPage<{ nodeId: string }>('node_duplicate', { nodeId: id })
    if (result) selectedId.value = result.nodeId
  }

  async function updateProps(nodeId: string, props: Record<string, PropValue | null>): Promise<void> {
    await runOnPage('node_update_props', { nodeId, props })
  }

  async function updateStyle(nodeId: string, style: Record<string, string | null>): Promise<void> {
    await runOnPage('node_update_style', { nodeId, style })
  }

  async function undo(): Promise<void> {
    if (history.value.undo) await run('history_undo')
  }

  async function redo(): Promise<void> {
    if (history.value.redo) await run('history_redo')
  }

  /** Editor shortcuts; returns true when `key` was handled. */
  function shortcut(key: string, meta: boolean, shift: boolean): boolean {
    const lower = key.toLowerCase()
    if (meta && lower === 'z') (shift ? redo : undo)()
    else if (meta && lower === 'y') redo()
    else if (meta && lower === 'd') duplicate()
    else if (!meta && (key === 'Delete' || key === 'Backspace')) remove()
    else if (key === 'Escape') selectedId.value = null
    else return false
    return true
  }

  return reactive({
    projectId, project, pageId, selectedId, hoveredId, history, page, selected,
    reload, run, runOnPage, selectPage, insert, drop, remove, duplicate, updateProps, updateStyle, undo, redo, shortcut
  })
}

export type Editor = ReturnType<typeof createEditor>

export const EDITOR_KEY: InjectionKey<Editor> = Symbol('bildr-editor')

export function useEditor(): Editor {
  const editor = inject(EDITOR_KEY)
  if (!editor) throw new Error('useEditor() called outside the editor')
  return editor
}
