<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { activeMessage } from '@bildr/editor-core/viewport'
import { isCanvasMessage } from '../canvas/protocol.ts'
import type { CanvasToEditor, EditorToCanvas, RenderMessage } from '../canvas/protocol.ts'
import { canvasSrc } from './config.ts'
import { fitScale } from './scale.ts'
import { useDesign } from './store.ts'

/**
 * The canvas iframe (`/__bildr/canvas`, P4a): the editor owns the model and
 * pushes it with `bildr:render`; the canvas reports gestures back. Messages
 * count only from this frame's window and this origin. The frame lays out as
 * wide as the device, always (so its breakpoints match the device), and as
 * tall as its content (`bildr:size`); when the stage is narrower it is scaled
 * down visually (`scale.ts`). The stage scrolls: the canvas hands wheel
 * gestures over (it never scrolls itself).
 */

const design = useDesign()
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const stage = useTemplateRef<HTMLDivElement>('stage')
const ready = ref(false)
const contentHeight = ref(0)
const height = computed(() => Math.max(contentHeight.value, 600))
const stageWidth = ref(0)
const scale = computed(() => fitScale(design.device.value.width, stageWidth.value))
watch(scale, (value) => {
  design.zoom.value = value
}, { immediate: true })

const post = (message: EditorToCanvas) => {
  frame.value?.contentWindow?.postMessage(message, window.location.origin)
}

const renderMessage = computed<RenderMessage | null>(() => design.file.value
  ? {
      type: 'bildr:render',
      file: design.file.value,
      components: design.components.value,
      layouts: design.layouts.value,
      theme: design.theme.value,
      breakpointBase: design.base.value,
      data: design.data.value,
      paths: design.pagePaths.value,
      ...(design.fileKind.value === 'page' ? { path: design.pagePaths.value[design.fileId.value!] } : {}),
      // A component shows the variant being edited (the primary when none is).
      ...(design.fileKind.value === 'component' ? { variant: design.variant.value ? { id: design.variant.value.id, label: design.variant.value.name } : { id: null, label: 'default' } } : {}),
      view: design.view.value
    }
  : null)

const sendRender = () => renderMessage.value && post(renderMessage.value)
const sendSelection = () => post({ type: 'bildr:select', nodeId: design.selectedId.value, nodeIds: [...design.selectedIds.value] })
const sendDevice = () => post(activeMessage(design.device.value.id, design.device.value.id, scale.value))

const sendAll = () => {
  sendRender()
  sendSelection()
  post({ type: 'bildr:mode', mode: design.mode.value })
  post({ type: 'bildr:hover', nodeId: design.hoveredId.value })
  post({ type: 'bildr:dark', dark: design.dark.value })
  sendDevice()
}

watch(renderMessage, () => ready.value && sendRender())
watch(design.selectedIds, () => ready.value && sendSelection(), { deep: true })
watch(design.hoveredId, id => ready.value && post({ type: 'bildr:hover', nodeId: id }))
watch(design.dragCancels, () => ready.value && post({ type: 'bildr:cancel-drag' }))
watch(design.mode, mode => ready.value && post({ type: 'bildr:mode', mode }))
watch(design.dark, dark => ready.value && post({ type: 'bildr:dark', dark }))
watch([design.device, scale], () => ready.value && sendDevice())

const onMessage = (event: MessageEvent) => {
  if (event.source !== frame.value?.contentWindow || event.origin !== window.location.origin || !isCanvasMessage<CanvasToEditor>(event.data)) return
  const message = event.data
  switch (message.type) {
    case 'bildr:ready':
      ready.value = true
      design.dragging.value = null
      sendAll()
      break
    case 'bildr:click':
      design.selectNode(message.nodeId, message.shift || message.meta)
      break
    case 'bildr:contextmenu':
      if (!design.selectedIds.value.includes(message.nodeId)) design.select([message.nodeId])
      break
    case 'bildr:key':
      design.onKey(message)
      break
    case 'bildr:drop':
      void design.onDrop(message.parentId, message.index, message.payload)
      break
    case 'bildr:interaction':
      // A submitted form or an action run in preview may have changed the app's rows.
      if (message.step.kind === 'runAction') design.refreshDataSoon()
      break
    case 'bildr:size':
      contentHeight.value = message.height
      break
    case 'bildr:wheel':
      stage.value?.scrollBy({ left: message.dx, top: message.dy })
      break
    case 'bildr:pan':
      stage.value?.scrollBy({ left: -message.dx, top: -message.dy })
      break
    case 'bildr:style-preview':
      design.dragging.value = message.style ? message.nodeId : null
      post({ type: 'bildr:preview', nodeId: message.nodeId, style: message.style })
      break
    case 'bildr:style-commit':
      design.dragging.value = null
      // The patch keeps showing until the model it lands in is read again; a refusal drops it too.
      void design.commitStyle(message.nodeId, message.style).finally(() => post({ type: 'bildr:preview', nodeId: message.nodeId, style: null }))
      break
    default:
      break
  }
}

const measureStage = () => {
  stageWidth.value = stage.value?.clientWidth ?? 0
}
const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureStage)

onMounted(() => {
  window.addEventListener('message', onMessage)
  measureStage()
  if (stage.value) observer?.observe(stage.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  observer?.disconnect()
})
</script>

<template>
  <div
    ref="stage"
    class="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-elevated/50 p-6 [scrollbar-gutter:stable]"
    data-testid="stage"
  >
    <div
      class="mx-auto shadow-lg ring ring-default"
      :style="{ width: `${design.device.value.width * scale}px`, height: `${height * scale}px` }"
      data-testid="canvas-box"
    >
      <div
        class="origin-top-left"
        :style="{ width: `${design.device.value.width}px`, ...(scale === 1 ? {} : { transform: `scale(${scale})` }) }"
      >
        <iframe
          ref="frame"
          :src="canvasSrc"
          title="Canvas"
          class="block w-full border-0 bg-white"
          :style="{ height: `${height}px` }"
          data-testid="canvas-frame"
        />
      </div>
    </div>
  </div>
</template>
