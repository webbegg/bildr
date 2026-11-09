<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import type { Page } from '#shared/document/schema'

const props = defineProps<{ page: Page, base: string, editable?: boolean, lists?: Record<string, DataRecord[]> }>()

provide(RUNTIME_KEY, reactive({
  base: computed(() => props.base),
  editable: computed(() => props.editable === true),
  lists: computed(() => props.lists ?? {})
}) as RuntimeContext)
</script>

<template>
  <BildrNode :node="page.root" />
</template>
