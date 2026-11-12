import type { Page } from '#shared/document/schema'
import type { BindingItem } from '#shared/runtime/bindings'
import type { VisitorProject } from '#shared/runtime/visitor'
import { getModelContext, registerWebMcpTools } from '#shared/runtime/webmcp'

/**
 * Exposes the published app to in-browser agents over WebMCP. A no-op when the
 * browser has no `modelContext`. Re-registers when the project changes.
 * The data tools reach the public endpoint with the browser's `fetch`.
 * On a detail page, `record` is the record it shows; the tools read it (and
 * the page) at each call, so they follow navigation without re-registering.
 */
export function useWebMcp(project: Ref<VisitorProject | undefined>, page: Ref<Page | undefined>, record?: Ref<BindingItem | null | undefined>) {
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
        getCurrentRecord: () => record?.value,
        navigate: path => navigateTo(path),
        fetch: (url, init) => fetch(url, init)
      })
    }, { immediate: true })
  })

  onBeforeUnmount(stop)
}
