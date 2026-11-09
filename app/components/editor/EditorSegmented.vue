<script setup lang="ts">
/** A compact segmented control: one button per value, the current one highlighted. */
defineProps<{
  items: { value: string, label: string, icon?: string }[]
  modelValue: string | undefined
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
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
      :color="item.value === modelValue ? 'primary' : 'neutral'"
      :variant="item.value === modelValue ? 'soft' : 'outline'"
      class="flex-1 justify-center"
      @click="emit('update:modelValue', item.value)"
    />
  </UFieldGroup>
</template>
