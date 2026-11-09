<script setup lang="ts">
/**
 * A text field that commits on change (blur or Enter) rather than on every
 * keystroke, so each edit is a single undo step. The `soft` variant is the
 * right panel's soft borderless Framer field.
 */
const props = withDefaults(defineProps<{ modelValue: string, multiline?: boolean, placeholder?: string, size?: 'xs' | 'sm', variant?: 'outline' | 'soft' }>(), { size: 'sm', variant: 'outline' })
const emit = defineEmits<{ commit: [value: string] }>()

const draft = ref(props.modelValue)
watch(() => props.modelValue, (value) => {
  draft.value = value
})

// The soft field is the panel's 30 px Framer field.
const ui = computed(() => (props.variant === 'soft' ? { base: props.multiline ? 'rounded-lg bg-elevated text-[13px]' : 'h-[30px] rounded-lg bg-elevated text-[13px]' } : undefined))

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
    :variant="variant"
    :ui="ui"
    class="w-full"
    @change="commit"
  />
  <UInput
    v-else
    v-model="draft"
    :placeholder="placeholder"
    :size="size"
    :variant="variant"
    :ui="ui"
    class="w-full"
    @change="commit"
    @keydown.esc="draft = modelValue"
  />
</template>
