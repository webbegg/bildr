<script setup lang="ts">
import { ICON_NAME } from '#shared/document/schema'

/**
 * An icon name field with a live preview. A bare Lucide name (`coffee`) is
 * completed to `i-lucide-coffee`; it commits on change like
 * EditorCommitInput, and only names the document accepts (or empty).
 */
const props = withDefaults(defineProps<{ modelValue: string, size?: 'xs' | 'sm', variant?: 'outline' | 'soft' }>(), { size: 'sm', variant: 'outline' })
const emit = defineEmits<{ commit: [value: string] }>()

const draft = ref(props.modelValue)
watch(() => props.modelValue, (value) => {
  draft.value = value
})

const name = computed(() => {
  const value = draft.value.trim()
  return value && !value.startsWith('i-') ? `i-lucide-${value}` : value
})
const valid = computed(() => name.value === '' || ICON_NAME.test(name.value))

function commit() {
  if (!valid.value || name.value === props.modelValue) return
  draft.value = name.value
  emit('commit', name.value)
}
</script>

<template>
  <UInput
    v-model="draft"
    placeholder="i-lucide-coffee"
    :size="size"
    :variant="variant"
    :ui="variant === 'soft' ? { base: 'h-6 rounded-[5px] text-[11px]' } : undefined"
    class="w-full"
    :color="valid ? undefined : 'error'"
    :highlight="!valid"
    @change="commit"
    @keydown.esc="draft = modelValue"
  >
    <template #leading>
      <UIcon
        v-if="name && valid"
        :name="name"
        class="size-3.5 text-highlighted"
        data-icon-preview
      />
      <UIcon
        v-else
        name="i-lucide-circle-dashed"
        class="size-3.5 text-dimmed"
      />
    </template>
  </UInput>
</template>
