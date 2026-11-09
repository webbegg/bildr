<script setup lang="ts">
import { FRAME_BAR_HEIGHT, frameBar, PRIMARY_FRAME_HINT } from '#shared/editor/viewport'

/**
 * A canvas frame's header bar, Framer's `▶ Desktop 1280  +`, placed above
 * the frame inside the zoomed content: it spans the frame and keeps its
 * screen height and font at any zoom. Blue on the active frame. Clicking it
 * activates the frame; ▶ previews the draft at the frame's width; `+`
 * (custom breakpoints) is not built yet.
 */
const props = defineProps<{ device: { label: string, width: number, breakpoint?: string }, zoom: number, active: boolean }>()
const emit = defineEmits<{ activate: [], preview: [] }>()
const bar = computed(() => frameBar(props.device, props.zoom))
</script>

<template>
  <div
    class="absolute bottom-full left-0 origin-bottom-left pb-2"
    :style="{ width: `${bar.width}px`, transform: `scale(${bar.scale})` }"
    data-frame-bar
    :data-active="active || undefined"
  >
    <div
      class="flex cursor-pointer items-center gap-1 rounded-md px-1 text-[13px] whitespace-nowrap"
      :class="active ? 'bg-(--editor-selection)/18 text-[#4cb3ff]' : 'bg-white/5 text-muted hover:bg-white/8 hover:text-default'"
      :style="{ height: `${FRAME_BAR_HEIGHT}px` }"
      @click="emit('activate')"
    >
      <UTooltip
        :text="`Preview at ${bar.size} px`"
        :content="{ side: 'top' }"
      >
        <button
          type="button"
          class="flex size-5 shrink-0 items-center justify-center rounded-[4px]"
          :class="active ? 'bg-(--editor-selection) text-white' : 'hover:bg-white/10'"
          :aria-label="`Preview ${bar.name} ${bar.size}`"
          data-frame-preview
          @click.stop="emit('activate'); emit('preview')"
        >
          <UIcon
            name="i-lucide-play"
            class="size-3"
          />
        </button>
      </UTooltip>
      <UTooltip
        :text="PRIMARY_FRAME_HINT"
        :disabled="!bar.primary"
        :content="{ side: 'top' }"
      >
        <button
          type="button"
          class="flex min-w-0 items-center gap-1.5 truncate px-1 font-medium"
          :aria-label="`${bar.name} ${bar.size}${bar.primary ? ' (Primary)' : ''}`"
          data-frame-label
          @click.stop="emit('activate')"
        >
          <span class="truncate">{{ bar.name }}</span>
          <span
            v-if="bar.showSize"
            class="font-normal opacity-80"
          >{{ bar.size }}</span>
          <span
            v-if="bar.primary && bar.showPrimary"
            class="text-[11px] font-normal opacity-60"
          >Primary</span>
        </button>
      </UTooltip>
      <UTooltip
        v-if="bar.showAdd"
        text="Custom breakpoints coming soon"
        :content="{ side: 'top' }"
      >
        <span
          class="ms-auto flex shrink-0"
          data-frame-add
        >
          <button
            type="button"
            disabled
            class="flex size-5 items-center justify-center rounded-[4px] opacity-60"
            aria-label="Add breakpoint"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-3.5"
            />
          </button>
        </span>
      </UTooltip>
    </div>
  </div>
</template>
