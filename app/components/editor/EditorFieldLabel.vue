<script setup lang="ts">
import type { Provenance } from '#shared/editor/styleFields'
import { breakpointLabel } from '#shared/editor/styleFields'

/**
 * A style row caption, after Stacki's FieldLabel: dim when the field is unset,
 * a blue pill when the current device sets it, an orange pill when it inherits
 * from a smaller breakpoint. Clicking a set pill opens a Reset menu;
 * Alt-clicking it resets at once. Clicking an inherited pill says where the
 * value comes from. The Settings tab reuses it for props, with `resetLabel`
 * "Reset to default".
 */
const props = withDefaults(defineProps<{ label: string, title: string, provenance: Provenance, device?: string, resetLabel?: string }>(), { device: '', resetLabel: 'Reset' })
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

const PILL = 'max-w-full truncate rounded-sm px-1 py-px text-left text-[11px] leading-4 transition-colors'
</script>

<template>
  <span
    v-if="provenance.state === 'unset'"
    class="truncate text-[11px] text-dimmed"
    :title="title"
    data-field-state="unset"
  >{{ label }}</span>
  <UPopover
    v-else
    :open="open"
    :content="{ side: 'left', align: 'start' }"
    @update:open="onOpen"
  >
    <button
      type="button"
      :class="[PILL, provenance.state === 'set'
        ? 'bg-(color:--editor-info)/14 text-(color:--editor-info) hover:bg-(color:--editor-info)/20'
        : 'bg-(color:--editor-provenance-bg) text-(color:--editor-provenance) hover:bg-[rgba(223,100,12,0.3)]']"
      :title="provenance.state === 'set' ? title : inheritedText"
      :data-field-state="provenance.state"
      @pointerdown="altPressed = $event.altKey"
      @click="onClick"
    >
      {{ label }}
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
