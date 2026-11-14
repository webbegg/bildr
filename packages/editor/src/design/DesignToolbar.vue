<script setup lang="ts">
import { computed } from 'vue'
import { deviceHint } from '@bildr/editor-core/devices'
import { zoomLabel } from './scale.ts'
import type { FileKind } from './store.ts'
import { useDesign } from './store.ts'

/** The Design toolbar: the file picker (pages, components, layouts), the device switch, undo and redo, the preview toggle. */

const design = useDesign()

const GROUPS: Array<{ kind: FileKind, label: string }> = [
  { kind: 'page', label: 'Pages' },
  { kind: 'component', label: 'Components' },
  { kind: 'layout', label: 'Layouts' }
]
const groups = computed(() => GROUPS.map(group => ({ ...group, files: design.files.value.filter(file => file.kind === group.kind) })).filter(group => group.files.length))

const pick = (event: Event) => design.openFile((event.target as HTMLSelectElement).value)
const preview = computed(() => design.mode.value === 'preview')
</script>

<template>
  <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
    <select
      data-testid="file-picker"
      class="rounded-md border border-default bg-default px-2 py-1 text-sm"
      :value="design.fileId.value ?? ''"
      @change="pick"
    >
      <optgroup
        v-for="group in groups"
        :key="group.kind"
        :label="group.label"
      >
        <option
          v-for="file in group.files"
          :key="file.id"
          :value="file.id"
        >
          {{ file.name }}
        </option>
      </optgroup>
    </select>

    <div
      class="flex items-center gap-1"
      data-testid="devices"
    >
      <UTooltip
        v-for="device in design.devices.value"
        :key="device.id"
        :text="deviceHint(device)"
      >
        <UButton
          :data-testid="`device-${device.id}`"
          :icon="device.icon"
          :aria-label="device.label"
          size="xs"
          color="neutral"
          :variant="device.id === design.device.value.id ? 'soft' : 'ghost'"
          @click="design.chooseDevice(device.id)"
        />
      </UTooltip>
    </div>

    <span
      class="w-10 text-xs text-muted tabular-nums"
      title="The canvas is shown scaled down to fit; it lays out at the device's width"
      data-testid="zoom"
    >{{ zoomLabel(design.zoom.value) }}</span>

    <div class="flex items-center gap-1">
      <UButton
        data-testid="undo"
        icon="i-lucide-undo-2"
        aria-label="Undo"
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="design.history.value.undo === 0"
        @click="design.undo()"
      />
      <UButton
        data-testid="redo"
        icon="i-lucide-redo-2"
        aria-label="Redo"
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="design.history.value.redo === 0"
        @click="design.redo()"
      />
    </div>

    <UButton
      data-testid="preview-toggle"
      :icon="preview ? 'i-lucide-pencil-ruler' : 'i-lucide-play'"
      :label="preview ? 'Edit' : 'Preview'"
      size="xs"
      color="neutral"
      :variant="preview ? 'soft' : 'ghost'"
      @click="design.mode.value = preview ? 'edit' : 'preview'"
    />

    <div class="ml-auto flex min-w-0 items-center gap-2 text-xs">
      <span
        v-if="design.regenerated.value && !design.regenerated.value.ok"
        data-testid="regenerate-error"
        class="truncate text-error"
        :title="design.regenerated.value.error ?? design.regenerated.value.problems?.map(problem => problem.message).join('\n')"
      >
        The app could not regenerate
      </span>
      <template v-if="design.error.value">
        <span
          data-testid="design-error"
          class="max-w-96 truncate text-error"
          :title="design.error.value"
        >
          {{ design.error.value }}
        </span>
        <UButton
          data-testid="design-error-dismiss"
          icon="i-lucide-x"
          aria-label="Dismiss"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="design.dismissError()"
        />
      </template>
    </div>
  </header>
</template>
