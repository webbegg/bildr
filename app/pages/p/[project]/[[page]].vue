<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import { listKey, listNodes, listQueryOf, listSearch } from '#shared/runtime/list'
import type { VisitorSnapshot } from '#shared/runtime/visitor'

/**
 * The published app: the last published snapshot, rendered by the shared runtime.
 * Each List query on the page reads its records from the public data endpoint,
 * which serves only `publicRead` collections; a failed read renders nothing.
 * Forms post their values to the same endpoint, which takes them only for
 * `publicCreate` collections, and show its (generic) message on failure.
 * `{{ env.NAME }}` resolves from the snapshot's public variables (copied at
 * publish); a secret or missing one renders empty.
 */
definePageMeta({ layout: false })

const route = useRoute()
const projectSlug = computed(() => String(route.params.project))
const { data, error } = await useFetch<VisitorSnapshot>(() => `/api/published/${projectSlug.value}`)

const project = computed(() => data.value?.project)
const env = computed(() => data.value?.env ?? {})
const page = computed(() => {
  const pages = project.value?.pages ?? []
  return route.params.page ? pages.find(p => p.slug === route.params.page) : pages[0]
})

const lists = shallowRef<Record<string, DataRecord[]>>({})
// Collections the snapshot does not mark publicRead would only answer 404, so they are not asked.
const queries = computed(() => {
  const readable = new Set(project.value?.collections.filter(c => c.publicRead).map(c => c.slug))
  const all = page.value ? listNodes(page.value.root, project.value?.components).map(node => listQueryOf(node.props)).filter(q => readable.has(q.collection)) : []
  return [...new Map(all.map(q => [listKey(q), q])).values()]
})
watch(queries, async (current) => {
  const entries = await Promise.all(current.map(async (query) => {
    const url = `/api/public/${projectSlug.value}/${query.collection}?${listSearch(query)}`
    const result = await $fetch<{ records: DataRecord[] }>(url).catch(() => null)
    return result ? [[listKey(query), result.records] as const] : []
  }))
  if (current === queries.value) lists.value = Object.fromEntries(entries.flat())
}, { immediate: true })

async function submitForm(collection: string, values: Record<string, string>): Promise<void> {
  try {
    await $fetch(`/api/public/${projectSlug.value}/${collection}`, { method: 'POST', body: { values } })
  } catch (error) {
    const data = (error as { data?: { message?: string } }).data
    throw new Error(data?.message || 'Could not send the form, try again later', { cause: error })
  }
}

useWebMcp(project, page)
useTheme(() => project.value?.theme, env)

useHead(() => ({ title: page.value && project.value ? `${page.value.name} · ${project.value.name}` : 'Not found' }))
</script>

<template>
  <BildrPage
    v-if="page"
    :page="page"
    :base="`/p/${projectSlug}`"
    :lists="lists"
    :components="project?.components"
    :submit-form="submitForm"
    :env="env"
    missing-env="empty"
    class="min-h-screen"
  />
  <UError
    v-else
    :error="{ statusCode: 404, statusMessage: error ? 'This app has not been published' : 'Page not found' }"
  />
</template>
