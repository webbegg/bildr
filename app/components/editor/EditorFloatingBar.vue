<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { HAND_TOOL, INSERT_TOOLS, MOVE_TOOL, toolHint } from '#shared/editor/insertTools'
import { deviceHint } from '#shared/editor/devices'
import { frameShortcut } from '#shared/editor/frames'

/**
 * The canvas's floating bar, Framer-style, centred at the bottom: Move (V)
 * and Hand (H) tools, the device switch over the visible frames (Desktop ⌥1,
 * Tablet ⌥2, Mobile ⌥3 by default: the frame being edited, panned into
 * view), the canvas light/dark preview
 * and the zoom menu. The insert tools have no buttons; their letters arm
 * them, and the bar then shows a hint chip.
 */
const { zoom, zoomItems } = defineProps<{ zoom: number, zoomItems: DropdownMenuItem[][] }>()
const editor = useEditor()

const tools = INSERT_TOOLS.filter(tool => tool.id === MOVE_TOOL || tool.id === HAND_TOOL)
const hint = computed(() => toolHint(editor.tool))
/** A pressed toggle, lit like an open menu's trigger. */
const pressed = (on: boolean) => (on ? 'bg-white/10 text-highlighted' : '')
</script>

<template>
  <div
    class="flex h-11 items-center gap-1 rounded-xl bg-(--editor-bar) px-1.5 text-white/80 shadow-[0_4px_16px_rgba(0,0,0,0.35)] ring ring-white/10"
    role="toolbar"
    aria-label="Canvas"
    data-floating-bar
    @pointerdown.stop
  >
    <div
      v-if="hint"
      class="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg bg-(--editor-selection) px-2 py-1 text-[11px] whitespace-nowrap text-white shadow"
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
      <EditorButton
        variant="ghost"
        :icon="tool.icon"
        :class="pressed(editor.tool === tool.id)"
        :aria-label="`${tool.label} tool`"
        :aria-pressed="editor.tool === tool.id"
        :data-tool="tool.id"
        @click="editor.setTool(tool.id)"
      />
    </UTooltip>
    <span
      class="mx-1 h-5 w-px bg-white/10"
      aria-hidden="true"
    />
    <UTooltip
      v-for="device in editor.visibleDevices"
      :key="device.id"
      :text="deviceHint(device)"
      :kbds="frameShortcut(editor.frames, device.id)"
      :content="{ side: 'top' }"
    >
      <EditorButton
        variant="ghost"
        :icon="device.icon"
        :class="pressed(editor.deviceId === device.id)"
        :aria-label="device.label"
        :aria-pressed="editor.deviceId === device.id"
        :data-device-switch="device.id"
        @click="editor.setDevice(device.id)"
      />
    </UTooltip>
    <span
      class="mx-1 h-5 w-px bg-white/10"
      aria-hidden="true"
    />
    <UTooltip
      :text="editor.previewDark ? 'Preview light' : 'Preview dark'"
      :content="{ side: 'top' }"
    >
      <EditorButton
        variant="ghost"
        :icon="editor.previewDark ? 'i-lucide-sun' : 'i-lucide-moon'"
        :class="pressed(editor.previewDark)"
        aria-label="Preview theme"
        :aria-pressed="editor.previewDark"
        data-preview-theme
        @click="editor.setPreviewDark(!editor.previewDark)"
      />
    </UTooltip>
    <EditorMenu
      :items="zoomItems"
      :content="{ side: 'top', align: 'center', sideOffset: 10 }"
    >
      <EditorButton
        variant="ghost"
        trailing-icon="i-lucide-chevron-down"
        class="ml-0.5 bg-white/5 pe-1.5 text-highlighted tabular-nums hover:bg-white/10 aria-expanded:bg-white/10"
        :ui="{ trailingIcon: 'size-3.5 text-dimmed' }"
        aria-label="Zoom"
        data-zoom-menu
      >
        {{ Math.round(zoom * 100) }}%
      </EditorButton>
    </EditorMenu>
  </div>
</template>
