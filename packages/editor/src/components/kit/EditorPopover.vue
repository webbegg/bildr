<script setup lang="ts">
import { computed } from 'vue'
import { ACTION } from '../../editorUi.ts'
import type { PopoverProps } from '@nuxt/ui'

/**
 * The kit's popover over UPopover, the inspector's look (EditorBoxRow): a
 * 48 px header with the 12 px title and a close button, then the default
 * slot as the body. The `trigger` slot opens it; without one, the `anchor`
 * slot (e.g. a point on the canvas) places it and `open` drives it.
 * Attributes (`data-*`) land on the body.
 */
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  title: string
  content?: PopoverProps['content']
  width?: string
}>(), { content: undefined, width: 'w-72' })
const open = defineModel<boolean>('open', { default: false })

const content = computed(() => ({ side: 'left' as const, align: 'start' as const, sideOffset: 8, ...props.content }))
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="content"
  >
    <template
      v-if="$slots.trigger"
      #default
    >
      <slot name="trigger" />
    </template>
    <template
      v-if="$slots.anchor"
      #anchor
    >
      <slot name="anchor" />
    </template>
    <template #content>
      <div
        class="rounded-xl"
        :class="width"
        v-bind="$attrs"
      >
        <div class="flex h-12 items-center justify-between border-b border-default ps-4 pe-2">
          <span class="text-[12px] font-[550] text-highlighted">{{ title }}</span>
          <button
            type="button"
            :class="ACTION"
            aria-label="Close"
            @click="open = false"
          >
            <UIcon
              name="i-lucide-x"
              class="size-4"
            />
          </button>
        </div>
        <div class="space-y-2 p-4">
          <slot />
        </div>
      </div>
    </template>
  </UPopover>
</template>
