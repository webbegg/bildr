<script setup lang="ts">
import { computed } from 'vue'
import { cellText } from '../../../shared/dataTable.ts'
import type { DataField } from '../../../shared/dataModel.ts'

/** One table cell, read-only (rows are app data, E2): the value, a check or a dash for a boolean (shown, not a control: nothing in a cell looks clickable), or an image. The hosted inline editor is not ported. */
const props = defineProps<{ field: DataField, value: unknown }>()

const text = computed(() => cellText(props.field.type, props.value))
const raw = computed(() => props.value === null || props.value === undefined ? '' : String(props.value))
</script>

<template>
  <span
    v-if="field.type === 'boolean'"
    role="img"
    :aria-label="`${field.label}: ${value === true ? 'true' : 'false'}`"
    class="inline-flex size-4 items-center justify-center"
    :data-cell-bool="value === true ? 'true' : 'false'"
  >
    <UIcon
      v-if="value === true"
      name="i-lucide-check"
      class="size-3.5 text-toned"
    />
    <span
      v-else
      class="h-px w-2.5 bg-white/25"
    />
  </span>
  <img
    v-else-if="field.type === 'image' && text"
    :src="raw"
    :alt="field.label"
    :title="raw"
    class="block h-6 w-10 rounded-md border border-white/10 bg-white/4 object-cover"
    data-cell-image
  >
  <span
    v-else
    class="block truncate"
    :class="[text ? 'text-default' : 'text-dimmed', { 'tabular-nums': field.type === 'number' || field.type === 'integer' }]"
    :title="text"
  >{{ text }}</span>
</template>
