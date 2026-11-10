<script setup lang="ts">
import type { RecordValue } from '#shared/data/records'
import type { Field } from '#shared/document/schema'

/** One input per field type, the kit's soft 30 px field; the server validates and coerces what it sends. */
const props = defineProps<{ field: Field, modelValue: RecordValue }>()
const emit = defineEmits<{ 'update:modelValue': [value: RecordValue] }>()

const text = computed(() => (props.modelValue === null ? '' : String(props.modelValue)))
// A date input shows the day of an ISO date-time.
const day = computed(() => text.value.slice(0, 10))

function onNumber(value: string) {
  emit('update:modelValue', value === '' ? null : Number(value))
}
</script>

<template>
  <EditorSwitch
    v-if="field.type === 'boolean'"
    :model-value="modelValue === true"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <EditorInput
    v-else-if="field.type === 'number'"
    :model-value="text"
    type="number"
    step="any"
    @update:model-value="onNumber"
  />
  <EditorInput
    v-else-if="field.type === 'date'"
    :model-value="day"
    type="date"
    class="[color-scheme:dark]"
    @update:model-value="emit('update:modelValue', $event === '' ? null : $event)"
  />
  <div
    v-else-if="field.type === 'image'"
    class="flex w-full min-w-0 items-center gap-2"
  >
    <img
      v-if="text"
      :src="text"
      alt=""
      class="size-[30px] shrink-0 rounded-lg object-cover"
    >
    <EditorInput
      :model-value="text"
      placeholder="https://… or /image.png"
      class="min-w-0 flex-1"
      @update:model-value="emit('update:modelValue', $event === '' ? null : $event)"
    />
  </div>
  <EditorInput
    v-else
    :model-value="text"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
