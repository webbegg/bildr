<script setup lang="ts">
import ProblemsList from '../components/ProblemsList.vue'
import DataFiles from '../components/data/DataFiles.vue'
import DataWorkspace from '../components/data/DataWorkspace.vue'
import { useDataLocation } from '../editor/dataLocation.ts'
import { ADVANCED_PATH, SIMPLE_PATH } from '../editor/dataRoutes.ts'
import { targetsOfProblem } from '../editor/findingTargets.ts'
import { useDataScreen } from '../editor/useDataScreen.ts'

/**
 * The advanced Data screen (U7, `/data/advanced`), the Data workspace (S2): the hosted editor's Data view over the `.bildr/`
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
 * The simple Data section is `/data` (simple data, SD-1), which the menu's Data entry opens: its Advanced switch opens this screen, and the
 * toolbar's Simple link goes back. It is its own screen, not a mode of `DesignView`: the editor made here starts on the Data view. The pending migration plan is the shell's status (S6): the
 * workspace shows it where the collections it changes are, and tells the shell when it does (`editor.planShown`), so the shell's
 * own banner is shown only while the plan is not.
 */

const editor = useDataScreen()
useDataLocation(editor)
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
        <EditorButton
          variant="ghost"
          icon="i-lucide-layout-list"
          label="Simple"
          title="Back to the simple Data section"
          :to="SIMPLE_PATH"
          data-testid="advanced-to-simple"
        />
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
          :targets="problem => targetsOfProblem(problem, editor.model)"
        >
          <UButton
            v-if="!editor.dataFiles"
            :to="{ path: ADVANCED_PATH, query: { item: 'files' } }"
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
            :to="{ path: ADVANCED_PATH, query: { item: 'files' } }"
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
