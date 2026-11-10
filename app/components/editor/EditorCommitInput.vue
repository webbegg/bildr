<script setup lang="ts">
/**
 * A text field that commits on change (blur or Enter) rather than on every
 * keystroke, so each edit is a single undo step: the kit's soft field
 * (editorUi.ts), like EditorInput with `commit="change"`. `variables` adds the
 * Insert variable button (`secrets` where they resolve: API URLs and headers);
 * an insert commits at once. `variant="outline"` is deprecated.
 */
const props = withDefaults(defineProps<{ modelValue: string, multiline?: boolean, placeholder?: string, size?: 'xs' | 'sm', variant?: 'outline' | 'soft', variables?: 'public' | 'secrets' }>(), { size: 'sm', variant: 'soft', variables: undefined })
const emit = defineEmits<{ commit: [value: string] }>()

const draft = ref(props.modelValue)
watch(() => props.modelValue, (value) => {
  draft.value = value
})

const ui = computed(() => (props.variant === 'soft' ? props.multiline ? TEXTAREA_UI : INPUT_UI : undefined))

function commit() {
  if (draft.value !== props.modelValue) emit('commit', draft.value)
}

function insert(text: string) {
  draft.value = text
  commit()
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
  >
    <template
      v-if="variables"
      #trailing
    >
      <EditorVariablePicker
        :secrets="variables === 'secrets'"
        @insert="insert"
      />
    </template>
  </UTextarea>
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
  >
    <template
      v-if="variables"
      #trailing
    >
      <EditorVariablePicker
        :secrets="variables === 'secrets'"
        @insert="insert"
      />
    </template>
  </UInput>
</template>
