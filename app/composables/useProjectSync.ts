import type { Editor } from './useEditor'
import { TAB_ID, callAction } from './useEditor'

type SyncEvent
  = | { kind: 'change', projectId: string, version: number, source?: string, action?: string, scope?: 'data', collectionId?: string }
    | { kind: 'navigate', projectId: string, pageId: string, nodeId: string | null }

const POLL_MS = 1500
const CONTEXT_DEBOUNCE_MS = 300

/**
 * Keeps an open editor in sync with changes made elsewhere (HTTP, MCP, other
 * tabs) over SSE, polling the version if the stream fails, and reports the
 * editor's page and selection so agents can read them.
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
    if (!editor.project?.pages.some(p => p.id === event.pageId)) await refresh()
    if (!editor.project?.pages.some(p => p.id === event.pageId)) return
    editor.selectPage(event.pageId)
    editor.selectedId = event.nodeId
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

  // The component view reports the page it was opened from, without its selection (a definition node, not on that page).
  watch(() => [editor.currentPage?.id, editor.componentId || editor.layoutId ? null : editor.selectedId] as const, ([pageId, selectedId]) => {
    clearTimeout(contextTimer)
    if (!pageId) return
    contextTimer = setTimeout(() => {
      void callAction('editor_set_context', { projectId: editor.projectId, pageId, selectedId }).catch(() => {})
    }, CONTEXT_DEBOUNCE_MS)
  })

  onBeforeUnmount(() => {
    source?.close()
    clearInterval(poll)
    clearTimeout(contextTimer)
  })
}
