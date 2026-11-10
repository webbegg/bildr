<script setup lang="ts">
/**
 * EditorInput over several lines: the same soft field, `commit` modes and
 * Esc revert; it grows with its text from `rows`. With `commit="change"` it
 * commits on blur (Enter adds a line).
 */
const props = withDefaults(defineProps<{
  modelValue?: string | null
  placeholder?: string
  mono?: boolean
  rows?: number
  readonly?: boolean
  disabled?: boolean
  invalid?: boolean
  icon?: string
  commit?: 'input' | 'change'
  autofocus?: boolean
  ui?: UiSlots
}>(), { modelValue: '', placeholder: undefined, rows: 3, icon: undefined, commit: 'input', ui: undefined })
const emit = defineEmits<{ 'update:modelValue': [value: string], 'commit': [value: string] }>()

const draft = ref(props.modelValue ?? '')
watch(() => props.modelValue, (value) => {
  draft.value = value ?? ''
})

const ui = computed(() => {
  const base = props.mono ? TEXTAREA_MONO_UI : TEXTAREA_UI
  return mergeUi(props.invalid ? mergeUi(base, { base: FIELD_INVALID }) : base, props.ui)
})

function onInput(value: string) {
  draft.value = value
  if (props.commit === 'input') emit('update:modelValue', value)
}

function onChange() {
  if (props.commit !== 'change' || draft.value === (props.modelValue ?? '')) return
  emit('update:modelValue', draft.value)
  emit('commit', draft.value)
}

function onEscape() {
  if (props.commit === 'change') draft.value = props.modelValue ?? ''
}

const field = useTemplateRef<{ textareaRef: HTMLTextAreaElement | null }>('field')
defineExpose({
  focus: () => field.value?.textareaRef?.focus(),
  select: () => field.value?.textareaRef?.select()
})
</script>

<template>
  <UTextarea
    ref="field"
    :model-value="draft"
    :placeholder="placeholder"
    :rows="rows"
    autoresize
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
  </UTextarea>
</template>
