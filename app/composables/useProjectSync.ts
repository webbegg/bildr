import type { Editor } from './useEditor'
import { TAB_ID, callAction } from './useEditor'

type SyncEvent
  = | { kind: 'change', projectId: string, version: number, source?: string, scope?: 'data', collectionId?: string }
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
      // Records changed, not the document: reload them if the Data mode shows them.
      if (event.source !== TAB_ID && editor.mode === 'data' && event.collectionId === editor.collection?.id) await editor.reloadRecords().catch(() => {})
      return
    }
    if (event.kind === 'change') {
      if (event.source !== TAB_ID && isNewer(event.version)) await refresh()
      return
    }
    if (!editor.project?.pages.some(p => p.id === event.pageId)) await refresh()
    if (!editor.project?.pages.some(p => p.id === event.pageId)) return
    editor.selectPage(event.pageId)
    editor.selectedId = event.nodeId
  }

  function startPolling(): void {
    poll ??= setInterval(async () => {
      const { version } = await $fetch<{ version: number }>(`/api/projects/${editor.projectId}/version`).catch(() => ({ version: 0 }))
      if (isNewer(version)) await refresh()
      // Record changes do not move the version, so the Data mode re-reads them.
      if (editor.mode === 'data') await editor.reloadRecords().catch(() => {})
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

  watch(() => [editor.page?.id, editor.selectedId] as const, ([pageId, selectedId]) => {
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
