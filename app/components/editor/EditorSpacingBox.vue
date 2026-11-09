<script setup lang="ts">
import type { Breakpoint } from '#shared/design/tokens'
import { getStyleToken, styleKey } from '#shared/design/tokens'
import { stepScale } from '#shared/editor/scale'
import { scrubStops, startScrub } from '#shared/editor/scrub'
import type { Side, SpacingBox, SpacingScope } from '#shared/editor/spacing'
import { dragScope, SIDES, sideKey, spacingSide, spacingWrite } from '#shared/editor/spacing'

/**
 * The box model (Stacki's SpacingSection): a margin frame around a padding
 * frame, each side labelled with the value that applies at the edited
 * breakpoint. Dragging a side's band or label scrubs it through the spacing
 * scale (outward for margin, inward for padding); Shift writes all four sides
 * (`p`), Alt the side and its opposite (`py`). A value that comes from such a
 * shorthand is underlined dotted. Clicking a label edits that side in a
 * popover; Alt-clicking it clears the side's own token.
 *
 * Drags `preview` the patch they hold and `commit` it once, on release;
 * Escape cancels a drag.
 */
const props = defineProps<{ styles: Record<string, string>, breakpoint: Breakpoint | undefined }>()
const emit = defineEmits<{ preview: [patch: Record<string, string | null> | null], commit: [patch: Record<string, string | null>] }>()

// The band geometry of Stacki's (Webflow's) frames, as the side and top band in % of the frame.
const BAND = { m: { x: 16.07, y: 21.43 }, p: { x: 24, y: 40 } }
function clip(box: SpacingBox, side: Side): string {
  const { x, y } = BAND[box]
  const [x2, y2] = [100 - x, 100 - y]
  const points: Record<Side, string> = {
    top: `0 0, 100% 0, ${x2}% ${y}%, ${x}% ${y}%`,
    right: `100% 0, 100% 100%, ${x2}% ${y2}%, ${x2}% ${y}%`,
    bottom: `0 100%, 100% 100%, ${x2}% ${y2}%, ${x}% ${y2}%`,
    left: `0 0, 0 100%, ${x}% ${y2}%, ${x}% ${y}%`
  }
  return `polygon(${points[side]})`
}
const BAND_FILL: Record<Side, string> = {
  top: 'bg-[#3e3e3e]',
  right: 'bg-[#282828]',
  bottom: 'bg-[#242424]',
  left: 'bg-[#313131]'
}
const bandClass = (box: SpacingBox, side: Side) => [
  drag.value?.box === box && drag.value.sides.includes(side) ? 'bg-[#494949]' : [BAND_FILL[side], 'hover:bg-[#494949]'],
  side === 'top' || side === 'bottom' ? 'cursor-ns-resize' : 'cursor-ew-resize'
]
const LABEL_CELL: Record<Side, string> = {
  top: 'col-start-2 row-start-1',
  right: 'col-start-3 row-start-2',
  bottom: 'col-start-2 row-start-3',
  left: 'col-start-1 row-start-2'
}
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

const tokenLabel = (box: SpacingBox, side: Side) => getStyleToken(sideKey(box, side))!.label

/** The drag in flight: its sides and the value it holds. */
const drag = ref<{ box: SpacingBox, sides: Side[], value: string } | null>(null)

function shown(box: SpacingBox, side: Side) {
  const resolved = spacingSide(props.styles, box, side, props.breakpoint)
  if (drag.value?.box === box && drag.value.sides.includes(side)) return { value: drag.value.value, state: 'set' as const, shorthand: false, from: '' }
  if (!resolved) return { value: '0', state: 'unset' as const, shorthand: false, from: '' }
  const from = getStyleToken(resolved.via)!.label
  return { value: resolved.value, state: resolved.state, shorthand: resolved.via !== sideKey(box, side), from: `${from} (${resolved.key})` }
}

const affected = (side: Side, scope: SpacingScope): Side[] => (scope === 'all' ? [...SIDES] : scope === 'axis' ? [side, OPPOSITE[side]] : [side])

// Margins grow outward and padding inward, along the side's own axis.
function travel(box: SpacingBox, side: Side, dx: number, dy: number): number {
  const outward = side === 'top' ? -dy : side === 'bottom' ? dy : side === 'left' ? -dx : dx
  return box === 'm' ? outward : -outward
}

const changes = (patch: Record<string, string | null>) =>
  Object.entries(patch).some(([key, value]) => (value === null ? props.styles[key] !== undefined : props.styles[key] !== value))

/** Pressing a band or a label: a drag scrubs; a plain click on a label opens its editor. */
function press(box: SpacingBox, side: Side, event: PointerEvent, label?: HTMLElement) {
  if (event.button !== 0) return
  if (!label) event.preventDefault()
  const from = spacingSide(props.styles, box, side, props.breakpoint)?.value
  const alt = event.altKey
  let patch: Record<string, string | null> | null = null
  startScrub(event, {
    cursor: side === 'top' || side === 'bottom' ? 'ns-resize' : 'ew-resize',
    move({ dx, dy, shiftKey, altKey }) {
      const scope = dragScope({ shiftKey, altKey })
      const stops = scrubStops(travel(box, side, dx, dy), false)
      const value = (stops === 0 ? from : stepScale(sideKey(box, side), from, stops)) ?? '0'
      drag.value = { box, sides: affected(side, scope), value }
      patch = stops === 0 ? null : spacingWrite(props.styles, box, side, scope, props.breakpoint, value)
      emit('preview', patch)
    },
    end(dragged) {
      drag.value = null
      if (dragged) {
        emit('preview', null)
        if (patch && changes(patch)) emit('commit', patch)
      } else if (label) {
        if (alt) clear(box, side)
        else edit(box, side, label)
      }
    },
    cancel() {
      drag.value = null
      patch = null
      emit('preview', null)
    }
  })
}

const ownKey = (box: SpacingBox, side: Side) => styleKey(sideKey(box, side), props.breakpoint)

function clear(box: SpacingBox, side: Side) {
  const key = ownKey(box, side)
  if (props.styles[key] !== undefined) emit('commit', { [key]: null })
}

const editing = ref<{ box: SpacingBox, side: Side, anchor: HTMLElement } | null>(null)
const edit = (box: SpacingBox, side: Side, anchor: HTMLElement) => {
  editing.value = { box, side, anchor }
}
const editingToken = computed(() => (editing.value ? getStyleToken(sideKey(editing.value.box, editing.value.side))! : undefined))
const editingOwn = computed(() => (editing.value ? props.styles[ownKey(editing.value.box, editing.value.side)] : undefined))
const editingShown = computed(() => (editing.value ? spacingSide(props.styles, editing.value.box, editing.value.side, props.breakpoint)?.value : undefined))

function editPreview(value: string | null) {
  emit('preview', value === null || !editing.value ? null : { [ownKey(editing.value.box, editing.value.side)]: value })
}

function editCommit(value: string) {
  if (editing.value) emit('commit', { [ownKey(editing.value.box, editing.value.side)]: value })
}

function editReset() {
  if (!editing.value) return
  clear(editing.value.box, editing.value.side)
  editing.value = null
}

const LABEL = 'z-[2] max-w-full truncate rounded-sm px-1 py-px font-mono text-[11px] leading-4 transition-colors'
const TONE = {
  set: 'bg-(color:--editor-info)/14 text-(color:--editor-info) hover:bg-(color:--editor-info)/20',
  inherited: 'bg-(color:--editor-provenance-bg) text-(color:--editor-provenance) hover:bg-[rgba(223,100,12,0.3)]',
  unset: 'text-dimmed hover:bg-white/8 hover:text-toned'
}
</script>

<template>
  <div data-spacing-box>
    <div
      class="relative isolate grid aspect-[224/112] w-full grid-cols-[16.07%_minmax(0,1fr)_16.07%] grid-rows-[21.43%_minmax(0,1fr)_21.43%] place-items-center overflow-hidden rounded-[4px]"
      data-spacing-frame="m"
    >
      <template
        v-for="side in SIDES"
        :key="`band-${side}`"
      >
        <div
          class="absolute inset-0 transition-colors"
          :class="bandClass('m', side)"
          :style="{ clipPath: clip('m', side) }"
          :data-spacing-band="sideKey('m', side)"
          aria-hidden="true"
          @pointerdown="press('m', side, $event)"
        />
      </template>
      <span class="pointer-events-none absolute top-1 left-[7px] z-[2] text-[9px] tracking-wide text-muted uppercase">Margin</span>
      <button
        v-for="side in SIDES"
        :key="`label-${side}`"
        type="button"
        :class="[LABEL, LABEL_CELL[side], TONE[shown('m', side).state], { 'underline decoration-dotted underline-offset-2': shown('m', side).shorthand }]"
        :aria-label="tokenLabel('m', side)"
        :title="shown('m', side).shorthand ? `From ${shown('m', side).from}` : `${tokenLabel('m', side)} (⌥ click: clear)`"
        :data-spacing-label="sideKey('m', side)"
        :data-field-state="shown('m', side).state"
        @pointerdown="press('m', side, $event, $event.currentTarget as HTMLElement)"
        @click="$event.detail === 0 && edit('m', side, $event.currentTarget as HTMLElement)"
      >
        {{ shown('m', side).value }}
      </button>

      <div
        class="relative isolate z-[1] col-start-2 row-start-2 m-[1.5%] grid grid-cols-[24%_minmax(0,1fr)_24%] grid-rows-[40%_minmax(0,1fr)_40%] place-items-center place-self-stretch overflow-hidden rounded-[4px]"
        data-spacing-frame="p"
      >
        <template
          v-for="side in SIDES"
          :key="`band-${side}`"
        >
          <div
            class="absolute inset-0 transition-colors"
            :class="bandClass('p', side)"
            :style="{ clipPath: clip('p', side) }"
            :data-spacing-band="sideKey('p', side)"
            aria-hidden="true"
            @pointerdown="press('p', side, $event)"
          />
        </template>
        <span class="pointer-events-none absolute top-0.5 left-[7px] z-[2] text-[9px] tracking-wide text-muted uppercase">Padding</span>
        <button
          v-for="side in SIDES"
          :key="`label-${side}`"
          type="button"
          :class="[LABEL, LABEL_CELL[side], TONE[shown('p', side).state], { 'underline decoration-dotted underline-offset-2': shown('p', side).shorthand }]"
          :aria-label="tokenLabel('p', side)"
          :title="shown('p', side).shorthand ? `From ${shown('p', side).from}` : `${tokenLabel('p', side)} (⌥ click: clear)`"
          :data-spacing-label="sideKey('p', side)"
          :data-field-state="shown('p', side).state"
          @pointerdown="press('p', side, $event, $event.currentTarget as HTMLElement)"
          @click="$event.detail === 0 && edit('p', side, $event.currentTarget as HTMLElement)"
        >
          {{ shown('p', side).value }}
        </button>
        <div class="z-[1] col-start-2 row-start-2 place-self-stretch rounded-sm bg-[#151515]" />
      </div>
    </div>

    <UPopover
      :open="!!editing"
      :reference="editing?.anchor"
      :content="{ side: 'bottom', align: 'center' }"
      @update:open="!$event && (editing = null)"
    >
      <template #content>
        <div
          v-if="editing && editingToken"
          class="w-60"
          data-spacing-editor
        >
          <div class="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-2 p-2">
            <EditorScaleField
              :token="editingToken"
              :value="editingOwn"
              :inherited="editingOwn === undefined ? editingShown : undefined"
              placeholder="0"
              @preview="editPreview"
              @commit="editCommit"
            >
              <template #label>
                <span class="truncate text-[11px] text-muted">{{ editingToken.label }}</span>
              </template>
            </EditorScaleField>
          </div>
          <button
            type="button"
            class="flex w-full items-center justify-between border-t border-default px-3 py-1.5 text-xs hover:bg-elevated disabled:opacity-50"
            :disabled="editingOwn === undefined"
            @click="editReset"
          >
            Reset
            <span class="text-[11px] text-dimmed">⌥ click</span>
          </button>
        </div>
      </template>
    </UPopover>
  </div>
</template>
