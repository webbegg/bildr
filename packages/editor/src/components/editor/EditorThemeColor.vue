<script setup lang="ts">
import { computed, ref } from 'vue'
import { DEFAULT_THEME, HEX_COLOR, PALETTE_NAMES, themeColorValue } from '@bildr/codegen/design'
import type { PaletteName, ThemeColorName } from '@bildr/codegen/design'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * One semantic colour of the project theme, as a panel row: a Tailwind
 * palette, or a custom hex. Dragging the colour picker previews live
 * (`themeDraft`); closing it commits a single `theme_update`.
 */
const props = defineProps<{ name: ThemeColorName }>()
const editor = useEditor()

const committed = computed(() => (editor.model?.theme ?? DEFAULT_THEME).colors[props.name])
const isHex = computed(() => HEX_COLOR.test(committed.value))
const swatch = computed(() => themeColorValue(editor.theme!, props.name, '500'))
const label = computed(() => props.name[0]!.toUpperCase() + props.name.slice(1))

const palette = computed(() => (isHex.value ? undefined : committed.value as PaletteName))
const paletteItems = computed(() => PALETTE_NAMES.map(palette => ({
  label: palette,
  value: palette,
  color: themeColorValue({ ...editor.theme!, colors: { ...editor.theme!.colors, [props.name]: palette } }, props.name, '500')
})))

const open = ref(false)
const pending = ref<string | null>(null)

function setPalette(palette: string) {
  if (palette !== committed.value) editor.updateTheme({ colors: { [props.name]: palette } })
}

function onDrag(hex: string | undefined) {
  if (!hex) return
  pending.value = hex
  editor.previewTheme({ colors: { [props.name]: hex } })
}

async function commitPending() {
  const hex = pending.value
  pending.value = null
  if (hex && hex.toLowerCase() !== committed.value.toLowerCase()) await editor.updateTheme({ colors: { [props.name]: hex } })
  else editor.themeDraft = null
}

function onOpen(value: boolean) {
  open.value = value
  if (!value) void commitPending()
}

function setHex(value: string) {
  const hex = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`
  pending.value = null
  editor.updateTheme({ colors: { [props.name]: hex } })
}
</script>

<template>
  <EditorRow
    :label="label"
    :name="`color-${name}`"
  >
    <EditorSelect
      :model-value="palette"
      :items="paletteItems"
      placeholder="Custom"
      :aria-label="`${label} palette`"
      :data-theme-color="name"
      @update:model-value="setPalette($event)"
    >
      <template #leading>
        <span
          class="block size-3 rounded-full ring ring-default"
          :style="{ background: swatch }"
        />
      </template>
      <template #item-leading="{ item }">
        <span
          class="block size-3 rounded-full ring ring-default"
          :style="{ background: item.color }"
        />
      </template>
    </EditorSelect>
    <UPopover
      :open="open"
      @update:open="onOpen"
    >
      <EditorButton
        icon="i-lucide-pipette"
        variant="ghost"
        :aria-label="`${label} custom colour`"
      />
      <template #content>
        <div class="w-56 space-y-2 p-2">
          <UColorPicker
            :model-value="pending ?? (isHex ? committed : undefined)"
            size="sm"
            class="mx-auto"
            @update:model-value="onDrag"
          />
          <EditorCommitInput
            :model-value="pending ?? (isHex ? committed : '')"
            placeholder="#rrggbb"
            @commit="setHex"
          />
        </div>
      </template>
    </UPopover>
  </EditorRow>
</template>
