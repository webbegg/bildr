<script setup lang="ts">
import { HEX_COLOR, PALETTE_NAMES, themeColorValue } from '#shared/design/theme'
import type { PaletteName } from '#shared/design/palettes'
import type { ThemeColorName } from '#shared/design/theme'

/**
 * One semantic colour of the project theme: a Tailwind palette, or a custom
 * hex. Dragging the colour picker previews in the canvas; closing it commits
 * a single `theme_update`.
 */
const props = defineProps<{ name: ThemeColorName }>()
const editor = useEditor()

const committed = computed(() => editor.project!.theme.colors[props.name])
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
  <div class="grid grid-cols-[5rem_1fr_auto] items-center gap-1.5">
    <span class="text-xs text-toned">{{ label }}</span>
    <USelect
      :model-value="palette"
      :items="paletteItems"
      placeholder="Custom"
      size="xs"
      class="w-full"
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
    </USelect>
    <UPopover
      :open="open"
      @update:open="onOpen"
    >
      <UButton
        icon="i-lucide-pipette"
        color="neutral"
        variant="ghost"
        size="xs"
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
  </div>
</template>
