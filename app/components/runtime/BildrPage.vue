<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import type { ComponentDefinition, Layout, Page } from '#shared/document/schema'
import type { EnvValues } from '#shared/env/variables'
import { resolvePageWithLayout } from '#shared/runtime/layouts'

/**
 * A page as it renders: inside its layout when it has one (see
 * `resolvePageWithLayout`), so the canvas, the preview and published apps
 * all show the layout around the page content. Interactive ones keep the
 * layout's instances as Instance nodes, so they react like page instances.
 */

// A boolean prop left out is false, not undefined: `interactive` needs its own default.
const props = withDefaults(defineProps<{
  page: Page
  base: string
  editable?: boolean
  /** Instances run their states and interactions; defaults to not `editable` (the preview and published apps). */
  interactive?: boolean
  lists?: Record<string, DataRecord[]>
  submitForm?: RuntimeContext['submitForm']
  /** Public variables for `{{ env.NAME }}`. */
  env?: EnvValues
  /** The project's component definitions, for Instance nodes. */
  components?: ComponentDefinition[]
  /** The project's layouts, for pages with a `layoutId`. */
  layouts?: Layout[]
  missingEnv?: RuntimeContext['onMissingEnv']
}>(), { interactive: undefined })

const interactive = computed(() => props.interactive ?? props.editable !== true)
const root = computed(() => resolvePageWithLayout(props.page, props.layouts ?? [], props.components ?? [], { linked: interactive.value }))

provide(RUNTIME_KEY, reactive({
  base: computed(() => props.base),
  editable: computed(() => props.editable === true),
  interactive,
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
