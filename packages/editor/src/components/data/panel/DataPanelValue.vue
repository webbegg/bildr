<script setup lang="ts">
import { computed, ref } from 'vue'
import { cellEditText, cellValue } from '../../../shared/dataGrid.ts'
import { cellText } from '../../../shared/dataTable.ts'
import type { DataField } from '../../../shared/dataModel.ts'
import type { CellValue } from '../../../editor/sampleRows.ts'

/**
 * A row's value in the panel. Read-only for the app's rows (E2: there is no input for them); the sample data's (`save` given)
 * is an input, a switch for a boolean, saved when the field is left (one module action, `fixture_row_update`), unless the
 * field is read-only (the app sets it). `save` answers the module's refusal, which shows under the field with what was typed
 * still in it, until the next save or Escape.
 */
const props = defineProps<{ field: DataField, modelValue: unknown, save?: (value: CellValue) => Promise<string | undefined> }>()

const editable = computed(() => !!props.save && !props.field.readonly)
const refusal = ref('')
const saving = ref(false)

const shown = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined || props.modelValue === '') return '—'
  if (props.field.type === 'boolean') return props.modelValue ? 'Yes' : 'No'
  return cellText(props.field.type, props.modelValue)
})

async function put(value: CellValue) {
  refusal.value = ''
  saving.value = true
  refusal.value = await props.save!(value) ?? ''
  saving.value = false
}
</script>

<template>
  <div
    v-if="editable"
    class="flex min-w-0 flex-1 flex-col gap-1"
  >
    <EditorSwitch
      v-if="field.type === 'boolean'"
      :model-value="modelValue === true"
      :disabled="saving"
      :aria-label="field.label"
      @update:model-value="put($event)"
    />
    <EditorInput
      v-else
      :model-value="cellEditText(modelValue)"
      commit="change"
      :disabled="saving"
      :invalid="!!refusal"
      :placeholder="field.type === 'date' ? 'YYYY-MM-DD' : field.type === 'datetime' ? '2026-01-15T09:30:00Z' : undefined"
      :aria-label="field.label"
      @keydown.esc="refusal = ''"
      @commit="put(cellValue(field, $event))"
    />
    <p
      v-if="refusal"
      class="text-[11px] leading-tight text-error"
      role="alert"
      data-field-error
    >
      {{ refusal }}
    </p>
  </div>
  <span
    v-else
    class="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-toned"
  >
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
