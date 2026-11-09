<script setup lang="ts">
import type { RecordValue } from '#shared/data/records'
import type { Field } from '#shared/document/schema'

/** One input per field type; the server validates and coerces what it sends. */
const props = defineProps<{ field: Field, modelValue: RecordValue }>()
const emit = defineEmits<{ 'update:modelValue': [value: RecordValue] }>()

const text = computed(() => (props.modelValue === null ? '' : String(props.modelValue)))
// A date input shows the day of an ISO date-time.
const day = computed(() => text.value.slice(0, 10))

function onNumber(value: string | number) {
  emit('update:modelValue', value === '' ? null : Number(value))
}
</script>

<template>
  <USwitch
    v-if="field.type === 'boolean'"
    :model-value="modelValue === true"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <UInput
    v-else-if="field.type === 'number'"
    :model-value="text"
    type="number"
    step="any"
    size="sm"
    class="w-full"
    @update:model-value="onNumber"
  />
  <UInput
    v-else-if="field.type === 'date'"
    :model-value="day"
    type="date"
    size="sm"
    class="w-full"
    @update:model-value="emit('update:modelValue', $event === '' ? null : String($event))"
  />
  <div
    v-else-if="field.type === 'image'"
    class="flex items-center gap-2"
  >
    <img
      v-if="text"
      :src="text"
      alt=""
      class="size-9 shrink-0 rounded object-cover ring ring-default"
    >
    <UInput
      :model-value="text"
      placeholder="https://… or /image.png"
      size="sm"
      class="flex-1"
      @update:model-value="emit('update:modelValue', $event === '' ? null : String($event))"
    />
  </div>
  <UInput
    v-else
    :model-value="text"
    size="sm"
    class="w-full"
    @update:model-value="emit('update:modelValue', String($event))"
  />
</template>
