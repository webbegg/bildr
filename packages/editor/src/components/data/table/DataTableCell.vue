<script setup lang="ts">
import { computed } from 'vue'
import { cellText } from '../../../shared/dataTable.ts'
import type { DataField } from '../../../shared/dataModel.ts'

/** One table cell, read-only (rows are app data, E2): the value, a toggle that shows its state, or an image. The hosted inline editor is not ported. */
const props = defineProps<{ field: DataField, value: unknown }>()

const text = computed(() => cellText(props.field.type, props.value))
const raw = computed(() => props.value === null || props.value === undefined ? '' : String(props.value))
</script>

<template>
  <button
    v-if="field.type === 'boolean'"
    type="button"
    role="switch"
    :aria-checked="value === true"
    :aria-label="field.label"
    disabled
    class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:cursor-default"
    :class="value === true ? 'bg-primary' : 'bg-white/14'"
    tabindex="-1"
    data-cell-toggle
  >
    <span
      class="size-3 rounded-full bg-white shadow transition-transform"
      :class="value === true ? 'translate-x-3.5' : 'translate-x-0.5'"
    />
  </button>
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
