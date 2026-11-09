<script setup lang="ts">
import type { Provenance } from '#shared/editor/styleFields'
import { breakpointLabel } from '#shared/editor/styleFields'

/**
 * A field's provenance, the Figma way: dim when the field is unset, blue when
 * the current device sets it, orange when it inherits from a smaller
 * breakpoint. It shows as a caption (`label`), as the letter or icon in front
 * of a field (`prefix`), or as a small dot beside a row (`dot`, nothing when
 * unset). Clicking a set one opens a Reset menu; Alt-clicking it resets at
 * once. Clicking an inherited one says where the value comes from. The
 * Settings tab reuses it for props, with `resetLabel` "Reset to default".
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
}>(), { device: '', resetLabel: 'Reset', variant: 'label', icon: undefined })
const emit = defineEmits<{ reset: [] }>()

const open = ref(false)
watch(() => props.provenance.state, () => {
  open.value = false
})

const inheritedText = computed(() => props.provenance.state === 'inherited'
  ? `Inherited from ${breakpointLabel(props.provenance.from)}: ${props.provenance.value}`
  : '')

let altPressed = false
function onOpen(value: boolean) {
  // Alt-click resets instead of opening the menu.
  if (value && altPressed) return
  open.value = value
}

function onClick(event: MouseEvent) {
  altPressed = event.altKey
  if (event.altKey && props.provenance.state === 'set') {
    event.preventDefault()
    emit('reset')
  }
}

function reset() {
  open.value = false
  emit('reset')
}

const TONE = {
  set: 'text-(color:--editor-info)',
  inherited: 'text-(color:--editor-provenance)',
  unset: 'text-dimmed'
}
const DOT = { set: 'bg-(color:--editor-selection)', inherited: 'bg-(color:--editor-provenance)', unset: '' }
const SHAPE = {
  label: 'max-w-full truncate rounded-sm px-0.5 text-left text-[11px] leading-4 hover:bg-white/8',
  prefix: 'flex h-full min-w-6 items-center justify-center px-1 text-[11px] leading-none',
  dot: 'grid size-3 place-items-center rounded-full hover:bg-white/10'
}
</script>

<template>
  <span
    v-if="provenance.state === 'unset' && variant !== 'dot'"
    :class="[SHAPE[variant], TONE.unset, { 'hover:bg-transparent': variant === 'label' }]"
    :title="title"
    data-field-state="unset"
  >
    <UIcon
      v-if="variant === 'prefix' && icon"
      :name="icon"
      class="size-3"
    />
    <template v-else>{{ label }}</template>
  </span>
  <UPopover
    v-else-if="provenance.state !== 'unset'"
    :open="open"
    :content="{ side: 'left', align: 'start' }"
    @update:open="onOpen"
  >
    <button
      type="button"
      :class="[SHAPE[variant], variant !== 'dot' && TONE[provenance.state]]"
      :title="provenance.state === 'set' ? `${title} (⌥ click: reset)` : inheritedText"
      :data-field-state="provenance.state"
      @pointerdown="altPressed = $event.altKey"
      @click="onClick"
    >
      <span
        v-if="variant === 'dot'"
        class="size-1.5 rounded-full"
        :class="DOT[provenance.state]"
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
        v-if="provenance.state === 'set'"
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
      <p
        v-else-if="provenance.state === 'inherited'"
        class="w-56 p-2 text-xs text-toned"
      >
        {{ inheritedText }}. <span class="text-dimmed">Pick a value to override it on {{ device }} and up.</span>
      </p>
    </template>
  </UPopover>
</template>
