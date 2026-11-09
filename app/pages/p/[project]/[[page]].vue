<script setup lang="ts">
import type { PublishedSnapshot } from '#shared/document/schema'

/** The published app: the last published snapshot, rendered by the shared runtime. */
definePageMeta({ layout: false })

const route = useRoute()
const projectSlug = computed(() => String(route.params.project))
const { data, error } = await useFetch<PublishedSnapshot>(() => `/api/published/${projectSlug.value}`)

const project = computed(() => data.value?.project)
const page = computed(() => {
  const pages = project.value?.pages ?? []
  return route.params.page ? pages.find(p => p.slug === route.params.page) : pages[0]
})

useHead(() => ({ title: page.value && project.value ? `${page.value.name} · ${project.value.name}` : 'Not found' }))
</script>

<template>
  <BildrPage
    v-if="page"
    :page="page"
    :base="`/p/${projectSlug}`"
    class="min-h-screen"
  />
  <UError
    v-else
    :error="{ statusCode: 404, statusMessage: error ? 'This app has not been published' : 'Page not found' }"
  />
</template>
