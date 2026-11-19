<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ScopeName } from '@bildr/codegen/edit'
import { FIELD_INVALID, INPUT_UI, mergeUi, TEXTAREA_UI, VARIABLE_FIELD_UI } from '../../editorUi.ts'

/**
 * A text field that commits on change (blur or Enter) rather than on every
 * keystroke, so each edit is a single undo step: the kit's soft field
 * (editorUi.ts), like EditorInput with `commit="change"`. `variables` adds the
 * Insert variable button (the names the selected node can read, see
 * EditorVariablePicker); an insert commits at once. `variant="outline"` is deprecated.
 * `numeric` (the module's number values): a typo (`abc`) is refused and the saved value shows
 * again, so it can never reach an action as `null` and remove the value. A text of spaces alone
 * is blank like an empty one: it commits as `''`, never as a number (`Number('  ')` is 0).
 * `invalid` marks the field as refused by its owner (which shows why); `edit` tells the owner the
 * draft changed, so it can clear that. `names` are the names the Insert variable menu lists, when not the selected node's.
 */
const props = withDefaults(defineProps<{ modelValue: string, multiline?: boolean, placeholder?: string, size?: 'xs' | 'sm', variant?: 'outline' | 'soft', variables?: boolean, numeric?: boolean, invalid?: boolean, names?: ScopeName[] }>(), { size: 'sm', variant: 'soft', variables: false, invalid: false, names: undefined })
const emit = defineEmits<{ commit: [value: string], edit: [] }>()

const draft = ref(props.modelValue)
watch(() => props.modelValue, (value) => {
  draft.value = value
})

const ui = computed(() => {
  if (props.variant !== 'soft') return undefined
  const base = props.multiline ? TEXTAREA_UI : INPUT_UI
  const field = props.variables ? mergeUi(base, VARIABLE_FIELD_UI) : base
  return props.invalid ? mergeUi(field, { base: FIELD_INVALID }) : field
})

function commit() {
  if (draft.value === props.modelValue) return
  if (props.numeric && draft.value.trim() !== '' && !Number.isFinite(Number(draft.value))) {
    draft.value = props.modelValue
    return
  }
  emit('commit', props.numeric && draft.value.trim() === '' ? '' : draft.value)
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
    :aria-invalid="invalid || undefined"
    class="w-full"
    @update:model-value="emit('edit')"
    @change="commit"
  >
    <template
      v-if="variables"
      #trailing
    >
      <EditorVariablePicker
        :names="names"
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
    :aria-invalid="invalid || undefined"
    class="w-full"
    @update:model-value="emit('edit')"
    @change="commit"
    @keydown.esc="draft = modelValue"
  >
    <template
      v-if="variables"
      #trailing
    >
      <EditorVariablePicker
        :names="names"
        @insert="insert"
      />
    </template>
  </UInput>
</template>
