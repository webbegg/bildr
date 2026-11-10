<script setup lang="ts">
import type { RecordValue } from '#shared/data/records'
import type { Field } from '#shared/document/schema'

/** A record value in the panel: edits a draft and commits once on blur or Enter (a toggle at once); Esc restores it. */
const props = defineProps<{ field: Field, modelValue: RecordValue, readonly?: boolean }>()
const emit = defineEmits<{ commit: [value: RecordValue] }>()

const draft = ref<RecordValue>(props.modelValue)
watch(() => props.modelValue, (value) => {
  draft.value = value
})

const shown = computed(() => {
  if (props.modelValue === null || props.modelValue === '') return '—'
  if (props.field.type === 'boolean') return props.modelValue ? 'Yes' : 'No'
  return String(props.modelValue)
})

function onUpdate(value: RecordValue) {
  draft.value = value
  if (props.field.type === 'boolean') commit()
}

function commit() {
  if (draft.value !== props.modelValue) emit('commit', draft.value)
}
</script>

<template>
  <span
    v-if="readonly"
    class="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-toned"
  >
    <img
      v-if="field.type === 'image' && modelValue"
      :src="String(modelValue)"
      alt=""
      class="size-[30px] shrink-0 rounded-md object-cover"
    >
    <span class="truncate">{{ shown }}</span>
  </span>
  <div
    v-else
    class="min-w-0 flex-1"
    @focusout="commit"
    @keydown.enter="commit"
    @keydown.esc="draft = modelValue"
  >
    <DataValueInput
      :field="field"
      :model-value="draft"
      @update:model-value="onUpdate"
    />
  </div>
</template>
