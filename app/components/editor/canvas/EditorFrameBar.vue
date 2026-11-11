<script setup lang="ts">
import type { ContextMenuItem, DropdownMenuItem } from '@nuxt/ui'
import type { DeviceId } from '#shared/editor/styleFields'
import { FRAME_BAR_HEIGHT, frameBar, PRIMARY_FRAME_HINT } from '#shared/editor/viewport'

/**
 * A canvas frame's header bar, Framer's `▶ Desktop 1280  +`, placed above
 * the frame inside the zoomed content: it spans the frame and keeps its
 * screen height and font at any zoom. Blue on the active frame. Clicking it
 * activates the frame; ▶ previews the draft at the frame's width; `+` adds a
 * hidden frame back (e.g. Large phone 640). Right-clicking it offers to hide
 * the frame, except the Primary.
 */
const props = defineProps<{
  device: { label: string, width: number, breakpoint?: string }
  zoom: number
  active: boolean
  /** The frames `+` can add back. */
  hidden?: readonly { id: DeviceId, label: string, width: number, icon: string }[]
}>()
const emit = defineEmits<{ activate: [], preview: [], add: [id: DeviceId], hide: [] }>()
const bar = computed(() => frameBar(props.device, props.zoom))

const addItems = computed<DropdownMenuItem[]>(() => (props.hidden ?? []).map(d => ({
  label: `${d.label} ${d.width}`,
  icon: d.icon,
  onSelect: () => emit('add', d.id)
})))

function preview() {
  emit('activate')
  emit('preview')
}

const menuItems = computed<ContextMenuItem[][]>(() => [[
  { label: `Edit ${bar.value.name}`, icon: 'i-lucide-pencil', onSelect: () => emit('activate') },
  { label: 'Preview', icon: 'i-lucide-play', onSelect: preview }
], [
  bar.value.primary
    ? { label: 'The Primary frame stays visible', icon: 'i-lucide-eye-off', disabled: true }
    : { label: `Hide ${bar.value.name}`, icon: 'i-lucide-eye-off', onSelect: () => emit('hide') }
]])
</script>

<template>
  <div
    class="absolute bottom-full left-0 origin-bottom-left pb-2"
    :style="{ width: `${bar.width}px`, transform: `scale(${bar.scale})` }"
    data-frame-bar
    :data-active="active || undefined"
  >
    <UContextMenu
      :items="menuItems"
      :ui="MENU_UI"
    >
      <div
        class="flex cursor-pointer items-center gap-1 rounded-lg px-1 text-[12px] whitespace-nowrap"
        :class="active ? 'bg-(--editor-selection)/18 text-(--editor-selection)' : 'bg-white/5 text-muted hover:bg-white/8 hover:text-default'"
        :style="{ height: `${FRAME_BAR_HEIGHT}px` }"
        data-frame-bar-row
        @click="emit('activate')"
      >
        <UTooltip
          :text="`Preview at ${bar.size} px`"
          :content="{ side: 'top' }"
        >
          <button
            type="button"
            class="flex size-5 shrink-0 items-center justify-center rounded-md"
            :class="active ? 'bg-(--editor-selection) text-white' : 'hover:bg-white/10'"
            :aria-label="`Preview ${bar.name} ${bar.size}`"
            data-frame-preview
            @click.stop="preview"
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
            class="flex min-w-0 items-center gap-1.5 truncate px-1 font-[550]"
            :aria-label="`${bar.name} ${bar.size}${bar.primary ? ' (Primary)' : ''}`"
            data-frame-label
            @click.stop="emit('activate')"
          >
            <span class="truncate">{{ bar.name }}</span>
            <span
              v-if="bar.showSize"
              class="font-[450] opacity-80"
            >{{ bar.size }}</span>
            <span
              v-if="bar.primary && bar.showPrimary"
              class="text-[10px] font-[450] opacity-60"
            >Primary</span>
          </button>
        </UTooltip>
        <span
          v-if="bar.showAdd"
          class="ms-auto flex shrink-0"
          data-frame-add
          @click.stop
        >
          <EditorMenu
            v-if="addItems.length"
            :items="addItems"
            :content="{ side: 'bottom', align: 'end' }"
          >
            <UTooltip
              text="Add breakpoint"
              :content="{ side: 'top' }"
            >
              <button
                type="button"
                class="flex size-5 items-center justify-center rounded-md hover:bg-white/10"
                aria-label="Add breakpoint"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-3.5"
                />
              </button>
            </UTooltip>
          </EditorMenu>
          <UTooltip
            v-else
            text="Every breakpoint is shown"
            :content="{ side: 'top' }"
          >
            <span class="flex">
              <button
                type="button"
                disabled
                class="flex size-5 items-center justify-center rounded-md opacity-60"
                aria-label="Add breakpoint"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-3.5"
                />
              </button>
            </span>
          </UTooltip>
        </span>
      </div>
    </UContextMenu>
  </div>
</template>
