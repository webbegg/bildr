<script setup lang="ts">
import { computed, ref } from 'vue'
import { apiSourceOf } from '../../shared/simpleApi.ts'
import type { SimpleApi } from '../../shared/simpleData.ts'
import { useEditor } from '../../editor/useEditor.ts'
import SimpleApiItemDialog from './SimpleApiItemDialog.vue'
import type { ItemKind, ItemTarget } from './SimpleApiItemDialog.vue'
import SimpleApiModel from './SimpleApiModel.vue'
import SimpleApiOperation from './SimpleApiOperation.vue'
import SimpleApiOverview from './SimpleApiOverview.vue'

/**
 * An API's panel in the simple Data section (simple data, S2, S4, S6): the API's overview, its settings and its lists of queries, actions
 * and models (`SimpleApiOverview`), or the editor of the one item opened from a list, a query or an action (`SimpleApiOperation`) or a
 * model (`SimpleApiModel`), shown instead with a way back. Every write is a module action (`api_*`, `datasource_delete`). The API's own
 * Delete, and the New, Rename and Delete of a list's items, are one dialog (`SimpleApiItemDialog`).
 *
 * Moving to an editor, or back, asks about unsaved edits first, as the workspace does (`leaveData`); an item opened from the + is not saved
 * until its editor is, so it is only a name until then. A rename keeps the open editor (and its edits) on the renamed item.
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
const back = () => editor.leaveData(() => {
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

    <template v-if="source">
      <SimpleApiOperation
        v-if="editing && editing.kind !== 'model'"
        :key="editing.key"
        :source="source"
        :kind="editing.kind"
        :name="editing.name"
        @back="back()"
        @rename="rename(editing.kind, editing.name)"
      />
      <SimpleApiModel
        v-else-if="editing"
        :key="editing.key"
        :source="source"
        :name="editing.name"
        @back="back()"
        @rename="rename('model', editing.name)"
      />
      <SimpleApiOverview
        v-else
        :source="source"
        @open="show"
        @create="create"
        @rename="rename"
        @remove="remove"
      />
      <SimpleApiItemDialog
        :target="dialog"
        :source="source"
        @close="dialog = null"
        @named="show"
        @renamed="renamed"
        @deleted="deleted"
      />
    </template>
  </div>
</template>
