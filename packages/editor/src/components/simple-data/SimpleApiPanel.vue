<script setup lang="ts">
import DataEmptyState from '../data/DataEmptyState.vue'
import type { SimpleApi } from '../../shared/simpleData.ts'

/**
 * An API's panel in the simple Data section (simple data, S2): for now the API's name and its base URL, as a placeholder where its
 * queries and actions are edited in a later step. The API is read only here.
 */
const { api } = defineProps<{ api: SimpleApi }>()
</script>

<template>
  <div
    class="flex size-full min-w-0 flex-col"
    :data-simple-api-panel="api.id"
  >
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default ps-6 pe-3">
      <UIcon
        name="i-lucide-globe"
        class="size-4 shrink-0 text-dimmed"
      />
      <h2
        class="truncate text-[13px] font-[550] text-highlighted"
        data-simple-title
      >
        {{ api.name }}
      </h2>
      <span class="shrink-0 text-[11px] text-dimmed">API</span>
    </header>
    <DataEmptyState
      icon="i-lucide-globe"
      :title="api.name"
      heading="h3"
    >
      <span
        class="block break-all font-mono text-toned"
        data-simple-api-url
      >{{ api.baseUrl }}</span>
      <span class="mt-2 block">Its queries and actions will be edited here soon.</span>
    </DataEmptyState>
  </div>
</template>
