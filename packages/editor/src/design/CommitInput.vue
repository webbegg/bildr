<script setup lang="ts">
import { ref, watch } from 'vue'

/**
 * A text field that commits on change (blur or Enter), not on every key: each
 * commit is one edit action and one undo step. Follows the saved value when
 * it changes (undo, another editor).
 */

const props = defineProps<{ modelValue: string, multiline?: boolean, placeholder?: string, mono?: boolean }>()
const emit = defineEmits<{ commit: [value: string] }>()

const draft = ref(props.modelValue)
watch(() => props.modelValue, (value) => {
  draft.value = value
})

const commit = () => {
  if (draft.value !== props.modelValue) emit('commit', draft.value)
}
const enter = (event: KeyboardEvent) => {
  if (props.multiline && event.shiftKey) return
  ;(event.target as HTMLElement).blur()
}
const cls = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm outline-none focus:border-primary'
</script>

<template>
  <textarea
    v-if="multiline"
    v-model="draft"
    rows="3"
    :class="[cls, mono && 'font-mono']"
    :placeholder="placeholder"
    @change="commit"
    @keydown.enter.exact.prevent="enter"
  />
  <input
    v-else
    v-model="draft"
    type="text"
    :class="[cls, mono && 'font-mono']"
    :placeholder="placeholder"
    @change="commit"
    @keydown.enter="enter"
  >
</template>
