<script setup lang="ts">
import type { CanvasToEditor, EditorToCanvas } from '#shared/editor/protocol'
import { isCanvasMessage } from '#shared/editor/protocol'

const editor = useEditor()
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const emit = defineEmits<{ key: [message: Extract<CanvasToEditor, { type: 'bildr:key' }>] }>()

function post(message: EditorToCanvas) {
  // The document lives in reactive proxies, which postMessage cannot clone.
  frame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify(message)), window.location.origin)
}

function render() {
  if (!editor.page || !editor.project) return
  post({ type: 'bildr:render', page: editor.page, base: `/p/${editor.project.slug}` })
  post({ type: 'bildr:select', nodeId: editor.selectedId })
}

function onMessage(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || !isCanvasMessage<CanvasToEditor>(event.data)) return
  const message = event.data
  if (message.type === 'bildr:ready') render()
  else if (message.type === 'bildr:hover') editor.hoveredId = message.nodeId
  else if (message.type === 'bildr:click') editor.selectedId = message.nodeId
  else if (message.type === 'bildr:key') emit('key', message)
}

watch(() => editor.page, render, { deep: true })
watch(() => editor.selectedId, nodeId => post({ type: 'bildr:select', nodeId }))
watch(() => editor.hoveredId, nodeId => post({ type: 'bildr:hover', nodeId }))

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <iframe
    ref="frame"
    src="/canvas"
    title="Canvas"
    class="size-full rounded-lg bg-default shadow-sm ring ring-default"
  />
</template>
