<script setup lang="ts">
import { getStyleToken } from '#shared/design/tokens'
import type { Provenance } from '#shared/editor/styleFields'

/**
 * Flex alignment (Stacki's AlignControl): a 3×3 dot grid over a live mini
 * preview, plus X and Y selects. X is the horizontal screen axis, so in a
 * column it drives `items` and Y `justify`; in a row the other way round.
 * A dot sets both axes (a distributed `justify` such as `between` is kept);
 * a double-click toggles `justify: between`; the arrow keys step an axis.
 */
type Axis = 'items' | 'justify'
const props = defineProps<{
  /** Each token's provenance at the edited breakpoint. */
  items: Provenance
  justify: Provenance
  direction: string
  device: string
}>()
const emit = defineEmits<{ commit: [patch: Partial<Record<Axis, string>>], reset: [key: Axis] }>()

const POSITIONS = ['start', 'center', 'end'] as const
const DISTRIBUTED = ['between', 'around', 'evenly']
const X_NAMES = ['left', 'center', 'right']
const Y_NAMES = ['top', 'middle', 'bottom']

const column = computed(() => props.direction.startsWith('col'))
const valueOf = (p: Provenance) => (p.state === 'unset' ? undefined : p.value)
// CSS defaults when no token applies: justify-content start, align-items stretch.
const shownItems = computed(() => valueOf(props.items) ?? 'stretch')
const shownJustify = computed(() => valueOf(props.justify) ?? 'start')
const xAxis = computed<Axis>(() => (column.value ? 'items' : 'justify'))
const yAxis = computed<Axis>(() => (column.value ? 'justify' : 'items'))
const shownOf = (axis: Axis) => (axis === 'items' ? shownItems.value : shownJustify.value)

const own = (axis: Axis) => {
  const p = props[axis]
  return p.state === 'set' ? p.value : undefined
}

function commit(patch: Partial<Record<Axis, string>>) {
  const changed = Object.fromEntries(Object.entries(patch).filter(([axis, value]) => own(axis as Axis) !== value))
  if (Object.keys(changed).length) emit('commit', changed)
}

function dotClick(x: number, y: number) {
  const patch: Partial<Record<Axis, string>> = { [xAxis.value]: POSITIONS[x], [yAxis.value]: POSITIONS[y] }
  if (DISTRIBUTED.includes(shownJustify.value)) delete patch.justify
  commit(patch)
}

function dotDoubleClick(x: number, y: number) {
  const position = POSITIONS[column.value ? y : x]!
  commit({ justify: shownJustify.value === 'between' ? position : 'between' })
}

function onKeydown(event: KeyboardEvent) {
  const step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0
  if (!step) return
  event.preventDefault()
  const axis = event.key === 'ArrowUp' || event.key === 'ArrowDown' ? yAxis.value : xAxis.value
  const at = (POSITIONS as readonly string[]).indexOf(shownOf(axis))
  const next = at < 0 ? 'center' : POSITIONS[at + step]
  if (next) commit({ [axis]: next })
}

const isActive = (x: number, y: number) => shownOf(xAxis.value) === POSITIONS[x] && shownOf(yAxis.value) === POSITIONS[y]

const FLEX: Record<string, string> = { start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' }
const css = (value: string) => FLEX[value] ?? value
const preview = computed(() => ({
  flexDirection: (column.value ? 'column' : 'row') + (props.direction.endsWith('reverse') ? '-reverse' : ''),
  justifyContent: css(shownJustify.value),
  alignItems: shownItems.value === 'baseline' ? 'flex-start' : css(shownItems.value)
}) as Record<string, string>)
const bar = computed(() => {
  const cross = shownItems.value === 'stretch' ? undefined : '28%'
  return column.value ? { height: '2px', width: cross } : { width: '2px', height: cross }
})

const options = (axis: Axis) => getStyleToken(axis)!.values.map(value => ({ value, label: value }))
const axes = computed(() => [{ name: 'X', axis: xAxis.value }, { name: 'Y', axis: yAxis.value }])
</script>

<template>
  <div class="flex min-w-0 gap-2">
    <div
      class="relative w-[68px] shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-default ring-inset focus-within:bg-elevated/40"
      role="group"
      aria-label="Alignment"
      data-align-grid
      @keydown="onKeydown"
    >
      <div class="absolute inset-0 grid grid-cols-3 grid-rows-3">
        <template
          v-for="(_, y) in POSITIONS"
          :key="y"
        >
          <button
            v-for="(__, x) in POSITIONS"
            :key="x"
            type="button"
            class="group/dot grid place-items-center outline-none"
            :aria-label="`Align ${X_NAMES[x]} ${Y_NAMES[y]}`"
            :aria-pressed="isActive(x, y)"
            :title="shownJustify === 'between' ? 'Double-click to align here' : 'Double-click for space between'"
            @click="dotClick(x, y)"
            @dblclick="dotDoubleClick(x, y)"
          >
            <span
              class="size-0.5 rounded-[0.5px] bg-(color:--ui-text-toned) transition-transform group-hover/dot:scale-[1.8] group-hover/dot:opacity-100"
              :class="isActive(x, y) ? 'opacity-0' : 'opacity-45'"
            />
          </button>
        </template>
      </div>
      <div
        class="pointer-events-none absolute inset-0 flex gap-0.5 px-[11px] py-1.5"
        :style="preview"
        aria-hidden="true"
      >
        <span
          v-for="i in 3"
          :key="i"
          class="flex-none rounded-[1px] bg-(color:--ui-text-highlighted)"
          :style="bar"
        />
      </div>
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div
        v-for="{ name, axis } in axes"
        :key="name"
        class="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-1.5"
      >
        <EditorFieldLabel
          :label="name"
          :title="getStyleToken(axis)!.label"
          :provenance="props[axis]"
          :device="device"
          @reset="emit('reset', axis)"
        />
        <USelect
          :model-value="own(axis)"
          :items="options(axis)"
          :placeholder="shownOf(axis)"
          size="xs"
          class="h-7 w-full bg-muted font-mono ring-0"
          :ui="{ trailingIcon: 'size-3 text-dimmed' }"
          :aria-label="getStyleToken(axis)!.label"
          :data-style-key="axis"
          @update:model-value="commit({ [axis]: $event as string })"
        />
      </div>
    </div>
  </div>
</template>
