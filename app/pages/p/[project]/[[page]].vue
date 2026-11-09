<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import type { PublishedSnapshot } from '#shared/document/schema'
import { listKey, listNodes, listQueryOf, listSearch } from '#shared/runtime/list'

/**
 * The published app: the last published snapshot, rendered by the shared runtime.
 * Each List query on the page reads its records from the public data endpoint,
 * which serves only `publicRead` collections; a failed read renders nothing.
 */
definePageMeta({ layout: false })

const route = useRoute()
const projectSlug = computed(() => String(route.params.project))
const { data, error } = await useFetch<PublishedSnapshot>(() => `/api/published/${projectSlug.value}`)

const project = computed(() => data.value?.project)
const page = computed(() => {
  const pages = project.value?.pages ?? []
  return route.params.page ? pages.find(p => p.slug === route.params.page) : pages[0]
})

const lists = shallowRef<Record<string, DataRecord[]>>({})
// Collections the snapshot does not mark publicRead would only answer 404, so they are not asked.
const queries = computed(() => {
  const readable = new Set(project.value?.collections.filter(c => c.publicRead).map(c => c.slug))
  const all = page.value ? listNodes(page.value.root).map(node => listQueryOf(node.props)).filter(q => readable.has(q.collection)) : []
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

useWebMcp(project, page)
useTheme(() => project.value?.theme)

useHead(() => ({ title: page.value && project.value ? `${page.value.name} · ${project.value.name}` : 'Not found' }))
</script>

<template>
  <BildrPage
    v-if="page"
    :page="page"
    :base="`/p/${projectSlug}`"
    :lists="lists"
    class="min-h-screen"
  />
  <UError
    v-else
    :error="{ statusCode: 404, statusMessage: error ? 'This app has not been published' : 'Page not found' }"
  />
</template>
