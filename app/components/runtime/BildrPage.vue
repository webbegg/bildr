<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import type { ComponentDefinition, Layout, Page } from '#shared/document/schema'
import type { EnvValues } from '#shared/env/variables'
import { resolvePageWithLayout } from '#shared/runtime/layouts'

/**
 * A page as it renders: inside its layout when it has one (see
 * `resolvePageWithLayout`), so the canvas, the preview and published apps
 * all show the layout around the page content.
 */

const props = defineProps<{
  page: Page
  base: string
  editable?: boolean
  lists?: Record<string, DataRecord[]>
  submitForm?: RuntimeContext['submitForm']
  /** Public variables for `{{ env.NAME }}`. */
  env?: EnvValues
  /** The project's component definitions, for Instance nodes. */
  components?: ComponentDefinition[]
  /** The project's layouts, for pages with a `layoutId`. */
  layouts?: Layout[]
  missingEnv?: RuntimeContext['onMissingEnv']
}>()

const root = computed(() => resolvePageWithLayout(props.page, props.layouts ?? [], props.components ?? []))

provide(RUNTIME_KEY, reactive({
  base: computed(() => props.base),
  editable: computed(() => props.editable === true),
  lists: computed(() => props.lists ?? {}),
  submitForm: computed(() => props.submitForm),
  env: computed(() => props.env),
  components: computed(() => props.components),
  onMissingEnv: computed(() => props.missingEnv)
}) as RuntimeContext)
</script>

<template>
  <BildrNode :node="root" />
</template>
