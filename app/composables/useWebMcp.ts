import type { Page, Project } from '#shared/document/schema'
import { getModelContext, registerWebMcpTools } from '#shared/runtime/webmcp'

/**
 * Exposes the published app to in-browser agents over WebMCP. A no-op when the
 * browser has no `modelContext`. Re-registers when the project changes.
 */
export function useWebMcp(project: Ref<Project | undefined>, page: Ref<Page | undefined>) {
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
        navigate: path => navigateTo(path)
      })
    }, { immediate: true })
  })

  onBeforeUnmount(stop)
}
