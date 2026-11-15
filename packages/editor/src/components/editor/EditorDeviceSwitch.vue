<script setup lang="ts">
import { computed } from 'vue'
import { deviceHint } from '@bildr/editor-core/devices'
import { devicesFor } from '@bildr/editor-core/styleFields'
import type { DeviceId } from '@bildr/editor-core/styleFields'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * Interim device switch (not in the hosted editor): the hosted editor picks the
 * device on the canvas frames (their bar and "+", U6), which the P4 canvas does not
 * have yet. Until U6 this toolbar group edits a device, showing its frame (the
 * layers' frame rows) when it is hidden. Remove it with the frame bar.
 */
const editor = useEditor()
const devices = computed(() => devicesFor(editor.breakpointBase))

function choose(id: DeviceId) {
  if (editor.frames.includes(id)) editor.setDevice(id)
  else editor.showFrame(id)
}
</script>

<template>
  <div
    class="flex items-center gap-0.5"
    role="group"
    aria-label="Device"
    data-testid="devices"
  >
    <UTooltip
      v-for="device in devices"
      :key="device.id"
      :text="deviceHint(device)"
    >
      <EditorButton
        variant="ghost"
        :icon="device.icon"
        :aria-label="device.label"
        :aria-pressed="editor.deviceId === device.id"
        :class="{ 'bg-white/10 text-highlighted': editor.deviceId === device.id }"
        :data-testid="`device-${device.id}`"
        @click="choose(device.id)"
      />
    </UTooltip>
  </div>
</template>
