<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { activeMessage } from '@bildr/editor-core/viewport'
import { isCanvasMessage } from '../canvas/protocol.ts'
import type { CanvasToEditor, EditorToCanvas, RenderMessage } from '../canvas/protocol.ts'
import { canvasSrc } from './config.ts'
import { useDesign } from './store.ts'

/**
 * The canvas iframe (`/__bildr/canvas`, P4a): the editor owns the model and
 * pushes it with `bildr:render`; the canvas reports gestures back. Messages
 * count only from this frame's window and this origin. The frame is as wide
 * as the device and as tall as its content (`bildr:size`), inside a stage
 * that scrolls: the canvas hands wheel gestures over (it never scrolls itself).
 */

const design = useDesign()
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const stage = useTemplateRef<HTMLDivElement>('stage')
const ready = ref(false)
const contentHeight = ref(0)
const height = computed(() => Math.max(contentHeight.value, 600))

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
      view: 'page'
    }
  : null)

const sendRender = () => renderMessage.value && post(renderMessage.value)
const sendSelection = () => post({ type: 'bildr:select', nodeId: design.selectedId.value, nodeIds: [...design.selectedIds.value] })
const sendDevice = () => post(activeMessage(design.device.value.id, design.device.value.id, 1))

const sendAll = () => {
  sendRender()
  sendSelection()
  post({ type: 'bildr:mode', mode: design.mode.value })
  post({ type: 'bildr:hover', nodeId: design.hoveredId.value })
  sendDevice()
}

watch(renderMessage, () => ready.value && sendRender())
watch(design.selectedIds, () => ready.value && sendSelection(), { deep: true })
watch(design.hoveredId, id => ready.value && post({ type: 'bildr:hover', nodeId: id }))
watch(design.mode, mode => ready.value && post({ type: 'bildr:mode', mode }))
watch(design.device, () => ready.value && sendDevice())

const onMessage = (event: MessageEvent) => {
  if (event.source !== frame.value?.contentWindow || event.origin !== window.location.origin || !isCanvasMessage<CanvasToEditor>(event.data)) return
  const message = event.data
  switch (message.type) {
    case 'bildr:ready':
      ready.value = true
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
    case 'bildr:size':
      contentHeight.value = message.height
      break
    case 'bildr:wheel':
      stage.value?.scrollBy({ left: message.dx, top: message.dy })
      break
    case 'bildr:pan':
      stage.value?.scrollBy({ left: -message.dx, top: -message.dy })
      break
    case 'bildr:style-commit':
      void design.edit('node_update_style', { file: design.fileId.value!, nodeIds: [message.nodeId], ...(design.device.value.breakpoint ? { breakpoint: design.device.value.breakpoint } : {}), style: message.style })
      break
    default:
      break
  }
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <div
    ref="stage"
    class="min-w-0 flex-1 overflow-auto bg-elevated/50 p-6"
    data-testid="stage"
  >
    <div
      class="mx-auto shadow-lg ring ring-default"
      :style="{ width: `${design.device.value.width}px`, maxWidth: '100%' }"
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
</template>
