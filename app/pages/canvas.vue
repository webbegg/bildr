<script setup lang="ts">
import type { Page } from '#shared/document/schema'
import type { CanvasToEditor, EditorToCanvas } from '#shared/editor/protocol'
import { isCanvasMessage } from '#shared/editor/protocol'

/**
 * The editor canvas, loaded in an iframe. It renders whatever page the
 * editor sends with the same runtime as the published app, draws hover and
 * selection outlines, and turns pointer and key gestures into messages.
 */
definePageMeta({ layout: false })

const page = shallowRef<Page | null>(null)
const base = ref('')
const selectedId = ref<string | null>(null)
const hoveredId = ref<string | null>(null)

interface Box { top: number, left: number, width: number, height: number, label: string }
const boxes = reactive<{ hover: Box | null, selected: Box | null }>({ hover: null, selected: null })

function post(message: CanvasToEditor) {
  window.parent.postMessage(message, window.location.origin)
}

function nodeIdAt(target: EventTarget | null): string | null {
  return (target as Element | null)?.closest?.('[data-bildr-id]')?.getAttribute('data-bildr-id') ?? null
}

function measure(id: string | null): Box | null {
  const el = id ? document.querySelector(`[data-bildr-id="${id}"]`) : null
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width, height: rect.height, label: el.getAttribute('data-bildr-type') ?? '' }
}

let frame = 0
function track() {
  boxes.hover = hoveredId.value !== selectedId.value ? measure(hoveredId.value) : null
  boxes.selected = measure(selectedId.value)
  frame = requestAnimationFrame(track)
}

function onMessage(event: MessageEvent) {
  if (event.source !== window.parent || !isCanvasMessage<EditorToCanvas>(event.data)) return
  const message = event.data
  if (message.type === 'bildr:render') {
    page.value = message.page
    base.value = message.base
  } else if (message.type === 'bildr:select') {
    selectedId.value = message.nodeId
    if (message.nodeId) document.querySelector(`[data-bildr-id="${message.nodeId}"]`)?.scrollIntoView({ block: 'nearest' })
  } else if (message.type === 'bildr:hover') {
    hoveredId.value = message.nodeId
  }
}

function onPointerMove(event: MouseEvent) {
  const id = nodeIdAt(event.target)
  if (id === hoveredId.value) return
  hoveredId.value = id
  post({ type: 'bildr:hover', nodeId: id })
}

function onPointerLeave() {
  hoveredId.value = null
  post({ type: 'bildr:hover', nodeId: null })
}

/** In the canvas, clicks select: links don't navigate and buttons don't act. */
function onClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const id = nodeIdAt(event.target)
  if (id) post({ type: 'bildr:click', nodeId: id })
}

function onMouseDown(event: MouseEvent) {
  event.preventDefault()
}

const SHORTCUT_KEYS = new Set(['Delete', 'Backspace', 'Escape'])
function onKeyDown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  if (!SHORTCUT_KEYS.has(event.key) && !(meta && ['z', 'y', 'd'].includes(event.key.toLowerCase()))) return
  event.preventDefault()
  post({ type: 'bildr:key', key: event.key, meta, shift: event.shiftKey })
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  document.addEventListener('mousemove', onPointerMove, true)
  document.documentElement.addEventListener('mouseleave', onPointerLeave)
  document.addEventListener('click', onClick, true)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('keydown', onKeyDown)
  frame = requestAnimationFrame(track)
  post({ type: 'bildr:ready' })
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  document.removeEventListener('mousemove', onPointerMove, true)
  document.documentElement.removeEventListener('mouseleave', onPointerLeave)
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('mousedown', onMouseDown, true)
  document.removeEventListener('keydown', onKeyDown)
  cancelAnimationFrame(frame)
})
</script>

<template>
  <div class="relative min-h-screen">
    <BildrPage
      v-if="page"
      :page="page"
      :base="base"
      editable
      class="min-h-screen"
    />
    <div
      v-for="(box, kind) in boxes"
      v-show="box"
      :key="kind"
      class="pointer-events-none absolute z-50 rounded-sm outline-2 -outline-offset-1"
      :class="kind === 'selected' ? 'outline-primary' : 'outline-dashed outline-primary/60'"
      :style="box ? { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` } : undefined"
    >
      <span
        v-if="kind === 'selected' && box"
        class="absolute -top-5 left-0 rounded-t-sm bg-primary px-1.5 text-[10px] leading-5 text-inverted"
      >{{ box.label }}</span>
    </div>
  </div>
</template>
