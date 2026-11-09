<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import type { Project } from '#shared/document/schema'
import { listKey, listNodes, listQueryOf, listRecords } from '#shared/runtime/list'

/**
 * The draft preview the editor's Preview button opens: the project as it is
 * now, unpublished edits included, rendered by the shared runtime with its
 * theme, so links and layout behave as they will once published. It reads
 * through the editor's actions (`project_get`, `record_list`), so like the
 * editor it is same-origin only. Lists show the collections' records as the
 * canvas does; forms don't submit.
 */
definePageMeta({ layout: false })

const route = useRoute()
const projectId = computed(() => String(route.params.projectId))
const project = shallowRef<Project | null>(null)
const loadError = ref<string | null>(null)

const page = computed(() => {
  const pages = project.value?.pages ?? []
  return route.params.page ? pages.find(p => p.slug === route.params.page) : pages[0]
})

/** Records of each collection a List on the page shows, by collection id (the first 500, as in the canvas). */
const collectionRecords = shallowRef<Record<string, DataRecord[]>>({})
const listCollections = computed(() => {
  const slugs = new Set(page.value ? listNodes(page.value.root).map(node => listQueryOf(node.props).collection) : [])
  return project.value?.collections.filter(c => slugs.has(c.slug)) ?? []
})
const lists = computed(() => {
  const out: Record<string, DataRecord[]> = {}
  for (const node of page.value ? listNodes(page.value.root) : []) {
    const query = listQueryOf(node.props)
    const shown = listCollections.value.find(c => c.slug === query.collection)
    if (shown) out[listKey(query)] = listRecords(shown, collectionRecords.value[shown.id] ?? [], query)
  }
  return out
})

watch(listCollections, async (current) => {
  const entries = await Promise.all(current.map(async (c) => {
    const result = await callAction<{ records: DataRecord[] }>('record_list', { projectId: projectId.value, collection: c.id, limit: 500 }).catch(() => null)
    return result ? [[c.id, result.records] as const] : []
  }))
  if (current === listCollections.value) collectionRecords.value = Object.fromEntries(entries.flat())
})

watch(projectId, async (id) => {
  try {
    project.value = await callAction<Project>('project_get', { projectId: id })
  } catch (error) {
    loadError.value = actionErrorMessage(error)
  }
}, { immediate: true })

useTheme(() => project.value?.theme)

const badgeStyle = {
  position: 'fixed', top: '12px', right: '12px', zIndex: 50, pointerEvents: 'none',
  padding: '4px 10px', borderRadius: '9999px', background: 'rgba(28, 28, 28, 0.88)', color: '#fff',
  font: '500 12px/16px Inter, system-ui, sans-serif', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)'
} as const

useHead(() => ({ title: page.value && project.value ? `${page.value.name} · ${project.value.name} (draft)` : 'Draft preview' }))
</script>

<template>
  <div v-if="page && project">
    <BildrPage
      :page="page"
      :base="`/preview/${projectId}`"
      :lists="lists"
      class="min-h-screen"
    />
    <!-- Editor chrome, so fixed values: the project theme redefines the spacing scale and the neutral palette. -->
    <div
      :style="badgeStyle"
      data-draft-badge
    >
      Draft preview
    </div>
  </div>
  <UError
    v-else-if="loadError || project"
    :error="{ statusCode: 404, statusMessage: loadError ?? 'Page not found' }"
  />
</template>
