<script setup lang="ts">
import { spacingBasePx, THEME_COLORS, themeOptions } from '#shared/design/theme'
import type { Theme } from '#shared/design/theme'

/** The Design view's right panel: the project theme's controls, in the inspector's sections and rows; the style guide follows live. */
const editor = useEditor()
const options = themeOptions()

const theme = computed(() => editor.project!.theme)
const fontItems = options.fonts.map(font => ({ label: font === 'system' ? 'System UI' : font, value: font }))
const radiusItems = options.radii.map(radius => ({ label: `${radius} · ${Number.parseFloat(radius) * 16}px`, value: radius }))
const spacingItems = options.spacings.map(({ name }) => ({ label: `${name[0]!.toUpperCase()}${name.slice(1)} · ${Math.round(spacingBasePx(name) * 10) / 10}px`, value: name }))
const spacingHint = computed(() => `mt-10 = ${Math.round(10 * spacingBasePx(theme.value.spacing) * 10) / 10}px`)
const radiusHint = computed(() => {
  const px = Number.parseFloat(theme.value.radius) * 16
  return `rounded-sm = ${px}px, rounded-lg = ${2 * px}px`
})

function update(patch: Partial<Omit<Theme, 'colors'>>) {
  editor.updateTheme(patch)
}
</script>

<template>
  <div data-design-panel>
    <EditorStyleSection label="Colours">
      <EditorThemeColor
        v-for="name in THEME_COLORS"
        :key="name"
        :name="name"
      />
    </EditorStyleSection>
    <EditorStyleSection label="Typography">
      <EditorRow label="Font">
        <EditorSelect
          :model-value="theme.font"
          :items="fontItems"
          aria-label="Font"
          @update:model-value="update({ font: $event })"
        />
      </EditorRow>
    </EditorStyleSection>
    <EditorStyleSection label="Radius">
      <EditorRow label="Base">
        <EditorSelect
          :model-value="theme.radius"
          :items="radiusItems"
          aria-label="Radius"
          @update:model-value="update({ radius: $event as Theme['radius'] })"
        />
      </EditorRow>
      <p class="ps-24 text-[11px] text-dimmed">
        {{ radiusHint }}
      </p>
    </EditorStyleSection>
    <EditorStyleSection label="Spacing">
      <EditorRow label="Density">
        <EditorSelect
          :model-value="theme.spacing"
          :items="spacingItems"
          aria-label="Spacing density"
          @update:model-value="update({ spacing: $event as Theme['spacing'] })"
        />
      </EditorRow>
      <p class="ps-24 text-[11px] text-dimmed">
        {{ spacingHint }}
      </p>
    </EditorStyleSection>
  </div>
</template>
