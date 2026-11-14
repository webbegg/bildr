<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { PALETTES, themeColorValue } from '@bildr/codegen/design'
import type { PaletteName, Theme, ThemeColorName } from '@bildr/codegen/design'
import { customColorName, customColorNameProblem, normalizeHex, parseHex, rgbaToHex } from '@bildr/editor-core/color'
import { callAction, errorMessage } from '../api.ts'
import CommitInput from './CommitInput.vue'
import { useDesign } from './store.ts'

/**
 * The design system (`theme_get`, `theme_update`, `theme_presets_list`,
 * `theme_apply`): the theme's semantic colours (a Tailwind palette from the
 * picker, or a hex), the project's own named colours, radius, font and
 * spacing, the bundled presets, and two canvas previews: the dark colours and
 * the token sheet. Values show from the model; `theme_get` brings the options
 * each field takes.
 */

interface Options { colors: ThemeColorName[], palettes: PaletteName[], fonts: string[], radii: string[], spacings: Array<{ name: string, base: string }> }
interface Preset { id: string, name: string, theme: Theme }

const design = useDesign()
const options = ref<Options | null>(null)
const presets = ref<Preset[]>([])
const error = ref<string | null>(null)
const picking = ref<string | null>(null)
const custom = reactive({ name: '', hex: '' })

const theme = computed(() => design.theme.value)
const load = async () => {
  try {
    options.value = (await callAction<{ options: Options }>('theme_get')).options
    if (!presets.value.length) presets.value = (await callAction<{ presets: Preset[] }>('theme_presets_list')).presets
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}
onMounted(load)

const update = async (patch: Record<string, unknown>) => {
  error.value = null
  const out = await design.edit('theme_update', patch)
  if (out) await load()
  return out
}
const colorSwatch = (name: ThemeColorName) => themeColorValue(theme.value, name, '500')
const paletteSwatch = (name: PaletteName) => PALETTES[name][500]
const customNames = computed(() => Object.keys(theme.value.custom ?? {}))

const setColor = async (name: ThemeColorName, value: string) => {
  const result = await update({ colors: { [name]: value } })
  if (result) picking.value = null
}
const commitHex = (name: ThemeColorName, raw: string) => {
  const typed = raw.trim()
  if (typed === '') return
  if ((options.value?.palettes ?? []).includes(typed.toLowerCase() as PaletteName)) return setColor(name, typed.toLowerCase())
  const hex = normalizeHex(typed)
  const rgba = hex ? parseHex(hex) : undefined
  if (!rgba || rgba.a < 1) {
    error.value = 'Use a Tailwind palette name or a hex colour (#rrggbb)'
    return
  }
  return setColor(name, rgbaToHex(rgba))
}
const addCustom = async () => {
  const name = customColorName(custom.name)
  const hex = normalizeHex(custom.hex)
  const problem = customColorNameProblem(name, customNames.value) ?? (hex ? undefined : 'Use a #rgb, #rrggbb or #rrggbbaa hex colour')
  if (problem) {
    error.value = problem
    return
  }
  if (await update({ custom: { [name]: hex } })) {
    custom.name = ''
    custom.hex = ''
  }
}
const pick = (key: 'radius' | 'font' | 'spacing', event: Event) => update({ [key]: (event.target as HTMLSelectElement).value })
const apply = (id: string) => design.edit('theme_apply', { preset: id })
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'
</script>

<template>
  <div
    class="flex flex-col gap-3 p-2"
    data-testid="theme-panel"
  >
    <p
      v-if="error"
      class="text-xs text-error"
      data-testid="theme-error"
    >
      {{ error }}
    </p>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-semibold">
        Colors
      </h3>
      <div
        v-for="name in options?.colors ?? []"
        :key="name"
        class="flex flex-col gap-1"
      >
        <div class="flex items-center gap-2 text-xs">
          <button
            type="button"
            :data-testid="`color-${name}`"
            class="size-6 shrink-0 rounded-md ring ring-default"
            :style="{ backgroundColor: colorSwatch(name) }"
            :aria-label="`Pick the ${name} colour`"
            @click="picking = picking === name ? null : name"
          />
          <span class="w-16 shrink-0 text-muted">{{ name }}</span>
          <CommitInput
            :data-testid="`color-${name}-hex`"
            :model-value="theme.colors[name]"
            mono
            @commit="commitHex(name, $event)"
          />
        </div>
        <div
          v-if="picking === name"
          class="grid grid-cols-8 gap-1 rounded-md border border-default p-1.5"
        >
          <button
            v-for="palette in options?.palettes ?? []"
            :key="palette"
            type="button"
            :data-testid="`color-${name}-pick-${palette}`"
            class="size-5 rounded-sm ring-offset-1"
            :class="theme.colors[name] === palette ? 'ring-2 ring-primary' : ''"
            :style="{ backgroundColor: paletteSwatch(palette) }"
            :title="palette"
            @click="setColor(name, palette)"
          />
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-semibold">
        Your colors
      </h3>
      <div
        v-for="entry in customNames"
        :key="entry"
        class="flex items-center gap-2 text-xs"
      >
        <span
          class="size-5 shrink-0 rounded-md ring ring-default"
          :style="{ backgroundColor: theme.custom![entry] }"
        />
        <code class="min-w-0 flex-1 truncate">{{ entry }} {{ theme.custom![entry] }}</code>
        <button
          type="button"
          :data-testid="`custom-remove-${entry}`"
          aria-label="Remove colour"
          @click="update({ custom: { [entry]: null } })"
        >
          <UIcon
            name="i-lucide-x"
            class="size-3"
          />
        </button>
      </div>
      <div class="flex items-center gap-1">
        <CommitInput
          data-testid="custom-new-name"
          :model-value="custom.name"
          placeholder="name"
          @commit="custom.name = $event"
        />
        <CommitInput
          data-testid="custom-new-hex"
          :model-value="custom.hex"
          placeholder="#rrggbb"
          mono
          @commit="custom.hex = $event"
        />
        <UButton
          data-testid="custom-add"
          icon="i-lucide-plus"
          aria-label="Add a colour"
          size="xs"
          color="neutral"
          variant="soft"
          @click="addCustom()"
        />
      </div>
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-semibold">
        Shape and type
      </h3>
      <label class="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs text-muted">
        Radius
        <select
          data-testid="theme-radius"
          :class="field"
          :value="theme.radius"
          @change="pick('radius', $event)"
        >
          <option
            v-for="radius in options?.radii ?? []"
            :key="radius"
            :value="radius"
          >{{ radius }}</option>
        </select>
      </label>
      <label class="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs text-muted">
        Font
        <select
          data-testid="theme-font"
          :class="field"
          :value="theme.font"
          @change="pick('font', $event)"
        >
          <option
            v-for="font in options?.fonts ?? []"
            :key="font"
            :value="font"
          >{{ font }}</option>
        </select>
      </label>
      <label class="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs text-muted">
        Spacing
        <select
          data-testid="theme-spacing"
          :class="field"
          :value="theme.spacing"
          @change="pick('spacing', $event)"
        >
          <option
            v-for="spacing in options?.spacings ?? []"
            :key="spacing.name"
            :value="spacing.name"
          >{{ spacing.name }}</option>
        </select>
      </label>
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-semibold">
        Presets
      </h3>
      <ul class="grid grid-cols-2 gap-1">
        <li
          v-for="preset in presets"
          :key="preset.id"
          data-testid="preset"
        >
          <button
            type="button"
            :data-testid="`preset-${preset.id}`"
            class="w-full rounded-md border border-default px-2 py-1.5 text-left text-xs hover:bg-elevated"
            @click="apply(preset.id)"
          >
            {{ preset.name }}
          </button>
        </li>
      </ul>
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-semibold">
        Preview
      </h3>
      <label class="flex items-center gap-2 text-xs text-muted">
        <input
          v-model="design.dark.value"
          type="checkbox"
          data-testid="theme-dark"
          class="size-4"
        >
        Dark mode
      </label>
      <UButton
        data-testid="theme-tokens"
        :label="design.view.value === 'tokens' ? 'Back to the file' : 'Token sheet'"
        icon="i-lucide-swatch-book"
        size="xs"
        color="neutral"
        variant="soft"
        class="self-start"
        @click="design.view.value = design.view.value === 'tokens' ? 'page' : 'tokens'"
      />
    </section>
  </div>
</template>
