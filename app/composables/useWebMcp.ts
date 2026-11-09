import type { Page } from '#shared/document/schema'
import type { VisitorProject } from '#shared/runtime/visitor'
import { getModelContext, registerWebMcpTools } from '#shared/runtime/webmcp'

/**
 * Exposes the published app to in-browser agents over WebMCP. A no-op when the
 * browser has no `modelContext`. Re-registers when the project changes.
 * The data tools reach the public endpoint with the browser's `fetch`.
 */
export function useWebMcp(project: Ref<VisitorProject | undefined>, page: Ref<Page | undefined>) {
  let cleanup: (() => void) | undefined

  const stop = () => {
    cleanup?.()
    cleanup = undefined
  }

  onMounted(() => {
    const modelContext = getModelContext(document, navigator)
    if (!modelContext) return
    watch(() => project.value && `${project.value.id}@${project.value.version}`, (key) => {
      stop()
      if (!key) return
      cleanup = registerWebMcpTools(modelContext, {
        getProject: () => project.value,
        getCurrentPage: () => page.value,
        navigate: path => navigateTo(path),
        fetch: (url, init) => fetch(url, init)
      })
    }, { immediate: true })
  })

  onBeforeUnmount(stop)
}
