<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useToast } from '@nuxt/ui/composables/useToast'
import ProblemsList from '../components/ProblemsList.vue'
import DataFiles from '../components/data/DataFiles.vue'
import DataWorkspace from '../components/data/DataWorkspace.vue'
import { createDesign, DESIGN_KEY } from '../design/store.ts'
import { useDataLocation } from '../editor/dataLocation.ts'
import { createEditor, provideEditor } from '../editor/useEditor.ts'
import { useStatus } from '../status.ts'

/**
 * The Data screen (U7, `/data`), the Data workspace (S2): the hosted editor's Data view over the `.bildr/`
 * model, with the hosted page's chrome (the toolbar, whose view menu goes back to the Canvas, Design and
 * Settings, and ⌘K). Collections are entities, connections are REST data sources, and every edit is a module
 * action (`entity_*`, `datasource_*`); the rows are the app's or the entity's sample data, read-only (E2).
 * The tree on the left lists the Collections and Connections, and the item chosen shows its tabs beside it
 * (Rows · Fields · Endpoints · JSON for a collection, Endpoints · JSON for a connection). The item and the
 * tab are in the URL query (`?item=collection:ent_post&tab=fields`). The tree ends with All model files (S3,
 * `?item=files&file=<path>`): every `.bildr/` file as JSON, which is also how a model with problems is fixed: the
 * problems are listed, and the files and their editor stay beside them. They are shown too when the model could
 * not be read at all, or the module said it is not ok without naming a problem: never an endless spinner.
 *
 * It is its own screen, not a mode of `DesignView`: the adapter opens it when the view changes to
 * Data (`editor/views.ts`), and the editor made here starts on it. The pending migration plan is the shell's status (S6): the
 * workspace shows it where the collections it changes are, and tells the shell when it does (`editor.planShown`), so the shell's
 * own banner is shown only while the plan is not.
 */

const design = createDesign()
provide(DESIGN_KEY, design)
const toast = useToast()
const status = useStatus()
const editor = provideEditor(createEditor(design, { toast: notice => toast.add(notice), view: 'data', plan: status.plan }))
const withdrawPlanShown = status.showPlanFrom(computed(() => editor.planShown))
useDataLocation(editor)
// Leaving the screen is a move away from unsaved edits too.
onBeforeRouteLeave(() => editor.dataDirty === null || editor.leaveData(() => {}))

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

// Keys inside a popover or menu are theirs.
function inFloatingLayer(event: KeyboardEvent): boolean {
  return !!(event.target as HTMLElement | null)?.closest?.('[data-dismissable-layer], [role="dialog"], [role="menu"], [role="listbox"]')
}

// ⌘K opens the quick actions and ⌘P the preview from anywhere; undo and redo work outside fields.
function onKeyDown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()
  if (meta && !event.shiftKey && !event.altKey && (key === 'p' || key === 'k')) {
    if (editor.shortcut(event.key, true, false)) event.preventDefault()
    return
  }
  if (event.defaultPrevented || isEditable(event.target) || inFloatingLayer(event)) return
  if (meta && (key === 'z' || key === 'y') && editor.shortcut(event.key, true, event.shiftKey)) event.preventDefault()
}

// The dark editor chrome (main.css) is scoped to this page's document.
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  document.documentElement.classList.add('bildr-editor')
  void editor.start()
})
onBeforeUnmount(() => {
  withdrawPlanShown()
  window.removeEventListener('keydown', onKeyDown)
  document.documentElement.classList.remove('bildr-editor')
  editor.dispose()
})
</script>

<template>
  <div
    class="absolute inset-0 flex flex-col"
    data-editor-context="page"
    data-testid="data"
  >
    <EditorToolbar>
      <template #actions>
        <span
          v-if="editor.problems.length"
          class="me-1 rounded-full bg-error/15 px-2 py-0.5 text-[11px] font-[550] text-error"
          :title="`The model has ${editor.problems.length} problem${editor.problems.length === 1 ? '' : 's'}`"
          data-testid="problems-count"
        >{{ editor.problems.length }} {{ editor.problems.length === 1 ? 'problem' : 'problems' }}</span>
      </template>
    </EditorToolbar>
    <EditorQuickActions />
    <EditorConfirm />
    <div
      v-if="editor.problems.length"
      class="flex min-h-0 flex-1 flex-col"
    >
      <div
        class="max-h-[40%] shrink-0 overflow-y-auto p-4"
        data-testid="data-problems"
      >
        <ProblemsList
          title="The model has problems, so there is nothing to show until they are fixed"
          :problems="editor.problems"
        >
          <UButton
            v-if="!editor.dataFiles"
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
      <DataFiles
        v-if="editor.dataFiles"
        class="min-h-0 flex-1 border-t border-default"
      />
    </div>
    <div
      v-else-if="editor.loading"
      class="flex flex-1 items-center justify-center"
      data-testid="data-loading"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-6 animate-spin text-dimmed"
      />
    </div>
    <DataFiles
      v-else-if="!editor.model && editor.dataFiles"
      class="min-h-0 flex-1"
    />
    <div
      v-else-if="!editor.model"
      class="p-4"
      data-testid="data-unreadable"
    >
      <ProblemsList
        title="The model could not be read"
        :message="editor.error ?? 'The module answered that the model is not ok, and named no problem.'"
      >
        <div class="mt-2 flex gap-2">
          <UButton
            label="Retry"
            icon="i-lucide-refresh-cw"
            color="error"
            variant="soft"
            size="sm"
            @click="editor.reload()"
          />
          <UButton
            :to="{ path: '/data', query: { item: 'files' } }"
            label="Open model files"
            icon="i-lucide-file-json"
            color="error"
            variant="soft"
            size="sm"
            data-testid="open-model"
          />
        </div>
      </ProblemsList>
    </div>
    <div
      v-else
      class="flex min-h-0 flex-1"
    >
      <aside class="flex w-64 shrink-0 flex-col border-r border-default">
        <DataTree class="min-h-0 flex-1" />
      </aside>
      <main class="flex min-w-0 flex-1 bg-(--editor-canvas)">
        <DataWorkspace class="min-w-0 flex-1" />
      </main>
    </div>
    <div
      v-if="editor.error"
      class="absolute bottom-8 left-1/2 z-20 flex max-w-[min(32rem,90%)] -translate-x-1/2 items-center gap-1 rounded-xl bg-(--editor-bar) py-1 ps-3 pe-1 text-[12px] text-error shadow-[0_4px_16px_rgba(0,0,0,0.35)] ring ring-white/10"
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
  </div>
</template>
