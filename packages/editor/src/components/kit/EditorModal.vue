<script setup lang="ts">
import { computed } from 'vue'
import { MODAL_UI, MODAL_WIDTHS, mergeUi } from '../../editorUi.ts'
import type { ModalWidth, UiSlots } from '../../editorUi.ts'
/**
 * The kit's dialog over UModal: a 13 px title and optional description, the
 * default slot as the body and the `footer` slot as right-aligned actions
 * under a divider. The `trigger` slot is UModal's own trigger. It carries the
 * dark chrome itself (`bildr-chrome`, MODAL_UI), so it is dark on any page.
 */
const props = withDefaults(defineProps<{
  title: string
  description?: string
  width?: ModalWidth
  ui?: UiSlots
}>(), { description: undefined, width: 'md', ui: undefined })
const open = defineModel<boolean>('open', { default: false })

const ui = computed(() => mergeUi(mergeUi(MODAL_UI, { content: MODAL_WIDTHS[props.width] }), props.ui))
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
    :ui="ui"
  >
    <template
      v-if="$slots.trigger"
      #default
    >
      <slot name="trigger" />
    </template>
    <template #body>
      <slot />
    </template>
    <template
      v-if="$slots.footer"
      #footer
    >
      <slot name="footer" />
    </template>
  </UModal>
</template>
