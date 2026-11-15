<script setup lang="ts">
import { computed } from 'vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { DEFAULT_THEME, spacingBasePx, THEME_COLORS, themeOptions } from '@bildr/codegen/design'
import type { Theme } from '@bildr/codegen/design'
import { customColorName, customColorNameProblem } from '@bildr/editor-core/color'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * The Design view's right panel: the project theme's controls, in the
 * inspector's sections and rows; the style guide follows live. Custom
 * colours are the theme's own named colours (also created from the colour
 * picker's "Create colour from this"); "+" names a new one.
 */
const editor = useEditor()
const toast = useToast()
const options = themeOptions()

const theme = computed(() => editor.model?.theme ?? DEFAULT_THEME)
const fontItems = options.fonts.map(font => ({ label: font === 'system' ? 'System UI' : font, value: font }))
const radiusItems = options.radii.map(radius => ({ label: `${radius} · ${Number.parseFloat(radius) * 16}px`, value: radius }))
const spacingItems = options.spacings.map(({ name }) => ({ label: `${name[0]!.toUpperCase()}${name.slice(1)} · ${Math.round(spacingBasePx(name) * 10) / 10}px`, value: name }))
const spacingHint = computed(() => `mt-10 = ${Math.round(10 * spacingBasePx(theme.value.spacing) * 10) / 10}px`)
const radiusHint = computed(() => {
  const px = Number.parseFloat(theme.value.radius) * 16
  return `rounded-sm = ${px}px, rounded-lg = ${2 * px}px`
})

function update(patch: Partial<Omit<Theme, 'colors' | 'custom'>>) {
  void editor.updateTheme(patch)
}

const customNames = computed(() => Object.keys(theme.value.custom ?? {}))

function addCustom() {
  const typed = window.prompt('Name the new colour (e.g. brand, ink-2)', '')
  if (typed === null) return
  const name = customColorName(typed)
  const problem = customColorNameProblem(name, customNames.value)
  if (problem) {
    toast.add({ title: 'Colour not created', description: problem, color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }
  void editor.run('theme_update', { custom: { [name]: '#6366f1' } })
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
    <EditorStyleSection
      label="Custom colours"
      add-label="Add custom colour"
      :menu="[{ id: 'add', label: 'New colour', hint: 'A named colour of your own, usable on any colour' }]"
      data-custom-colors
      @add="addCustom"
    >
      <EditorCustomColor
        v-for="name in customNames"
        :key="name"
        :name="name"
      />
      <p
        v-if="!customNames.length"
        class="text-[11px] text-dimmed"
      >
        Use + or a colour picker's "Create colour from this" to add one.
      </p>
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
