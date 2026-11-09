<script setup lang="ts">
import { spacingBasePx, THEME_COLORS, themeOptions } from '#shared/design/theme'
import type { Theme } from '#shared/design/theme'

/** The Design section: edits the project theme; the canvas follows live. */
const editor = useEditor()
const options = themeOptions()

const theme = computed(() => editor.project!.theme)
const fontItems = options.fonts.map(font => ({ label: font === 'system' ? 'System UI' : font, value: font }))
const radiusItems = options.radii.map(radius => ({ label: `${radius} · ${Number.parseFloat(radius) * 16}px`, value: radius }))
const spacingItems = options.spacings.map(({ name }) => ({ label: name, value: name }))
const spacingHint = computed(() => `mt-10 = ${10 * spacingBasePx(theme.value.spacing)}px`)

function update(patch: Partial<Omit<Theme, 'colors'>>) {
  editor.updateTheme(patch)
}
</script>

<template>
  <div class="space-y-5 overflow-y-auto p-3">
    <div>
      <p class="text-xs font-semibold text-muted uppercase">
        Design system
      </p>
      <p class="mt-1 text-xs text-dimmed">
        The project theme. Every token class follows it, in the canvas and when published.
      </p>
    </div>

    <section class="space-y-1.5">
      <p class="text-xs font-medium text-muted">
        Colours
      </p>
      <EditorThemeColor
        v-for="name in THEME_COLORS"
        :key="name"
        :name="name"
      />
    </section>

    <section class="space-y-3">
      <UFormField
        label="Font"
        size="xs"
      >
        <USelect
          :model-value="theme.font"
          :items="fontItems"
          size="xs"
          class="w-full"
          @update:model-value="update({ font: $event })"
        />
      </UFormField>
      <UFormField
        label="Radius"
        size="xs"
        help="rounded-sm equals it; rounded-lg is twice it"
      >
        <USelect
          :model-value="theme.radius"
          :items="radiusItems"
          size="xs"
          class="w-full"
          @update:model-value="update({ radius: $event as Theme['radius'] })"
        />
      </UFormField>
      <UFormField
        label="Spacing density"
        size="xs"
        :help="spacingHint"
      >
        <EditorSegmented
          :items="spacingItems"
          :model-value="theme.spacing"
          @update:model-value="update({ spacing: $event as Theme['spacing'] })"
        />
      </UFormField>
    </section>
  </div>
</template>
