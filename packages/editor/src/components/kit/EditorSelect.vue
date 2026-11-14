<script setup lang="ts">
import { computed } from 'vue'
import { SELECT_COMPACT_UI, SELECT_MONO_UI, SELECT_UI, findOption, mergeUi, toOptions } from '../../editorUi.ts'
import type { EditorOption, UiSlots } from '../../editorUi.ts'
import type { SelectProps } from '@nuxt/ui'

/**
 * The kit's select: the soft field with the kit's menu popover. `items` are
 * strings or `{ label, value, icon?, disabled? }`. `compact` is an icon-only
 * 28 px trigger showing the current option's icon (or `icon`), its label for
 * screen readers. USelect's slots (`item-label`, …) and attributes pass
 * through.
 */
const props = withDefaults(defineProps<{
  items: readonly (string | EditorOption)[]
  modelValue?: string
  placeholder?: string
  mono?: boolean
  compact?: boolean
  disabled?: boolean
  icon?: string
  content?: SelectProps['content']
  ui?: UiSlots
}>(), { modelValue: undefined, placeholder: undefined, icon: undefined, content: undefined, ui: undefined })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const options = computed(() => toOptions(props.items))
const current = computed(() => findOption(options.value, props.modelValue))
const ui = computed(() => mergeUi(props.compact ? SELECT_COMPACT_UI : props.mono ? SELECT_MONO_UI : SELECT_UI, props.ui))
const content = computed(() => props.content ?? (props.compact ? { align: 'start' as const } : undefined))
</script>

<template>
  <USelect
    :model-value="modelValue"
    :items="options"
    :placeholder="placeholder"
    :disabled="disabled"
    :icon="compact ? current?.icon ?? icon : icon"
    :trailing-icon="compact ? '' : undefined"
    :content="content"
    size="sm"
    :variant="compact ? 'ghost' : 'soft'"
    :ui="ui"
    :class="compact ? 'shrink-0' : 'w-full'"
    @update:model-value="emit('update:modelValue', $event as string)"
  >
    <template
      v-if="compact && !$slots.default"
      #default
    >
      <span class="sr-only">{{ current?.label ?? placeholder }}</span>
    </template>
    <template
      v-for="(_, name) in $slots"
      #[name]="slotProps"
    >
      <slot
        :name="name"
        v-bind="slotProps ?? {}"
      />
    </template>
  </USelect>
</template>
