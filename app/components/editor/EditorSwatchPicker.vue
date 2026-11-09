<script setup lang="ts">
import type { Theme } from '#shared/design/theme'
import type { StyleToken } from '#shared/design/tokens'
import { colorSwatch, colorSwatchRows } from '#shared/editor/styleFields'

/**
 * Picks a colour token from swatches painted with the project theme (the
 * editor's own document carries the app theme, so colours are computed).
 * The trigger reads like Stacki's VariableConnect: swatch, token name, chevron.
 */
const props = defineProps<{ token: StyleToken, value: string | undefined, theme: Theme }>()
const emit = defineEmits<{ update: [value: string], preview: [value: string | null] }>()

const open = ref(false)
const hovered = ref<string | null>(null)
const rows = computed(() => colorSwatchRows(props.token, props.theme))
const current = computed(() => colorSwatch(props.token, props.theme, props.value))

function hover(value: string | null) {
  hovered.value = value
  emit('preview', value)
}

function pick(value: string) {
  open.value = false
  emit('preview', null)
  emit('update', value)
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ side: 'left', align: 'start' }"
  >
    <button
      type="button"
      class="flex h-7 w-full min-w-0 items-center gap-2 rounded-md bg-muted ps-1.5 pe-1 text-left hover:bg-[#0d0d0d] aria-expanded:ring-1 aria-expanded:ring-(color:--editor-selection)"
      :data-style-key="token.key"
      :aria-label="`${token.label}: ${value ?? 'none'}`"
    >
      <span
        class="size-4 shrink-0 rounded-[4px] ring-1 ring-white/10 ring-inset"
        :class="{ 'bg-[repeating-conic-gradient(var(--ui-bg-accented)_0_25%,transparent_0_50%)] bg-size-[6px_6px]': !current }"
        :style="current ? { background: current.color } : undefined"
      />
      <span
        class="min-w-0 flex-1 truncate font-mono text-xs"
        :class="value ? 'text-highlighted' : 'text-dimmed'"
      >{{ value ?? 'None' }}</span>
      <UIcon
        name="i-lucide-chevron-down"
        class="size-3 shrink-0 text-dimmed"
      />
    </button>
    <template #content>
      <div class="w-80 space-y-1 p-2">
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
        <p class="h-4 pt-1 text-[10px] text-dimmed">
          {{ hovered ?? value ?? 'Pick a colour' }}
        </p>
      </div>
    </template>
  </UPopover>
</template>
