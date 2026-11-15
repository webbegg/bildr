<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Hsva } from '@bildr/editor-core/color'
import { hexToHsva, hsvaToHex, normalizeHex } from '@bildr/editor-core/color'

/**
 * The Custom tab of the colour picker, Framer's: a saturation/value area,
 * hue and alpha sliders, the hex and alpha fields, and the eyedropper where
 * the browser has one (`window.EyeDropper`). Dragging emits `preview` with
 * the hex under the pointer; releasing, or committing a field, emits
 * `commit` once (one undo step per gesture). `value` is the hex to start
 * from (a token's colour converted, or the raw value).
 */
const props = defineProps<{ value: string | undefined }>()
const emit = defineEmits<{ preview: [hex: string | null], commit: [hex: string] }>()

const BLACK: Hsva = { h: 0, s: 0, v: 0, a: 1 }
const hsva = ref<Hsva>(hexToHsva(props.value ?? '') ?? { ...BLACK })
watch(() => props.value, (value) => {
  const next = value ? hexToHsva(value) : undefined
  // Keep the hue of greys while the value round-trips.
  if (next && hsvaToHex(hsva.value) !== value) hsva.value = next.s === 0 ? { ...next, h: hsva.value.h } : next
})

const hex = computed(() => hsvaToHex(hsva.value))
const opaque = computed(() => hsvaToHex({ ...hsva.value, a: 1 }))
const hexText = computed(() => opaque.value.slice(1).toUpperCase())
const alphaText = computed(() => `${Math.round(hsva.value.a * 100)}%`)

type Part = 'area' | 'hue' | 'alpha'
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function set(part: Part, event: PointerEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const x = clamp01((event.clientX - box.left) / box.width)
  const y = clamp01((event.clientY - box.top) / box.height)
  if (part === 'area') hsva.value = { ...hsva.value, s: x, v: 1 - y }
  else if (part === 'hue') hsva.value = { ...hsva.value, h: x * 360 }
  else hsva.value = { ...hsva.value, a: Math.round(x * 100) / 100 }
  emit('preview', hex.value)
}

let dragging: Part | null = null
function down(part: Part, event: PointerEvent) {
  dragging = part
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  set(part, event)
}
function move(part: Part, event: PointerEvent) {
  if (dragging === part) set(part, event)
}
function up(part: Part) {
  if (dragging !== part) return
  dragging = null
  emit('commit', hex.value)
}

/** Arrow keys nudge a slider or the area, committing each step. */
function key(part: Part, event: KeyboardEvent) {
  const step = event.shiftKey ? 0.1 : 0.01
  const d = { ArrowLeft: -step, ArrowRight: step, ArrowUp: step, ArrowDown: -step }[event.key]
  if (d === undefined) return
  event.preventDefault()
  const { h, s, v, a } = hsva.value
  if (part === 'hue') hsva.value = { ...hsva.value, h: Math.min(360, Math.max(0, h + d * 360)) }
  else if (part === 'alpha') hsva.value = { ...hsva.value, a: clamp01(Math.round((a + d) * 100) / 100) }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') hsva.value = { ...hsva.value, s: clamp01(s + d) }
  else hsva.value = { ...hsva.value, v: clamp01(v + d) }
  emit('commit', hex.value)
}

function commitHex(text: string) {
  const next = normalizeHex(text)
  if (!next) return
  const parsed = hexToHsva(next)!
  // A typed #rrggbb keeps the current alpha; #rrggbbaa sets it.
  hsva.value = next.length === 9 ? parsed : { ...parsed, a: hsva.value.a }
  emit('commit', hex.value)
}

function commitAlpha(text: string) {
  const n = Number.parseFloat(text)
  if (Number.isNaN(n)) return
  hsva.value = { ...hsva.value, a: clamp01(Math.round(n) / 100) }
  emit('commit', hex.value)
}

interface EyeDropperResult { sRGBHex: string }
type EyeDropperCtor = new () => { open: () => Promise<EyeDropperResult> }
const eyeDropper = computed(() => (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper)

async function pickFromScreen() {
  const Ctor = eyeDropper.value
  if (!Ctor) return
  try {
    const { sRGBHex } = await new Ctor().open()
    const next = normalizeHex(sRGBHex)
    if (next) commitHex(next)
  } catch {
    // Cancelled (Esc).
  }
}

const THUMB = 'pointer-events-none absolute size-3 -translate-1/2 rounded-full ring-2 ring-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]'
const CHECKER = 'bg-[repeating-conic-gradient(var(--ui-bg-accented)_0_25%,transparent_0_50%)] bg-size-[8px_8px]'
</script>

<template>
  <div
    class="space-y-2.5"
    data-color-custom
  >
    <div
      class="relative h-36 cursor-crosshair touch-none rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-(color:--editor-selection)"
      :style="{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsva.h} 100% 50%)` }"
      role="slider"
      tabindex="0"
      aria-label="Saturation and brightness"
      :aria-valuetext="`Saturation ${Math.round(hsva.s * 100)}%, brightness ${Math.round(hsva.v * 100)}%`"
      data-color-area
      @pointerdown="down('area', $event)"
      @pointermove="move('area', $event)"
      @pointerup="up('area')"
      @keydown="key('area', $event)"
    >
      <span
        :class="THUMB"
        :style="{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: opaque }"
      />
    </div>
    <div
      class="relative h-2.5 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-1 focus-visible:ring-(color:--editor-selection)"
      style="background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
      role="slider"
      tabindex="0"
      aria-label="Hue"
      :aria-valuenow="Math.round(hsva.h)"
      aria-valuemin="0"
      aria-valuemax="360"
      data-color-hue
      @pointerdown="down('hue', $event)"
      @pointermove="move('hue', $event)"
      @pointerup="up('hue')"
      @keydown="key('hue', $event)"
    >
      <span
        :class="THUMB"
        class="top-1/2"
        :style="{ left: `${(hsva.h / 360) * 100}%`, background: `hsl(${hsva.h} 100% 50%)` }"
      />
    </div>
    <div
      class="relative h-2.5 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-1 focus-visible:ring-(color:--editor-selection)"
      :class="CHECKER"
      role="slider"
      tabindex="0"
      aria-label="Alpha"
      :aria-valuenow="Math.round(hsva.a * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
      data-color-alpha
      @pointerdown="down('alpha', $event)"
      @pointermove="move('alpha', $event)"
      @pointerup="up('alpha')"
      @keydown="key('alpha', $event)"
    >
      <span
        class="absolute inset-0 rounded-full"
        :style="{ background: `linear-gradient(to right, transparent, ${opaque})` }"
      />
      <span
        :class="THUMB"
        class="top-1/2"
        :style="{ left: `${hsva.a * 100}%`, background: hex }"
      />
    </div>
    <div class="flex gap-1.5">
      <EditorCommitInput
        class="min-w-0 flex-1 font-mono"
        size="xs"
        aria-label="Hex"
        :model-value="hexText"
        data-color-hex
        @commit="commitHex"
      />
      <EditorCommitInput
        class="w-16 shrink-0"
        size="xs"
        aria-label="Alpha percent"
        :model-value="alphaText"
        data-color-alpha-field
        @commit="commitAlpha"
      />
      <UTooltip
        v-if="eyeDropper"
        text="Pick from screen"
      >
        <EditorButton
          variant="ghost"
          size="sm"
          icon="i-lucide-pipette"
          aria-label="Pick a colour from the screen"
          data-color-eyedropper
          @click="pickFromScreen"
        />
      </UTooltip>
    </div>
  </div>
</template>
