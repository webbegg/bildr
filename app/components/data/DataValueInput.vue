<script setup lang="ts">
import type { RecordValue } from '#shared/data/records'
import type { Field } from '#shared/document/schema'

/** One input per field type, the inspector's soft 30 px field; the server validates and coerces what it sends. */
const props = defineProps<{ field: Field, modelValue: RecordValue }>()
const emit = defineEmits<{ 'update:modelValue': [value: RecordValue] }>()

const text = computed(() => (props.modelValue === null ? '' : String(props.modelValue)))
// A date input shows the day of an ISO date-time.
const day = computed(() => text.value.slice(0, 10))
const SOFT = { base: 'h-[30px] rounded-lg bg-elevated text-[13px]' }

function onNumber(value: string | number) {
  emit('update:modelValue', value === '' ? null : Number(value))
}
</script>

<template>
  <USwitch
    v-if="field.type === 'boolean'"
    :model-value="modelValue === true"
    size="sm"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <UInput
    v-else-if="field.type === 'number'"
    :model-value="text"
    type="number"
    step="any"
    size="xs"
    variant="soft"
    :ui="SOFT"
    class="w-full"
    @update:model-value="onNumber"
  />
  <UInput
    v-else-if="field.type === 'date'"
    :model-value="day"
    type="date"
    size="xs"
    variant="soft"
    :ui="SOFT"
    class="w-full"
    @update:model-value="emit('update:modelValue', $event === '' ? null : String($event))"
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
    <UInput
      :model-value="text"
      placeholder="https://… or /image.png"
      size="xs"
      variant="soft"
      :ui="SOFT"
      class="min-w-0 flex-1"
      @update:model-value="emit('update:modelValue', $event === '' ? null : String($event))"
    />
  </div>
  <UInput
    v-else
    :model-value="text"
    size="xs"
    variant="soft"
    :ui="SOFT"
    class="w-full"
    @update:model-value="emit('update:modelValue', String($event))"
  />
</template>
