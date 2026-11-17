<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { rovingTarget } from '../../editor/rovingKeys.ts'
import { FOCUS_RING } from '../../editorUi.ts'

/**
 * The kit's pick of one among a few options that each need a line to explain them: a radiogroup of cards (`items`: a `value`, a
 * `label` and a one-line `description`). It is one tab stop (a roving tabindex: the card chosen, else the first); the arrows of
 * either axis go round the cards and pick the one they reach, and Home and End pick the first and the last. The chosen card shows
 * a dot in its radio, not a colour only. `label` names the group for screen readers. `hook` is the data attribute each card
 * carries with its value (`data-storage="sample"`), and `<hook>-description` the one on its description, so the screens that use
 * it keep their own hooks. `columns` lays the cards out in one column (the default) or two.
 */
const props = withDefaults(defineProps<{
  items: readonly { value: string, label: string, description?: string }[]
  modelValue?: string
  label: string
  hook?: string
  columns?: 1 | 2
}>(), { modelValue: undefined, hook: undefined, columns: 1 })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const group = useTemplateRef<HTMLElement>('group')

/** The card that is the tab stop. */
const stop = computed(() => Math.max(0, props.items.findIndex(item => item.value === props.modelValue)))

function onKeyDown(event: KeyboardEvent, at: number) {
  const count = props.items.length
  const to = rovingTarget(event.key, at, count, { axis: 'vertical', wrap: true }) ?? rovingTarget(event.key, at, count, { axis: 'horizontal', wrap: true })
  if (to === null) return
  event.preventDefault()
  emit('update:modelValue', props.items[to]!.value)
  group.value?.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus()
}
</script>

<template>
  <div
    ref="group"
    class="w-full gap-2"
    :class="columns === 2 ? 'grid grid-cols-2' : 'flex flex-col'"
    role="radiogroup"
    :aria-label="label"
  >
    <button
      v-for="(item, at) in items"
      :key="item.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === item.value"
      :tabindex="at === stop ? 0 : -1"
      class="flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors"
      :class="[FOCUS_RING, modelValue === item.value ? 'border-primary bg-primary/10' : 'border-white/8 hover:bg-white/4']"
      v-bind="hook ? { [hook]: item.value } : {}"
      @click="emit('update:modelValue', item.value)"
      @keydown="onKeyDown($event, at)"
    >
      <span
        class="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border"
        :class="modelValue === item.value ? 'border-primary' : 'border-white/25'"
        aria-hidden="true"
        data-choice-radio
      >
        <span
          v-if="modelValue === item.value"
          class="size-1.5 rounded-full bg-primary"
          data-choice-dot
        />
      </span>
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="text-[12px] font-[550] text-highlighted">{{ item.label }}</span>
        <span
          v-if="item.description"
          class="text-[11px] leading-4 text-muted"
          v-bind="hook ? { [`${hook}-description`]: '' } : {}"
        >{{ item.description }}</span>
      </span>
    </button>
  </div>
</template>
