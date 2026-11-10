<script setup lang="ts">
import type { Provenance } from '#shared/editor/styleFields'
import { provenanceHighlight, provenanceHint } from '#shared/editor/styleFields'

/**
 * A row label with its provenance, the Framer way: a grey caption, and only
 * an override (a value set at the edited breakpoint) is highlighted, in blue;
 * an inherited value looks unset, its tooltip saying where it comes from
 * ("From Mobile: 10"). Clicking an override opens a "Reset override" menu;
 * Alt-clicking it resets at once. The Settings tab reuses it for props, with
 * `resetLabel` "Reset to default".
 */
const props = withDefaults(defineProps<{
  label: string
  title: string
  provenance: Provenance
  device?: string
  resetLabel?: string
}>(), { device: '', resetLabel: 'Reset override' })
const emit = defineEmits<{ reset: [] }>()

const open = ref(false)
watch(() => props.provenance.state, () => {
  open.value = false
})

const override = computed(() => provenanceHighlight(props.provenance) === 'override')
const plainTitle = computed(() => provenanceHint(props.provenance) ?? props.title)

let altPressed = false
function onOpen(value: boolean) {
  // Alt-click resets instead of opening the menu.
  if (value && altPressed) return
  open.value = value
}

function onClick(event: MouseEvent) {
  altPressed = event.altKey
  if (event.altKey) {
    event.preventDefault()
    emit('reset')
  }
}

function reset() {
  open.value = false
  emit('reset')
}

const SHAPE = 'max-w-full truncate rounded-sm text-left text-[12px] leading-5'
</script>

<template>
  <UPopover
    v-if="override"
    :open="open"
    :content="{ side: 'left', align: 'start' }"
    @update:open="onOpen"
  >
    <button
      type="button"
      :class="[SHAPE, 'text-(color:--editor-selection) hover:brightness-125']"
      :title="`${title} (⌥ click: reset)`"
      data-field-state="set"
      data-highlight="override"
      @pointerdown="altPressed = $event.altKey"
      @click="onClick"
    >
      {{ label }}
    </button>
    <template #content>
      <div
        class="p-1"
        role="menu"
      >
        <button
          type="button"
          role="menuitem"
          class="flex min-w-36 items-center justify-between gap-4 rounded-lg px-2 py-1 text-xs whitespace-nowrap hover:bg-elevated"
          @click="reset"
        >
          {{ resetLabel }}
          <span class="text-[11px] text-dimmed">⌥ click</span>
        </button>
      </div>
    </template>
  </UPopover>
  <span
    v-else
    :class="[SHAPE, 'text-muted']"
    :title="plainTitle"
    :data-field-state="provenance.state"
  >{{ label }}</span>
</template>
