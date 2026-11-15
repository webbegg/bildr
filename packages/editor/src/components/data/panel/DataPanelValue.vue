<script setup lang="ts">
import { computed } from 'vue'
import { cellText } from '../../../shared/dataTable.ts'
import type { DataField } from '../../../shared/dataModel.ts'

/** A row's value in the panel, read-only: rows are app data (E2), so there is no input here (the hosted `DataValueInput` is not ported). */
const props = defineProps<{ field: DataField, modelValue: unknown }>()

const shown = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined || props.modelValue === '') return '—'
  if (props.field.type === 'boolean') return props.modelValue ? 'Yes' : 'No'
  return cellText(props.field.type, props.modelValue)
})
</script>

<template>
  <span class="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-toned">
    <img
      v-if="field.type === 'image' && modelValue"
      :src="String(modelValue)"
      alt=""
      class="size-[30px] shrink-0 rounded-md object-cover"
    >
    <span
      class="truncate"
      :title="shown"
    >{{ shown }}</span>
  </span>
</template>
