<script setup lang="ts">
import type { Theme } from '#shared/design/theme'
import type { StyleToken } from '#shared/design/tokens'
import { colorSwatch, colorSwatchRows } from '#shared/editor/styleFields'

/**
 * Picks a colour token from swatches painted with the project theme (the
 * editor's own document carries the app theme, so colours are computed).
 */
const props = defineProps<{ token: StyleToken, value: string | undefined, theme: Theme }>()
const emit = defineEmits<{ update: [value: string] }>()

const open = ref(false)
const hovered = ref<string | null>(null)
const rows = computed(() => colorSwatchRows(props.token, props.theme))
const current = computed(() => colorSwatch(props.token, props.theme, props.value))

function pick(value: string) {
  open.value = false
  emit('update', value)
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ side: 'left', align: 'start' }"
  >
    <UButton
      color="neutral"
      variant="outline"
      size="xs"
      class="w-full"
      :data-style-key="token.key"
      :aria-label="`${token.label}: ${value ?? 'none'}`"
    >
      <span
        class="size-3.5 shrink-0 rounded-sm ring ring-default"
        :class="{ 'bg-[repeating-conic-gradient(var(--ui-bg-accented)_0_25%,transparent_0_50%)] bg-size-[6px_6px]': !current }"
        :style="current ? { background: current.color } : undefined"
      />
      <span class="truncate">{{ value ?? 'None' }}</span>
    </UButton>
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
              @mouseenter="hovered = swatch.label"
              @mouseleave="hovered = null"
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
