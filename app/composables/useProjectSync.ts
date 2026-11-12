import { findNode } from '#shared/document/tree'
import { navigateTarget } from '#shared/editor/navigate'
import type { NavigateTarget } from '#shared/editor/navigate'
import type { Editor } from './useEditor'
import { TAB_ID, callAction } from './useEditor'

type SyncEvent
  = | { kind: 'change', projectId: string, version: number, source?: string, action?: string, scope?: 'data', collectionId?: string }
    | { kind: 'navigate', projectId: string, pageId: string, nodeId: string | null, recordId?: string }

const POLL_MS = 1500
const CONTEXT_DEBOUNCE_MS = 300

/**
 * Keeps an open editor in sync with changes made elsewhere (HTTP, MCP, other
 * tabs) over SSE, polling the version if the stream fails, and reports the
 * editor's page, open component (and variant) or layout, and selection so
 * agents can read them.
 */
export function useProjectSync(editor: Editor): void {
  let source: EventSource | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  let contextTimer: ReturnType<typeof setTimeout> | undefined
  let reloading: Promise<void> | undefined
  let again = false

  /** Reloads once per burst: events arriving mid-reload queue one more reload. */
  function refresh(): Promise<void> {
    if (reloading) {
      again = true
      return reloading
    }
    reloading = editor.reload().catch(() => {}).finally(() => {
      reloading = undefined
      if (again) {
        again = false
        void refresh()
      }
    })
    return reloading
  }

  function isNewer(version: number): boolean {
    return version > (editor.project?.version ?? Number.POSITIVE_INFINITY)
  }

  async function onEvent(event: SyncEvent): Promise<void> {
    if (event.kind === 'change' && event.scope === 'data') {
      // Records changed, not the document: reload them if the Data mode shows them,
      // and the canvas Lists' records whatever tab changed them.
      if (event.source !== TAB_ID && editor.mode === 'data' && event.collectionId === editor.collection?.id) await editor.reloadRecords().catch(() => {})
      if (editor.listCollections.some(c => c.id === event.collectionId)) await editor.reloadListRecords().catch(() => {})
      if (editor.detailCollection?.id === event.collectionId) await editor.reloadDetailRecords().catch(() => {})
      return
    }
    // Deleted here or elsewhere: the editor has nothing left to show.
    if (event.kind === 'change' && event.action === 'project_delete') return void navigateTo('/')
    if (event.kind === 'change') {
      if (event.source === TAB_ID) return
      if (isNewer(event.version)) await refresh()
      // Variables live outside the document, so their changes (env_*) keep the version.
      else await editor.reloadEnv().catch(() => {})
      return
    }
    // The event names a page and one id: a node on it, or a component, variant or layout to open (see `navigateTarget`).
    let target = resolveNavigation(event.pageId, event.nodeId)
    if (!target) await refresh()
    target = resolveNavigation(event.pageId, event.nodeId)
    if (!target) return
    editor.selectPage(target.pageId)
    if (target.componentId) {
      editor.editComponent(target.componentId)
      editor.selectVariant(target.variantId)
    } else if (target.layoutId) {
      editor.editLayout(target.layoutId)
    } else {
      editor.selectedId = target.nodeId
      // On a detail page, the record the canvas previews.
      if (event.recordId) await editor.setPreviewRecord(event.recordId, target.pageId)
    }
  }

  /** The event's target in the loaded project; null while its page, or the id it names, is not loaded yet. */
  function resolveNavigation(pageId: string, id: string | null): NavigateTarget | null {
    const page = editor.project?.pages.find(p => p.id === pageId)
    if (!editor.project || !page) return null
    const target = navigateTarget(editor.project, pageId, id)
    return target.nodeId && !findNode(page.root, target.nodeId) ? null : target
  }

  function startPolling(): void {
    poll ??= setInterval(async () => {
      const { version } = await $fetch<{ version: number }>(`/api/projects/${editor.projectId}/version`).catch((error: { statusCode?: number }) => {
        if (error.statusCode === 404) void navigateTo('/')
        return { version: 0 }
      })
      if (isNewer(version)) await refresh()
      // Record changes do not move the version, so the Data mode re-reads them.
      if (editor.mode === 'data') await editor.reloadRecords().catch(() => {})
      if (editor.listCollections.length) await editor.reloadListRecords().catch(() => {})
      if (editor.detailCollection) await editor.reloadDetailRecords().catch(() => {})
    }, POLL_MS)
  }

  onMounted(() => {
    if (typeof EventSource === 'undefined') return startPolling()
    source = new EventSource(`/api/projects/${editor.projectId}/events`)
    source.onmessage = message => void onEvent(JSON.parse(message.data) as SyncEvent)
    source.onerror = () => {
      source?.close()
      startPolling()
    }
  })

  // The component and layout views report the page they were opened from, what is open on top of it, and the selection in that tree.
  watch(() => [editor.currentPage?.id, editor.selectedId, editor.componentId, editor.layoutId, editor.componentId ? editor.variantId : null] as const, ([pageId, selectedId, componentId, layoutId, variantId]) => {
    clearTimeout(contextTimer)
    if (!pageId) return
    contextTimer = setTimeout(() => {
      void callAction('editor_set_context', { projectId: editor.projectId, pageId, selectedId, componentId, layoutId, variantId }).catch(() => {})
    }, CONTEXT_DEBOUNCE_MS)
  })

  onBeforeUnmount(() => {
    source?.close()
    clearInterval(poll)
    clearTimeout(contextTimer)
  })
}
