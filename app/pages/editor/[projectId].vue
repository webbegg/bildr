<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const editor = createEditor(String(route.params.projectId))
provide(EDITOR_KEY, editor)
useProjectSync(editor)

const loadError = ref<string | null>(null)
onMounted(() => editor.reload().catch((error) => {
  loadError.value = actionErrorMessage(error)
}))

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

// Keys inside a popover or menu are theirs, and Escape closes an open one rather than clearing the selection.
function inFloatingLayer(event: KeyboardEvent): boolean {
  if (event.key === 'Escape' && document.querySelector('[data-dismissable-layer]')) return true
  return !!(event.target as HTMLElement | null)?.closest?.('[data-dismissable-layer], [role="dialog"], [role="menu"], [role="listbox"]')
}

// Enter, Tab and the arrows keep their meaning on a focused control; they navigate from the page or the layers tree.
function allowsNavigation(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !el || el === document.body || el === document.documentElement || !!el.closest?.('[data-layers]')
}

function onKeyDown(event: KeyboardEvent) {
  // Cmd/Ctrl+P (preview, instead of printing), Cmd/Ctrl+F (sidebar search) and Cmd/Ctrl+K (quick actions) work from fields too.
  const meta = event.metaKey || event.ctrlKey
  if (meta && !event.shiftKey && !event.altKey && ['p', 'f', 'k'].includes(event.key.toLowerCase())) {
    if (editor.shortcut(event.key, true, false)) event.preventDefault()
    return
  }
  // The layers tree handles its own arrow keys first.
  if (event.defaultPrevented || isEditable(event.target) || inFloatingLayer(event)) return
  if (editor.shortcut(event.key, event.metaKey || event.ctrlKey, event.shiftKey, allowsNavigation(event.target), { code: event.code, alt: event.altKey })) event.preventDefault()
}

// The dark editor chrome (main.css) is scoped to this page's document; the canvas iframe keeps the project theme.
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  document.documentElement.classList.add('bildr-editor')
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  document.documentElement.classList.remove('bildr-editor')
})

// The right panel resizes from its left edge, within 280–480px, remembered across reloads.
const PANEL_KEY = 'bildr:panel-width'
const clampPanel = (width: number) => Math.min(480, Math.max(280, Math.round(width)))
const panelWidth = ref(clampPanel(Number(localStorage.getItem(PANEL_KEY)) || 320))

function resizePanel(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement
  const start = { x: event.clientX, width: panelWidth.value }
  handle.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent) => {
    panelWidth.value = clampPanel(start.width + start.x - e.clientX)
  }
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    localStorage.setItem(PANEL_KEY, String(panelWidth.value))
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}

useHead(() => ({ title: editor.project ? `${editor.project.name} · bildr` : 'bildr' }))
</script>

<template>
  <UError
    v-if="loadError"
    :error="{ statusCode: 404, statusMessage: loadError }"
  />
  <div
    v-else-if="editor.project && editor.page"
    class="flex h-screen flex-col"
  >
    <EditorToolbar />
    <EditorQuickActions />
    <div class="flex min-h-0 flex-1">
      <aside
        v-if="editor.mode === 'data'"
        class="flex w-64 shrink-0 flex-col border-r border-default"
      >
        <DataCollections class="min-h-0 flex-1" />
      </aside>
      <aside
        v-else-if="editor.mode === 'build'"
        class="flex w-64 shrink-0 flex-col border-r border-default"
      >
        <EditorSidebar class="min-h-0 flex-1" />
      </aside>
      <!-- Hidden, not unmounted, in the Data and Settings views so the canvas does not reload. The canvas zooms and pans edge to edge. -->
      <main
        v-show="editor.mode === 'build'"
        class="relative min-w-0 flex-1 bg-[#1e1e1e]"
        data-canvas-area
      >
        <EditorComponentBar />
        <EditorLayoutBar />
        <EditorNodeMenu class="size-full">
          <EditorCanvas @key="message => editor.shortcut(message.key, message.meta, message.shift, true)" />
        </EditorNodeMenu>
      </main>
      <main
        v-if="editor.mode === 'data'"
        class="min-w-0 flex-1 overflow-hidden bg-[#1e1e1e]"
        data-data-area
      >
        <DataView class="size-full" />
      </main>
      <main
        v-if="editor.mode === 'settings'"
        class="min-w-0 flex-1 overflow-y-auto"
      >
        <EditorSettings />
      </main>
      <aside
        v-if="editor.mode === 'data' && (editor.collection || editor.connection)"
        class="shrink-0 overflow-y-auto border-l border-default"
        :style="{ width: `${panelWidth}px` }"
        data-data-panel
      >
        <DataPanel />
      </aside>
      <aside
        v-if="editor.mode === 'build'"
        class="relative shrink-0 border-l border-default"
        :style="{ width: `${panelWidth}px` }"
        data-right-panel
      >
        <div
          class="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize hover:bg-primary/40"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          data-panel-resize
          @pointerdown.prevent="resizePanel"
        />
        <div class="h-full overflow-y-auto">
          <EditorInspector />
        </div>
      </aside>
    </div>
  </div>
  <div
    v-else
    class="flex h-screen items-center justify-center"
  >
    <UIcon
      name="i-lucide-loader-circle"
      class="size-6 animate-spin text-dimmed"
    />
  </div>
</template>
