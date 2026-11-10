<script setup lang="ts">
/**
 * The kit's boolean: a small selection-blue switch, with an optional 13 px
 * `label` on its right. Also for "include" toggles that were checkboxes.
 * Attributes (`aria-label`, `data-*`) land on the switch button.
 */
withDefaults(defineProps<{ modelValue?: boolean, label?: string, disabled?: boolean }>(), { modelValue: false, label: undefined })
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <USwitch
    :model-value="modelValue"
    :label="label"
    :disabled="disabled"
    size="sm"
    :ui="{ root: 'items-center', wrapper: 'ms-2', label: 'text-[13px] font-normal text-default' }"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
