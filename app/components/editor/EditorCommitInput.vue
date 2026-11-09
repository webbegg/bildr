<script setup lang="ts">
/**
 * A text field that commits on change (blur or Enter) rather than on every
 * keystroke, so each edit is a single undo step.
 */
const props = defineProps<{ modelValue: string, multiline?: boolean, placeholder?: string }>()
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
    size="sm"
    class="w-full"
    @change="commit"
  />
  <UInput
    v-else
    v-model="draft"
    :placeholder="placeholder"
    size="sm"
    class="w-full"
    @change="commit"
    @keydown.esc="draft = modelValue"
  />
</template>
