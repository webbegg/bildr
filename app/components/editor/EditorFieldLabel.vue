<script setup lang="ts">
import type { Provenance } from '#shared/editor/styleFields'
import { provenanceHighlight, provenanceHint } from '#shared/editor/styleFields'

/**
 * A field's provenance, the Framer way: only an override (a value set at the
 * edited breakpoint) is highlighted, in blue; an inherited value looks unset,
 * its tooltip saying where it comes from ("From Mobile: 10"). It shows as a
 * caption (`label`), as the letter or icon in front of a field (`prefix`), or
 * as a small dot beside a row (`dot`, nothing without an override). Clicking
 * an override opens a "Reset override" menu; Alt-clicking it resets at once.
 * The Settings tab reuses it for props, with `resetLabel` "Reset to default".
 */
const props = withDefaults(defineProps<{
  label: string
  title: string
  provenance: Provenance
  device?: string
  resetLabel?: string
  variant?: 'label' | 'prefix' | 'dot'
  /** The prefix's icon; without one the prefix shows `label`. */
  icon?: string
}>(), { device: '', resetLabel: 'Reset override', variant: 'label', icon: undefined })
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

const SHAPE = {
  label: 'max-w-full truncate rounded-sm px-0.5 text-left text-[11px] leading-4',
  prefix: 'flex h-full min-w-6 items-center justify-center px-1 text-[11px] leading-none',
  dot: 'grid size-3 place-items-center rounded-full'
}
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
      :class="[SHAPE[variant], variant === 'dot' ? 'hover:bg-white/10' : 'text-(color:--editor-info)', { 'hover:bg-white/8': variant === 'label' }]"
      :title="`${title} (⌥ click: reset)`"
      data-field-state="set"
      data-highlight="override"
      @pointerdown="altPressed = $event.altKey"
      @click="onClick"
    >
      <span
        v-if="variant === 'dot'"
        class="size-1.5 rounded-full bg-(color:--editor-selection)"
      />
      <UIcon
        v-else-if="variant === 'prefix' && icon"
        :name="icon"
        class="size-3"
      />
      <template v-else>
        {{ label }}
      </template>
    </button>
    <template #content>
      <div
        class="p-1"
        role="menu"
      >
        <button
          type="button"
          role="menuitem"
          class="flex min-w-36 items-center justify-between gap-4 rounded-sm px-2 py-1 text-xs whitespace-nowrap hover:bg-elevated"
          @click="reset"
        >
          {{ resetLabel }}
          <span class="text-[11px] text-dimmed">⌥ click</span>
        </button>
      </div>
    </template>
  </UPopover>
  <span
    v-else-if="variant !== 'dot' || provenance.state === 'inherited'"
    :class="[SHAPE[variant], 'text-dimmed']"
    :title="plainTitle"
    :data-field-state="provenance.state"
  >
    <template v-if="variant !== 'dot'">
      <UIcon
        v-if="variant === 'prefix' && icon"
        :name="icon"
        class="size-3"
      />
      <template v-else>{{ label }}</template>
    </template>
  </span>
</template>
