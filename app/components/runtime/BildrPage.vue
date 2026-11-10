<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import type { Page } from '#shared/document/schema'
import type { EnvValues } from '#shared/env/variables'

const props = defineProps<{
  page: Page
  base: string
  editable?: boolean
  lists?: Record<string, DataRecord[]>
  submitForm?: RuntimeContext['submitForm']
  /** Public variables for `{{ env.NAME }}`. */
  env?: EnvValues
  missingEnv?: RuntimeContext['onMissingEnv']
}>()

provide(RUNTIME_KEY, reactive({
  base: computed(() => props.base),
  editable: computed(() => props.editable === true),
  lists: computed(() => props.lists ?? {}),
  submitForm: computed(() => props.submitForm),
  env: computed(() => props.env),
  onMissingEnv: computed(() => props.missingEnv)
}) as RuntimeContext)
</script>

<template>
  <BildrNode :node="page.root" />
</template>
