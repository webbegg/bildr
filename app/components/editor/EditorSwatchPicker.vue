<script setup lang="ts">
import type { Theme } from '#shared/design/theme'
import type { StyleToken } from '#shared/design/tokens'
import { colorSwatch, colorSwatchRows } from '#shared/editor/styleFields'

/**
 * Picks a colour token from swatches painted with the project theme (the
 * editor's own document carries the app theme, so colours are computed).
 * A set token reads like Framer's fill field: a swatch and the token name;
 * clicking opens the picker, and the detach button (on hover) clears it. An
 * `icon` goes in front. Hovering a swatch previews
 * it until the pointer leaves or the picker closes. Without a value it reads
 * `placeholder` ("None" by default; "Mixed" for a multi-selection).
 */
const props = defineProps<{ token: StyleToken, value: string | undefined, theme: Theme, icon?: string, placeholder?: string }>()
const emit = defineEmits<{ update: [value: string], preview: [value: string | null], clear: [] }>()

const open = ref(false)
const hovered = ref<string | null>(null)
const rows = computed(() => colorSwatchRows(props.token, props.theme))
const current = computed(() => colorSwatch(props.token, props.theme, props.value))

function hover(value: string | null) {
  hovered.value = value
  emit('preview', value)
}

watch(open, (isOpen) => {
  if (!isOpen) hover(null)
})

function pick(value: string) {
  open.value = false
  emit('preview', null)
  emit('update', value)
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
            class="truncate text-[13px] text-highlighted"
            data-variable-chip
          >{{ value }}</span>
        </template>
        <template v-else>
          <span class="size-[22px] shrink-0 rounded-md bg-[repeating-conic-gradient(var(--ui-bg-accented)_0_25%,transparent_0_50%)] bg-size-[8px_8px] ring-1 ring-white/10 ring-inset" />
          <span class="truncate text-[13px] text-dimmed">{{ placeholder ?? 'None' }}</span>
        </template>
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
    <UTooltip
      v-if="value"
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
