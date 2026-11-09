<script setup lang="ts">
import type { Page } from '#shared/document/schema'

const props = defineProps<{ page: Page, base: string, editable?: boolean }>()

provide(RUNTIME_KEY, reactive({
  base: computed(() => props.base),
  editable: computed(() => props.editable === true)
}) as RuntimeContext)
</script>

<template>
  <BildrNode :node="page.root" />
</template>
