<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { HAND_TOOL, INSERT_TOOLS, MOVE_TOOL, toolHint } from '#shared/editor/insertTools'
import { DEVICE_ORDER, deviceHint, deviceShortcut } from '#shared/editor/devices'

/**
 * The canvas's floating bar, Framer-style, centred at the bottom: Move (V)
 * and Hand (H) tools, the device switch (Desktop ⌥1, Tablet ⌥2, Mobile ⌥3:
 * the frame being edited, panned into view), the canvas light/dark preview
 * and the zoom menu. The insert tools have no buttons; their letters arm
 * them, and the bar then shows a hint chip.
 */
const { zoom, zoomItems } = defineProps<{ zoom: number, zoomItems: DropdownMenuItem[][] }>()
const editor = useEditor()

const tools = INSERT_TOOLS.filter(tool => tool.id === MOVE_TOOL || tool.id === HAND_TOOL)
const hint = computed(() => toolHint(editor.tool))
</script>

<template>
  <div
    class="flex h-11 items-center gap-1 rounded-xl bg-[#2c2c2c] px-1.5 text-white/80 shadow-[0_4px_16px_rgba(0,0,0,0.35)] ring ring-white/10"
    role="toolbar"
    aria-label="Canvas"
    data-floating-bar
    @pointerdown.stop
  >
    <div
      v-if="hint"
      class="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-md bg-(--editor-selection) px-2 py-1 text-[11px] whitespace-nowrap text-white shadow"
      role="status"
      data-tool-hint
    >
      {{ hint }}
    </div>
    <UTooltip
      v-for="tool in tools"
      :key="tool.id"
      :text="tool.label"
      :kbds="tool.keys"
      :content="{ side: 'top' }"
    >
      <button
        type="button"
        class="grid size-8 place-items-center rounded-lg"
        :class="editor.tool === tool.id ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'"
        :aria-label="`${tool.label} tool`"
        :aria-pressed="editor.tool === tool.id"
        :data-tool="tool.id"
        @click="editor.setTool(tool.id)"
      >
        <UIcon
          :name="tool.icon"
          class="size-4"
        />
      </button>
    </UTooltip>
    <span
      class="mx-1 h-5 w-px bg-white/10"
      aria-hidden="true"
    />
    <UTooltip
      v-for="device in DEVICE_ORDER"
      :key="device.id"
      :text="deviceHint(device)"
      :kbds="deviceShortcut(device.id)"
      :content="{ side: 'top' }"
    >
      <button
        type="button"
        class="grid size-8 place-items-center rounded-lg"
        :class="editor.deviceId === device.id ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'"
        :aria-label="device.label"
        :aria-pressed="editor.deviceId === device.id"
        :data-device-switch="device.id"
        @click="editor.setDevice(device.id)"
      >
        <UIcon
          :name="device.icon"
          class="size-4"
        />
      </button>
    </UTooltip>
    <span
      class="mx-1 h-5 w-px bg-white/10"
      aria-hidden="true"
    />
    <UTooltip
      :text="editor.previewDark ? 'Preview light' : 'Preview dark'"
      :content="{ side: 'top' }"
    >
      <button
        type="button"
        class="grid size-8 place-items-center rounded-lg"
        :class="editor.previewDark ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'"
        aria-label="Preview theme"
        :aria-pressed="editor.previewDark"
        data-preview-theme
        @click="editor.setPreviewDark(!editor.previewDark)"
      >
        <UIcon
          :name="editor.previewDark ? 'i-lucide-sun' : 'i-lucide-moon'"
          class="size-4"
        />
      </button>
    </UTooltip>
    <UDropdownMenu
      :items="zoomItems"
      size="sm"
      :content="{ side: 'top', align: 'center', sideOffset: 10 }"
    >
      <button
        type="button"
        class="ml-0.5 flex h-8 items-center gap-1.5 rounded-lg bg-white/5 pr-1.5 pl-2.5 text-xs text-white tabular-nums hover:bg-white/10"
        aria-label="Zoom"
        data-zoom-menu
      >
        {{ Math.round(zoom * 100) }}%
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3.5 text-white/60"
        />
      </button>
    </UDropdownMenu>
  </div>
</template>
