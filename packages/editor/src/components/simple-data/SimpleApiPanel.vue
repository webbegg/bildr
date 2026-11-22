<script setup lang="ts">
import { computed, ref } from 'vue'
import { apiQueryPages, usedInPagesWords } from '../../shared/apiPageUse.ts'
import { actionSummary, apiSourceOf, modelSummary, querySummary } from '../../shared/simpleApi.ts'
import type { SimpleApi } from '../../shared/simpleData.ts'
import { FOCUS_RING } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import SimpleApiItemDialog from './SimpleApiItemDialog.vue'
import type { ItemKind, ItemTarget } from './SimpleApiItemDialog.vue'
import SimpleApiList from './SimpleApiList.vue'
import type { ApiListRow } from './SimpleApiList.vue'
import SimpleApiModel from './SimpleApiModel.vue'
import SimpleApiOperation from './SimpleApiOperation.vue'
import SimpleApiSettings from './SimpleApiSettings.vue'

/**
 * An API's panel in the simple Data section (simple data, S2, S4, S6; api panel P1): a tree on the left, the API's Settings and then its
 * Queries, Actions and Models by name (`SimpleApiList`), and on the right what is chosen in it: the settings (`SimpleApiSettings`), or the
 * editor of a query or an action (`SimpleApiOperation`) or of a model (`SimpleApiModel`). The tree stays while an editor is open, with the
 * open item marked. Every write is a module action (`api_*`, `datasource_delete`). The API's own Delete, and the New, Rename and Delete of
 * the tree's items, are one dialog (`SimpleApiItemDialog`).
 *
 * Moving to another item asks about unsaved edits first, as the workspace does (`leaveData`); an item opened from the + is not saved
 * until its editor is, so until then it is a row of its own in the tree. A rename keeps the open editor (and its edits) on the renamed item.
 */
const { api } = defineProps<{ api: SimpleApi }>()
const editor = useEditor()

const source = computed(() => apiSourceOf(editor.model, api.id))

/** The item whose editor is open. `key` tells one opening from another, so a rename keeps the editor and its edits. */
const editing = ref<{ kind: ItemKind, name: string, key: number } | null>(null)
let openings = 0
const dialog = ref<ItemTarget | null>(null)

const show = (kind: ItemKind, name: string) => editor.leaveData(() => {
  editing.value = { kind, name, key: ++openings }
})
const showSettings = () => editor.leaveData(() => {
  editing.value = null
})
/** A new item asks for its name first: moving to its editor comes after, so unsaved edits are asked about before the dialog. */
const create = (kind: ItemKind) => editor.leaveData(() => {
  dialog.value = { mode: 'new', kind, name: '' }
})
const rename = (kind: ItemKind, name: string) => {
  dialog.value = { mode: 'rename', kind, name }
}
const remove = (kind: ItemKind | 'api', name: string) => {
  dialog.value = { mode: 'delete', kind, name }
}

function renamed(kind: ItemKind, from: string, to: string) {
  if (editing.value?.kind === kind && editing.value.name === from) editing.value = { ...editing.value, name: to }
}
function deleted(kind: ItemKind | 'api', name: string) {
  if (kind === 'api') void editor.reloadEnv()
  else if (editing.value?.kind === kind && editing.value.name === name) editing.value = null
}

/** The tree's groups: each query with where pages use it (pages that read it are what stops it from being deleted). */
const groups = computed<{ kind: ItemKind, title: string, rows: ApiListRow[], empty: string }[]>(() => {
  const from = source.value
  if (!from) return []
  return [
    {
      kind: 'query',
      title: 'Queries',
      rows: from.queries.map((query) => {
        const pages = apiQueryPages(editor.model, from.id, query.name)
        return { name: query.name, note: querySummary(query), ...(pages.length ? { used: usedInPagesWords(pages) } : {}) }
      }),
      empty: 'No queries yet. A query reads data from the API, like the list of products.'
    },
    { kind: 'action', title: 'Actions', rows: from.actions.map(action => ({ name: action.name, note: actionSummary(action) })), empty: 'No actions yet. An action changes data in the API, like adding a product.' },
    { kind: 'model', title: 'Models', rows: from.models.map(model => ({ name: model.name, note: modelSummary(model) })), empty: 'No models yet. A model is the shape of what the API answers or takes.' }
  ]
})
/** The open item's name for its group's rows, or the name of a new one that is not in its group yet. */
const openIn = (group: { kind: ItemKind, rows: ApiListRow[] }) => editing.value?.kind === group.kind ? editing.value.name : undefined
const pendingIn = (group: { kind: ItemKind, rows: ApiListRow[] }) => {
  const name = openIn(group)
  return name !== undefined && !group.rows.some(row => row.name === name) ? name : undefined
}
</script>

<template>
  <div
    class="flex size-full min-w-0 flex-col"
    :data-simple-api-panel="api.id"
  >
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default ps-6 pe-3">
      <UIcon
        name="i-lucide-globe"
        class="size-4 shrink-0 text-dimmed"
      />
      <h2
        class="truncate text-[13px] font-[550] text-highlighted"
        data-simple-title
      >
        {{ api.name }}
      </h2>
      <span class="shrink-0 text-[11px] text-dimmed">API</span>
      <span class="shrink-0 truncate font-mono text-[11px] text-dimmed">{{ api.host }}</span>
      <span class="flex-1" />
      <EditorButton
        variant="ghost"
        icon="i-lucide-trash-2"
        label="Delete"
        data-simple-api-delete
        @click="remove('api', api.name)"
      />
    </header>

    <div
      v-if="source"
      class="flex min-h-0 flex-1"
    >
      <nav
        class="w-60 shrink-0 space-y-3 overflow-y-auto border-r border-default p-2"
        :aria-label="`${api.name}'s settings, queries, actions and models`"
        data-api-tree
      >
        <button
          type="button"
          :class="['flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]', FOCUS_RING, editing ? 'text-toned hover:bg-white/4' : 'bg-white/8 text-highlighted']"
          :aria-current="editing ? undefined : 'page'"
          data-api-settings-open
          @click="showSettings()"
        >
          <UIcon
            name="i-lucide-settings-2"
            class="size-4 shrink-0 text-dimmed"
          />
          Settings
        </button>
        <SimpleApiList
          v-for="group in groups"
          :key="group.kind"
          :kind="group.kind"
          :title="group.title"
          :rows="group.rows"
          :empty="group.empty"
          :open="openIn(group)"
          :pending="pendingIn(group)"
          @open="show(group.kind, $event)"
          @create="create(group.kind)"
          @rename="rename(group.kind, $event)"
          @remove="remove(group.kind, $event)"
        />
      </nav>

      <div class="flex min-w-0 flex-1 flex-col">
        <SimpleApiOperation
          v-if="editing && editing.kind !== 'model'"
          :key="editing.key"
          :source="source"
          :kind="editing.kind"
          :name="editing.name"
          @back="showSettings()"
          @rename="rename(editing.kind, editing.name)"
        />
        <SimpleApiModel
          v-else-if="editing"
          :key="editing.key"
          :source="source"
          :name="editing.name"
          @back="showSettings()"
          @rename="rename('model', editing.name)"
        />
        <SimpleApiSettings
          v-else
          :source="source"
        />
      </div>
    </div>
    <SimpleApiItemDialog
      v-if="source"
      :target="dialog"
      :source="source"
      @close="dialog = null"
      @named="show"
      @renamed="renamed"
      @deleted="deleted"
    />
  </div>
</template>
