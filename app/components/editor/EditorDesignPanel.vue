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
      <p class="text-[12px] text-muted">
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
      <EditorFormRow
        v-if="fields.has('Font')"
        label="Font"
        stacked
      >
        <EditorSelect
          :model-value="theme.font"
          :items="fontItems"
          aria-label="Font"
          @update:model-value="update({ font: $event })"
        />
      </EditorFormRow>
      <EditorFormRow
        v-if="fields.has('Radius')"
        label="Radius"
        stacked
        help="rounded-sm equals it; rounded-lg is twice it"
      >
        <EditorSelect
          :model-value="theme.radius"
          :items="radiusItems"
          aria-label="Radius"
          @update:model-value="update({ radius: $event as Theme['radius'] })"
        />
      </EditorFormRow>
      <EditorFormRow
        v-if="fields.has('Spacing density')"
        label="Spacing density"
        stacked
        :help="spacingHint"
      >
        <EditorSegmented
          :items="spacingItems"
          :model-value="theme.spacing"
          aria-label="Spacing density"
          @update:model-value="update({ spacing: $event as Theme['spacing'] })"
        />
      </EditorFormRow>
    </section>
  </div>
</template>
