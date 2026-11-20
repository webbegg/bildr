<script setup lang="ts">
import { computed } from 'vue'
import ProblemsList from '../components/ProblemsList.vue'
import DataEmptyState from '../components/data/DataEmptyState.vue'
import SimpleApiPanel from '../components/simple-data/SimpleApiPanel.vue'
import SimpleDataList from '../components/simple-data/SimpleDataList.vue'
import SimpleStoreCreate from '../components/simple-data/SimpleStoreCreate.vue'
import SimpleStoreForm from '../components/simple-data/SimpleStoreForm.vue'
import { ADVANCED_PATH } from '../editor/dataRoutes.ts'
import { targetsOfProblem } from '../editor/findingTargets.ts'
import { useDataScreen } from '../editor/useDataScreen.ts'
import { useAdvancedHandoff, useSimpleData } from '../editor/useSimpleData.ts'

/**
 * The simple Data section (simple data, SD-1, S2, S3), the screen at `/data` that the menu's Data entry opens: the Data view for what
 * most apps need, the values their pages share and the remote APIs they call. On the left a list with two sections, State (the
 * stores) and APIs; beside it the item chosen, a store's form (how long it keeps its values and its fields, saved together) or an API's
 * panel, or the form that makes a store. Every edit is a module action (`state_*`); the screen shares the workspace's editor, its
 * chrome and its guard over unsaved edits (`useDataScreen`). The store or API shown is in the URL (`?item=state:st_cart`,
 * `?item=api:ds_shop`, `useSimpleData`).
 *
 * Today's Data workspace, with collections, connections, queries and actions, is the advanced mode: the toolbar's Advanced switch opens
 * it on its own route (`/data/advanced`), on the store shown when there is one, and an item only it has that is asked for here (a link
 * from a store's uses) opens it too (`useAdvancedHandoff`). A model with problems is the list of them, with the way to fix them in the
 * workspace's All model files.
 */
const editor = useDataScreen()
const { stores, apis, store, api, shown, creating, choose, startCreate, created } = useSimpleData(editor)
useAdvancedHandoff(editor)

/** The workspace on the store shown, so Advanced keeps the user where they are. */
const advanced = computed(() => ({ path: ADVANCED_PATH, query: shown.value?.kind === 'state' ? { item: `state:${shown.value.id}` } : {} }))
</script>

<template>
  <div
    class="absolute inset-0 flex flex-col"
    data-editor-context="page"
    data-testid="simple-data"
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
          icon="i-lucide-sliders-horizontal"
          label="Advanced"
          title="Collections, connections, queries and actions"
          :to="advanced"
          data-testid="simple-to-advanced"
        />
      </template>
    </EditorToolbar>
    <EditorQuickActions />
    <EditorConfirm />
    <div
      v-if="editor.problems.length"
      class="min-h-0 flex-1 overflow-y-auto p-4"
      data-testid="data-problems"
    >
      <ProblemsList
        title="The model has problems, so there is nothing to show until they are fixed"
        :problems="editor.problems"
        :targets="problem => targetsOfProblem(problem, editor.model)"
      >
        <UButton
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
      <aside class="w-64 shrink-0 border-r border-default">
        <SimpleDataList
          :stores="stores"
          :apis="apis"
          :shown="shown"
          :creating="creating"
          @choose="choose($event)"
          @create="startCreate()"
        />
      </aside>
      <main class="flex min-w-0 flex-1 bg-(--editor-canvas)">
        <SimpleStoreCreate
          v-if="creating"
          class="min-w-0 flex-1"
          @created="created($event)"
          @cancel="choose(null)"
        />
        <SimpleStoreForm
          v-else-if="store"
          :key="store.id"
          :state="store"
          class="min-w-0 flex-1"
        />
        <SimpleApiPanel
          v-else-if="api"
          :api="api"
          class="min-w-0 flex-1"
        />
        <DataEmptyState
          v-else-if="stores.length || apis.length"
          icon="i-lucide-mouse-pointer-click"
          title="Choose what to edit"
          heading="h2"
          data-simple-nothing
        >
          Pick a store or an API on the left. Stores keep the values your pages share, like a filter or a toggle.
        </DataEmptyState>
        <DataEmptyState
          v-else
          icon="i-lucide-toggle-right"
          title="Make your first store"
          heading="h2"
          data-simple-nothing
        >
          A store keeps values your pages share while the app runs, like a filter or a toggle.
          <template #actions>
            <EditorButton
              variant="primary"
              label="New store"
              icon="i-lucide-plus"
              data-simple-main-new
              @click="startCreate()"
            />
          </template>
        </DataEmptyState>
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
