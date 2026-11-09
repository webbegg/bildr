<script setup lang="ts">
/**
 * A compact segmented control: one button per value, the current one highlighted.
 * An `inherited` value (from a smaller breakpoint) is outlined when nothing is set.
 */
const props = defineProps<{
  items: { value: string, label: string, icon?: string }[]
  modelValue: string | undefined
  inherited?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const isInherited = (value: string) => props.modelValue === undefined && value === props.inherited
</script>

<template>
  <UFieldGroup
    size="xs"
    class="flex w-full"
  >
    <UButton
      v-for="item in items"
      :key="item.value"
      :label="item.icon ? undefined : item.label"
      :icon="item.icon"
      :aria-label="item.label"
      :aria-pressed="item.value === modelValue"
      :data-inherited="isInherited(item.value) || undefined"
      :color="item.value === modelValue || isInherited(item.value) ? 'primary' : 'neutral'"
      :variant="item.value === modelValue ? 'soft' : 'outline'"
      class="flex-1 justify-center"
      @click="emit('update:modelValue', item.value)"
    />
  </UFieldGroup>
</template>
