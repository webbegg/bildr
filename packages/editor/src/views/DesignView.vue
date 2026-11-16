<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { editorTakesKey, hasTextSelection } from '@bildr/editor-core/clipboardKeys'
import ProblemsList from '../components/ProblemsList.vue'
import FormActionDialog from '../design/FormActionDialog.vue'
import RequiredValuesDialog from '../design/RequiredValuesDialog.vue'
import { createDesign, DESIGN_KEY } from '../design/store.ts'
import { PANEL_KEY, clampPanel, storedPanelWidth } from '../editor/panelWidth.ts'
import { createEditor, provideEditor } from '../editor/useEditor.ts'

/**
 * The Design screen (V1): the hosted editor's shell over the `.bildr/` model
 * (`pages/editor/[projectId].vue`, U-E1). The adapter (`createEditor`, over the design
 * store) is what the ported components call as `useEditor()`; the P4 panels that
 * panels that read the store directly (the P5 binding panels) still use `useDesign()`, so both are
 * provided. A toolbar, the sidebar (Pages, Layers, Assets) and the canvas in the middle
 * (`EditorCanvas`: zoom and pan, a frame per device or the variant board, with its floating bar),
 * the inspector on the right. The Design view has the theme library on the left and the
 * theme's panel on the right, with the style guide in its own canvas; the Settings view takes the
 * middle. Every edit is a module action; the canvas shows what the model says.
 */

const design = createDesign()
provide(DESIGN_KEY, design)
const toast = useToast()
const editor = provideEditor(createEditor(design, { toast: notice => toast.add(notice) }))

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
  // Copy and paste are the editor's from the layers tree only (the canvas sends its own), never over selected text.
  const inLayers = !!(event.target as HTMLElement | null)?.closest?.('[data-layers]')
  const context = { focus: inLayers ? 'layers' as const : 'other' as const, textSelected: hasTextSelection(window), hasSelection: editor.selectedIds.length > 0 }
  if (!editorTakesKey({ key: event.key, code: event.code, meta, shift: event.shiftKey, alt: event.altKey }, context)) return
  if (editor.shortcut(event.key, event.metaKey || event.ctrlKey, event.shiftKey, allowsNavigation(event.target), { code: event.code, alt: event.altKey })) event.preventDefault()
}

// The dark editor chrome (main.css) is scoped to this page's document; the canvas iframe keeps the project theme.
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  document.documentElement.classList.add('bildr-editor')
  void editor.start()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  document.documentElement.classList.remove('bildr-editor')
  editor.dispose()
})

// The right panel resizes from its left edge, within 280–480px, remembered across reloads.
const panelWidth = ref(storedPanelWidth())

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

const preview = computed(() => editor.canvasMode === 'preview')

/** A key the canvas frames could not use goes to the editor's shortcuts, as a key typed in the editor does (the hosted page's `@key`). */
const canvasKey = (message: { key: string, code: string, meta: boolean, shift: boolean, alt: boolean }) =>
  editor.shortcut(message.key, message.meta, message.shift, true, { code: message.code, alt: message.alt, canvas: true })
</script>

<template>
  <div
    class="absolute inset-0 flex flex-col"
    :data-editor-context="editor.componentId ? 'component' : editor.layoutId ? 'layout' : 'page'"
    :data-editor-variant="editor.variant ? '' : undefined"
    data-testid="design"
  >
    <EditorToolbar>
      <template #actions>
        <span
          v-if="editor.problems.length"
          class="me-1 rounded-full bg-error/15 px-2 py-0.5 text-[11px] font-[550] text-error"
          :title="`The model has ${editor.problems.length} problem${editor.problems.length === 1 ? '' : 's'}`"
          data-testid="problems-count"
        >{{ editor.problems.length }} {{ editor.problems.length === 1 ? 'problem' : 'problems' }}</span>
        <span
          v-if="editor.regenerated && !editor.regenerated.ok"
          data-testid="regenerate-error"
          class="me-1 max-w-48 truncate text-[11px] text-error"
          :title="editor.regenerated.error ?? editor.regenerated.problems?.map(problem => problem.message).join('\n')"
        >
          The app could not regenerate
        </span>
        <UTooltip :text="preview ? 'Back to editing' : 'Run the interactions on the canvas'">
          <EditorButton
            variant="ghost"
            :icon="preview ? 'i-lucide-pencil-ruler' : 'i-lucide-mouse-pointer-click'"
            :aria-label="preview ? 'Edit' : 'Interact'"
            :aria-pressed="preview"
            :class="{ 'bg-white/10 text-highlighted': preview }"
            data-testid="preview-toggle"
            @click="editor.canvasMode = preview ? 'edit' : 'preview'"
          />
        </UTooltip>
      </template>
    </EditorToolbar>
    <EditorQuickActions />
    <EditorCreateDialog />
    <EditorPropertiesModal />
    <EditorConfirm />
    <div
      v-if="editor.problems.length"
      class="p-4"
      data-testid="design-problems"
    >
      <ProblemsList
        title="The model has problems, so there is nothing to design until they are fixed"
        :problems="editor.problems"
      >
        <UButton
          :to="{ path: '/data', query: { item: 'files' } }"
          label="Open model files"
          icon="i-lucide-file-json"
          color="error"
          variant="soft"
          size="sm"
          class="mt-2"
          data-testid="open-model"
        />
      </ProblemsList>
    </div>
    <div
      v-else
      class="flex min-h-0 flex-1"
    >
      <aside
        v-if="editor.mode === 'design'"
        class="flex w-64 shrink-0 flex-col border-r border-default"
      >
        <DesignLibrary class="min-h-0 flex-1" />
      </aside>
      <aside
        v-else-if="editor.mode === 'build'"
        class="flex w-64 shrink-0 flex-col border-r border-default"
      >
        <EditorSidebar class="min-h-0 flex-1" />
      </aside>
      <!-- Hidden, not unmounted, in the other views so the canvas does not reload. The canvas zooms and pans edge to edge. -->
      <main
        v-show="editor.mode === 'build'"
        class="relative min-w-0 flex-1 bg-(--editor-canvas)"
        data-canvas-area
      >
        <EditorNodeMenu class="size-full">
          <EditorCanvas @key="canvasKey" />
        </EditorNodeMenu>
      </main>
      <main
        v-if="editor.mode === 'design'"
        class="min-w-0 flex-1 bg-(--editor-canvas) p-4"
        data-design-area
      >
        <EditorCanvas
          view="tokens"
          class="size-full"
        />
      </main>
      <main
        v-if="editor.mode === 'settings'"
        class="min-w-0 flex-1 overflow-y-auto"
      >
        <EditorSettings />
      </main>
      <aside
        v-if="editor.mode === 'design'"
        class="shrink-0 overflow-y-auto border-l border-default"
        :style="{ width: `${panelWidth}px` }"
        data-design-panel-area
      >
        <EditorDesignPanel />
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
        <div class="flex h-full flex-col overflow-y-auto">
          <EditorInspector />
        </div>
      </aside>
    </div>
    <div
      v-if="editor.error"
      class="absolute bottom-28 left-1/2 z-20 flex max-w-[min(32rem,90%)] -translate-x-1/2 items-center gap-1 rounded-xl bg-(--editor-bar) py-1 ps-3 pe-1 text-[12px] text-error shadow-[0_4px_16px_rgba(0,0,0,0.35)] ring ring-white/10"
      role="alert"
    >
      <span
        class="truncate"
        :title="editor.error"
        data-testid="design-error"
      >
        {{ editor.error }}
      </span>
      <EditorButton
        variant="ghost"
        size="xs"
        icon="i-lucide-x"
        aria-label="Dismiss"
        data-testid="design-error-dismiss"
        @click="editor.dismissError()"
      />
    </div>
    <RequiredValuesDialog />
    <FormActionDialog />
  </div>
</template>
