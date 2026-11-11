<script setup lang="ts">
import type { Theme } from '#shared/design/theme'
import type { StyleToken } from '#shared/design/tokens'
import { STYLE_HEX } from '#shared/design/tokens'
import { cssColorToHex, customColorName, customColorNameProblem } from '#shared/editor/color'
import { colorSwatch, colorSwatchRows, customColorSwatches } from '#shared/editor/styleFields'

/**
 * Picks a colour, tokens first, the Framer way. A set value reads like
 * Framer's fill field: a swatch and the token name (or theme colour, or
 * hex); clicking opens the picker, and the detach button (on hover) clears
 * it (`:clearable="false"` hides it). An `icon` goes in front. Without a value it reads `placeholder`
 * ("None" by default; "Mixed" for a multi-selection).
 *
 * The picker has two tabs. Tokens: swatches painted with the project theme
 * (the editor's own document carries the app theme, so colours are
 * computed), then the theme's own colours; hovering one previews it until
 * the pointer leaves or the picker closes. Custom: an HSV picker writing a
 * raw hex (previews while dragging, one `update` per gesture), and "Create
 * colour from this", which names the colour, adds it to the theme
 * (`theme_update` custom) and then sets the value to it.
 */
const props = withDefaults(defineProps<{ token: StyleToken, value: string | undefined, theme: Theme, icon?: string, placeholder?: string, clearable?: boolean }>(), { icon: undefined, placeholder: undefined, clearable: true })
const emit = defineEmits<{ update: [value: string], preview: [value: string | null], clear: [] }>()
const editor = useEditor()
const toast = useToast()

type Tab = 'tokens' | 'custom'
const TABS = [{ value: 'tokens', label: 'Tokens' }, { value: 'custom', label: 'Custom' }]

const open = ref(false)
const tab = ref<Tab>('tokens')
const hovered = ref<string | null>(null)
const rows = computed(() => colorSwatchRows(props.token, props.theme))
const custom = computed(() => customColorSwatches(props.theme))
const current = computed(() => colorSwatch(props.token, props.theme, props.value))
/** The hex the Custom tab starts from: the raw value, or what the token paints. */
const currentHex = computed(() => (current.value ? cssColorToHex(current.value.color) : undefined))
/** The Custom tab's colour, last previewed or committed. */
const customHex = ref<string | undefined>()

function hover(value: string | null) {
  hovered.value = value
  emit('preview', value)
}

watch(open, (isOpen) => {
  if (isOpen) {
    tab.value = props.value && STYLE_HEX.test(props.value) ? 'custom' : 'tokens'
    customHex.value = currentHex.value
  } else hover(null)
})

function pick(value: string) {
  open.value = false
  emit('preview', null)
  emit('update', value)
}

function previewCustom(hex: string | null) {
  if (hex) customHex.value = hex
  emit('preview', hex)
}

function commitCustom(hex: string) {
  customHex.value = hex
  emit('preview', null)
  emit('update', hex)
}

/** "Create colour from this": a named theme colour from the custom hex, then the value uses it (by name). */
async function createColor() {
  const hex = customHex.value
  if (!hex) return
  const typed = window.prompt('Name the new colour (e.g. brand, ink-2)', '')
  if (typed === null) return
  const name = customColorName(typed)
  const problem = customColorNameProblem(name, Object.keys(props.theme.custom ?? {}))
  if (problem) {
    toast.add({ title: 'Colour not created', description: problem, color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }
  const result = await editor.run('theme_update', { custom: { [name]: hex } })
  if (result) pick(name)
}
</script>

<template>
  <div class="group/chip relative flex h-[30px] min-w-0 items-center rounded-lg bg-elevated ring-inset hover:ring-1 hover:ring-white/10 has-aria-expanded:ring-1 has-aria-expanded:ring-(color:--editor-selection)">
    <UPopover
      v-model:open="open"
      :content="{ side: 'left', align: 'start' }"
    >
      <button
        type="button"
        class="flex h-full min-w-0 flex-1 items-center gap-2 ps-1 pe-1 text-left outline-none"
        :data-style-key="token.key"
        :aria-label="`${token.label}: ${value ?? 'none'}`"
      >
        <UIcon
          v-if="icon"
          :name="icon"
          class="mx-1 size-3 shrink-0 text-dimmed"
        />
        <template v-if="value">
          <span
            class="size-[22px] shrink-0 rounded-md ring-1 ring-white/10 ring-inset"
            :style="current ? { background: current.color } : undefined"
          />
          <span
            class="truncate text-[12px] text-highlighted"
            data-variable-chip
          >{{ value }}</span>
        </template>
        <template v-else>
          <span class="size-[22px] shrink-0 rounded-md bg-[repeating-conic-gradient(var(--ui-bg-accented)_0_25%,transparent_0_50%)] bg-size-[8px_8px] ring-1 ring-white/10 ring-inset" />
          <span class="truncate text-[12px] text-dimmed">{{ placeholder ?? 'None' }}</span>
        </template>
      </button>
      <template #content>
        <div
          class="w-80 space-y-2 p-2"
          data-color-picker
        >
          <EditorSegmented
            :model-value="tab"
            :dense="false"
            :items="TABS"
            aria-label="Colour source"
            data-color-tabs
            @update:model-value="tab = $event as Tab"
          />
          <template v-if="tab === 'tokens'">
            <div class="space-y-1">
              <div
                v-for="row in rows"
                :key="row.name"
                class="flex items-center gap-1"
              >
                <span class="w-16 shrink-0 truncate text-[10px] text-muted">{{ row.name }}</span>
                <div class="flex flex-wrap gap-0.5">
                  <button
                    v-for="swatch in row.swatches"
                    :key="swatch.value"
                    type="button"
                    class="size-4 rounded-sm ring ring-default ring-inset hover:scale-125"
                    :class="{ 'outline-2 outline-offset-1 outline-inverted': swatch.value === value, 'me-1': swatch.value === row.name }"
                    :style="{ background: swatch.color }"
                    :title="swatch.label"
                    :aria-label="swatch.label"
                    @mouseenter="hover(swatch.value)"
                    @mouseleave="hover(null)"
                    @click="pick(swatch.value)"
                  />
                </div>
              </div>
              <div
                v-if="custom.length"
                class="flex items-center gap-1"
                data-color-theme-row
              >
                <span class="w-16 shrink-0 truncate text-[10px] text-muted">theme</span>
                <div class="flex flex-wrap gap-0.5">
                  <button
                    v-for="swatch in custom"
                    :key="swatch.value"
                    type="button"
                    class="size-4 rounded-sm ring ring-default ring-inset hover:scale-125"
                    :class="{ 'outline-2 outline-offset-1 outline-inverted': swatch.value === value }"
                    :style="{ background: swatch.color }"
                    :title="swatch.label"
                    :aria-label="swatch.label"
                    :data-custom-color="swatch.value"
                    @mouseenter="hover(swatch.value)"
                    @mouseleave="hover(null)"
                    @click="pick(swatch.value)"
                  />
                </div>
              </div>
            </div>
            <p class="h-4 pt-1 text-[10px] text-dimmed">
              {{ hovered ?? value ?? 'Pick a colour' }}
            </p>
          </template>
          <template v-else>
            <EditorColorCustom
              :value="customHex"
              @preview="previewCustom"
              @commit="commitCustom"
            />
            <EditorButton
              variant="soft"
              size="sm"
              block
              label="Create colour from this"
              icon="i-lucide-plus"
              :disabled="!customHex"
              data-create-color
              @click="createColor"
            />
          </template>
        </div>
      </template>
    </UPopover>
    <UTooltip
      v-if="value && clearable"
      text="Detach variable"
      :delay-duration="500"
    >
      <button
        type="button"
        class="me-0.5 grid size-5 shrink-0 place-items-center rounded-sm text-muted opacity-0 group-hover/chip:opacity-100 hover:bg-white/10 hover:text-highlighted focus-visible:opacity-100"
        :aria-label="`Detach ${token.label.toLowerCase()}`"
        data-detach
        @click="emit('clear')"
      >
        <UIcon
          name="i-lucide-unlink-2"
          class="size-3"
        />
      </button>
    </UTooltip>
  </div>
</template>
