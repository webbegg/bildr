import type { InjectionKey } from 'vue'
import type { Project } from '#shared/document/schema'
import { findNode } from '#shared/document/tree'

/** Identifies this editor tab on change events, so it can skip its own echoes. */
export const TAB_ID = import.meta.client ? crypto.randomUUID() : 'server'

/** Calls an action over HTTP; the editor mutates documents only through this. */
export function callAction<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  return $fetch(`/api/actions/${name}`, { method: 'POST', body: input, headers: { 'x-bildr-source': TAB_ID } }) as Promise<T>
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

  return reactive({ projectId, project, pageId, selectedId, hoveredId, history, page, selected, reload, run, runOnPage, selectPage })
}

export type Editor = ReturnType<typeof createEditor>

export const EDITOR_KEY: InjectionKey<Editor> = Symbol('bildr-editor')

export function useEditor(): Editor {
  const editor = inject(EDITOR_KEY)
  if (!editor) throw new Error('useEditor() called outside the editor')
  return editor
}
