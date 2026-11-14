<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { FIELD_INVALID, INPUT_MONO_UI, INPUT_UI, mergeUi } from '../../editorUi.ts'
import type { UiSlots } from '../../editorUi.ts'
/**
 * The kit's one-line field (editorUi.ts). With `commit="change"` it edits a
 * draft and emits `commit` (and the v-model update) on blur or Enter, and Esc
 * reverts, so each edit is one undo step; `input` updates on every keystroke.
 * It always emits strings (`type="number"` included). Attributes
 * (`aria-label`, `data-*`) land on the <input>.
 */
const props = withDefaults(defineProps<{
  modelValue?: string | number | null
  placeholder?: string
  mono?: boolean
  type?: string
  readonly?: boolean
  disabled?: boolean
  invalid?: boolean
  icon?: string
  commit?: 'input' | 'change'
  autofocus?: boolean
  ui?: UiSlots
}>(), { modelValue: '', placeholder: undefined, type: 'text', icon: undefined, commit: 'input', ui: undefined })
const emit = defineEmits<{ 'update:modelValue': [value: string], 'commit': [value: string] }>()

const text = (value: string | number | null | undefined) => String(value ?? '')
const draft = ref(text(props.modelValue))
watch(() => props.modelValue, (value) => {
  draft.value = text(value)
})

const ui = computed(() => {
  const base = props.mono ? INPUT_MONO_UI : INPUT_UI
  return mergeUi(props.invalid ? mergeUi(base, { base: FIELD_INVALID }) : base, props.ui)
})

function onInput(value: string) {
  draft.value = value
  if (props.commit === 'input') emit('update:modelValue', value)
}

function onChange() {
  if (props.commit !== 'change' || draft.value === text(props.modelValue)) return
  emit('update:modelValue', draft.value)
  emit('commit', draft.value)
}

function onEscape() {
  if (props.commit === 'change') draft.value = text(props.modelValue)
}

const field = useTemplateRef<{ inputRef: HTMLInputElement | null }>('field')
defineExpose({
  focus: () => field.value?.inputRef?.focus(),
  select: () => field.value?.inputRef?.select()
})
</script>

<template>
  <UInput
    ref="field"
    :model-value="draft"
    :type="type"
    :placeholder="placeholder"
    :readonly="readonly"
    :disabled="disabled"
    :icon="icon"
    :autofocus="autofocus"
    :aria-invalid="invalid || undefined"
    size="sm"
    variant="soft"
    :ui="ui"
    class="w-full"
    @update:model-value="onInput"
    @change="onChange"
    @keydown.esc="onEscape"
  >
    <template
      v-if="$slots.leading"
      #leading
    >
      <slot name="leading" />
    </template>
    <template
      v-if="$slots.trailing"
      #trailing
    >
      <slot name="trailing" />
    </template>
  </UInput>
</template>
