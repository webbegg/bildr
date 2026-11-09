<script setup lang="ts">
/**
 * A text field that commits on change (blur or Enter) rather than on every
 * keystroke, so each edit is a single undo step.
 */
const props = withDefaults(defineProps<{ modelValue: string, multiline?: boolean, placeholder?: string, size?: 'xs' | 'sm' }>(), { size: 'sm' })
const emit = defineEmits<{ commit: [value: string] }>()

const draft = ref(props.modelValue)
watch(() => props.modelValue, (value) => {
  draft.value = value
})

function commit() {
  if (draft.value !== props.modelValue) emit('commit', draft.value)
}
</script>

<template>
  <UTextarea
    v-if="multiline"
    v-model="draft"
    :placeholder="placeholder"
    :rows="3"
    autoresize
    :size="size"
    class="w-full"
    @change="commit"
  />
  <UInput
    v-else
    v-model="draft"
    :placeholder="placeholder"
    :size="size"
    class="w-full"
    @change="commit"
    @keydown.esc="draft = modelValue"
  />
</template>
