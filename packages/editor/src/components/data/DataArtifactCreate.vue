<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useArtifactDialog } from '../../editor/useArtifactDialog.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { RESULTS } from '../../shared/dataArtifacts.ts'
import type { ArtifactKind, QueryResultKind } from '../../shared/dataArtifacts.ts'

/**
 * The "+" dialog of the Queries and Actions sections (S10, DW-7d). A new query asks for a collection, One or Many rows and a
 * name (`query_create`) and opens on its Definition; a new action asks for a collection, a template (Create, Update, Delete or
 * Blank, each with a line saying what it starts with) and a name (`action_create`) and opens on its Overview. What the module
 * refuses is shown in the dialog and what was typed stays. Every new item is valid: the module makes it so.
 */
const { kind } = defineProps<{ kind: ArtifactKind | null }>()
const emit = defineEmits<{ close: [] }>()
const editor = useEditor()

const entity = ref('')
const name = ref('')
const result = ref<QueryResultKind>('many')
const template = ref<'create' | 'update' | 'delete' | 'blank'>('create')

// Each time it opens it starts over, on the collection shown (else the first).
const { shown, open, words, error, saving, submit: run } = useArtifactDialog(() => kind, () => emit('close'), () => {
  entity.value = editor.dataCollection?.id ?? editor.collections[0]?.id ?? ''
  name.value = ''
  result.value = 'many'
  template.value = 'create'
})
const what = computed(() => shown.value ?? 'query')

const collectionItems = computed(() => editor.collections.map(collection => ({ label: collection.name, value: collection.id })))
const TEMPLATES = [
  { value: 'create', label: 'Create', description: 'Adds a row from the form\'s fields.' },
  { value: 'update', label: 'Update', description: 'Loads a row by its id and saves what changes in it.' },
  { value: 'delete', label: 'Delete', description: 'Removes a row by its id.' },
  { value: 'blank', label: 'Blank', description: 'Starts with one step that returns nothing, for you to build on.' }
] as const

watch([name, entity, result, template], () => {
  error.value = ''
})

async function submit() {
  const typed = name.value.trim()
  if (!typed || !entity.value) return
  if (what.value === 'query') {
    const done = await run<{ queryId: string }>('query_create', { entity: entity.value, result: result.value, name: typed }, 'Could not create the query')
    if (!done) return
    editor.mode = 'data'
    editor.queryId = done.queryId
    editor.dataTab = 'definition'
  } else {
    const done = await run<{ actionId: string }>('action_create', { entity: entity.value, template: template.value, name: typed }, 'Could not create the action')
    if (!done) return
    editor.mode = 'data'
    editor.actionId = done.actionId
    editor.dataTab = 'overview'
  }
  emit('close')
}
</script>

<template>
  <DataArtifactDialog
    v-model:open="open"
    dialog="create"
    :title="`New ${words.label.toLowerCase()}`"
    :description="what === 'query' ? 'A query reads a collection for your pages.' : 'An action changes a collection when a form or a button runs it.'"
    :error="error"
    :saving="saving"
    :submit-label="`Create ${words.label.toLowerCase()}`"
    :can-submit="!!name.trim() && !!entity"
    @submit="submit"
  >
    <EditorFormRow label="Collection">
      <EditorSelect
        :model-value="entity"
        :items="collectionItems"
        placeholder="Choose a collection"
        aria-label="Collection"
        data-artifact-collection-select
        @update:model-value="entity = $event"
      />
    </EditorFormRow>
    <EditorFormRow
      v-if="what === 'query'"
      label="Returns"
      help="Many rows, or the one row whose id a page gives"
    >
      <EditorSegmented
        :model-value="result"
        :items="RESULTS"
        data-artifact-result
        @update:model-value="result = $event as QueryResultKind"
      />
    </EditorFormRow>
    <EditorFormRow
      v-else
      label="Template"
      stacked
    >
      <EditorChoiceCards
        :model-value="template"
        :items="TEMPLATES"
        label="Template"
        hook="data-action-template"
        :columns="2"
        @update:model-value="template = $event as typeof template"
      />
    </EditorFormRow>
    <EditorFormRow
      label="Name"
      :help="`camelCased, like ${what === 'query' ? 'recent posts → recentPosts' : 'publish post → publishPost'}`"
    >
      <EditorInput
        v-model="name"
        :placeholder="what === 'query' ? 'recentPosts' : 'publishPost'"
        autofocus
        aria-label="Name"
        data-artifact-name
        @keydown.enter.prevent="submit"
      />
    </EditorFormRow>
  </DataArtifactDialog>
</template>
