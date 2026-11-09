<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * The flex direction (Stacki's DirectionControl): Row and Column segments with
 * a sliding pill, and a menu with the reverse directions. A reversed value
 * keeps the pill on its axis with the arrow turned around. `fallback` is the
 * component's own direction, shown dim while no token sets one.
 */
const props = defineProps<{ value: string | undefined, inherited?: string, fallback?: string }>()
const emit = defineEmits<{ commit: [value: string] }>()

const OPTIONS = [
  { value: 'row', label: 'Row', icon: 'i-lucide-arrow-right' },
  { value: 'col', label: 'Column', icon: 'i-lucide-arrow-down' },
  { value: 'row-reverse', label: 'Row reverse', icon: 'i-lucide-arrow-left' },
  { value: 'col-reverse', label: 'Column reverse', icon: 'i-lucide-arrow-up' }
]
const option = (value: string) => OPTIONS.find(o => o.value === value)!

const axis = (value: string | undefined) => value?.replace('-reverse', '')
// The segments stand for both directions of their axis; the shown one sets the icon.
const shown = computed(() => props.value ?? props.inherited ?? props.fallback)
const segments = computed(() => ['row', 'col'].map((base) => {
  const value = axis(shown.value) === base ? shown.value! : base
  return { value: base, label: option(value).label, icon: option(value).icon }
}))

const menu = computed<DropdownMenuItem[]>(() => OPTIONS.map(o => ({
  label: o.label,
  icon: o.icon,
  type: 'checkbox' as const,
  checked: o.value === shown.value,
  onSelect: () => pick(o.value)
})))

function pick(value: string) {
  if (value !== props.value) emit('commit', value)
}
</script>

<template>
  <div
    class="flex min-w-0 items-center gap-1"
    role="group"
    aria-label="Direction"
  >
    <EditorSegmented
      class="flex-1"
      tooltips
      :items="segments"
      :model-value="axis(value)"
      :inherited="axis(inherited)"
      :fallback="axis(fallback)"
      @update:model-value="pick"
    />
    <UDropdownMenu
      :items="menu"
      :content="{ align: 'end' }"
      size="xs"
    >
      <button
        type="button"
        class="grid h-7 w-6 shrink-0 place-items-center rounded-md bg-muted text-dimmed hover:text-highlighted"
        aria-label="More direction options"
      >
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3"
        />
      </button>
    </UDropdownMenu>
  </div>
</template>
