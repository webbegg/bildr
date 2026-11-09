<script setup lang="ts">
import { spacingBasePx, THEME_COLORS, themeOptions } from '#shared/design/theme'
import type { Theme } from '#shared/design/theme'
import { filterByName } from '#shared/editor/sidebar'

/** Assets › Styles: edits the project theme; the canvas follows live. The sidebar search filters the rows by name. */
const { query = '' } = defineProps<{ query?: string }>()
const editor = useEditor()
const options = themeOptions()

const theme = computed(() => editor.project!.theme)
const fontItems = options.fonts.map(font => ({ label: font === 'system' ? 'System UI' : font, value: font }))
const radiusItems = options.radii.map(radius => ({ label: `${radius} · ${Number.parseFloat(radius) * 16}px`, value: radius }))
const spacingItems = options.spacings.map(({ name }) => ({ label: name, value: name }))
const spacingHint = computed(() => `mt-10 = ${10 * spacingBasePx(theme.value.spacing)}px`)

const colors = computed(() => filterByName(THEME_COLORS.map(name => ({ name })), query).map(c => c.name))
const fields = computed(() => new Set(filterByName([{ name: 'Font' }, { name: 'Radius' }, { name: 'Spacing density' }], query).map(f => f.name)))

function update(patch: Partial<Omit<Theme, 'colors'>>) {
  editor.updateTheme(patch)
}
</script>

<template>
  <div class="space-y-4">
    <section
      v-if="colors.length"
      class="space-y-1.5"
    >
      <p class="text-xs font-medium text-muted">
        Colours
      </p>
      <EditorThemeColor
        v-for="name in colors"
        :key="name"
        :name="name"
      />
    </section>

    <section
      v-if="fields.size"
      class="space-y-3"
    >
      <UFormField
        v-if="fields.has('Font')"
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
        v-if="fields.has('Radius')"
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
        v-if="fields.has('Spacing density')"
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
