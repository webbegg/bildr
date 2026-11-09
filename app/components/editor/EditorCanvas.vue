<script setup lang="ts">
import type { CanvasToEditor, CanvasView, EditorToCanvas } from '#shared/editor/protocol'
import { isCanvasMessage } from '#shared/editor/protocol'

const { view = 'page' } = defineProps<{ view?: CanvasView }>()
const editor = useEditor()
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const stage = useTemplateRef<HTMLDivElement>('stage')

// The page view is as wide as the editor's device, so the canvas media queries
// (`md:`, `lg:`) match it; a device wider than the stage is scaled down to fit.
const stageSize = reactive({ width: 0, height: 0 })
const observer = import.meta.client
  ? new ResizeObserver(([entry]) => Object.assign(stageSize, { width: entry!.contentRect.width, height: entry!.contentRect.height }))
  : null
const frameStyle = computed(() => {
  const width = editor.device.width
  const scale = stageSize.width ? Math.min(1, stageSize.width / width) : 1
  return { width: `${width}px`, height: `${stageSize.height / scale}px`, transform: `translateX(-50%) scale(${scale})` }
})
const emit = defineEmits<{ key: [message: Extract<CanvasToEditor, { type: 'bildr:key' }>] }>()

function post(message: EditorToCanvas) {
  // The document lives in reactive proxies, which postMessage cannot clone.
  frame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify(message)), window.location.origin)
}

function render() {
  if (!editor.page || !editor.project || !editor.theme) return
  post({ type: 'bildr:render', page: editor.page, base: `/p/${editor.project.slug}`, theme: editor.theme, view, lists: editor.lists })
  post({ type: 'bildr:select', nodeId: editor.selectedId })
}

function onMessage(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || !isCanvasMessage<CanvasToEditor>(event.data)) return
  const message = event.data
  if (message.type === 'bildr:ready') render()
  else if (message.type === 'bildr:hover') editor.hoveredId = message.nodeId
  else if (message.type === 'bildr:click') editor.selectedId = message.nodeId
  else if (message.type === 'bildr:key') emit('key', message)
  else if (message.type === 'bildr:drop') editor.drop(message.payload, { parentId: message.parentId, index: message.index })
}

watch(() => [editor.page, editor.theme, editor.lists], render, { deep: true })
watch(() => editor.selectedId, nodeId => post({ type: 'bildr:select', nodeId }))
watch(() => editor.hoveredId, nodeId => post({ type: 'bildr:hover', nodeId }))

onMounted(() => {
  window.addEventListener('message', onMessage)
  if (stage.value) observer?.observe(stage.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  observer?.disconnect()
})
</script>

<template>
  <iframe
    v-if="view === 'tokens'"
    ref="frame"
    src="/canvas"
    title="Token preview"
    class="size-full rounded-lg bg-white shadow-sm ring ring-default"
  />
  <div
    v-else
    ref="stage"
    class="relative size-full overflow-hidden"
  >
    <iframe
      ref="frame"
      src="/canvas"
      title="Canvas"
      :data-device="editor.device.id"
      class="absolute top-0 left-1/2 origin-top rounded-lg bg-white shadow-sm ring ring-default"
      :style="frameStyle"
    />
  </div>
</template>
