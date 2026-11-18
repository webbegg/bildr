<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useArtifactDialog } from '../../editor/useArtifactDialog.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { PERSISTENCE, RESULTS } from '../../shared/dataArtifacts.ts'
import type { ArtifactKind, QueryResultKind, StatePersist } from '../../shared/dataArtifacts.ts'

/**
 * The "+" dialog of the Queries, Actions and State sections (S10, DW-7d, B2). A new query asks for a collection, One or Many rows and a
 * name (`query_create`) and opens on its Definition; a new action asks for a collection, a template (Create, Update, Delete or
 * Blank, each with a line saying what it starts with) and a name (`action_create`) and opens on its Overview; a new state asks for a
 * name and how long it keeps its values (`state_create`, on Forgotten on reload) and opens on its Fields. It starts with the one text field
 * the module gives it, `value`, and the dialog says so instead of asking for a first field: the Fields tab is where fields are named and
 * typed, as New collection leaves its first field, `title`, to the Fields tab. What the module refuses is shown in the dialog and what
 * was typed stays. Every new item is valid: the module makes it so.
 */
const { kind } = defineProps<{ kind: ArtifactKind | null }>()
const emit = defineEmits<{ close: [] }>()
const editor = useEditor()

const entity = ref('')
const name = ref('')
const result = ref<QueryResultKind>('many')
const template = ref<'create' | 'update' | 'delete' | 'blank'>('create')
const persist = ref<StatePersist>('memory')

// Each time it opens it starts over, on the collection shown (else the first).
const { shown, open, words, error, saving, submit: run } = useArtifactDialog(() => kind, () => emit('close'), () => {
  entity.value = editor.dataCollection?.id ?? editor.collections[0]?.id ?? ''
  name.value = ''
  result.value = 'many'
  template.value = 'create'
  persist.value = 'memory'
})
const what = computed(() => shown.value ?? 'query')
const DESCRIPTIONS: Record<ArtifactKind, string> = {
  query: 'A query reads a collection for your pages.',
  action: 'An action changes a collection when a form or a button runs it.',
  state: 'State is values the app remembers while it runs, like a filter or a toggle.'
}
const NAMES: Record<ArtifactKind, { help: string, placeholder: string }> = {
  query: { help: 'camelCased, like recent posts → recentPosts', placeholder: 'recentPosts' },
  action: { help: 'camelCased, like publish post → publishPost', placeholder: 'publishPost' },
  state: { help: 'camelCased, like cart filter → cartFilter', placeholder: 'preferences' }
}

const collectionItems = computed(() => editor.collections.map(collection => ({ label: collection.name, value: collection.id })))
const TEMPLATES = [
  { value: 'create', label: 'Create', description: 'Adds a row from the form\'s fields.' },
  { value: 'update', label: 'Update', description: 'Loads a row by its id and saves what changes in it.' },
  { value: 'delete', label: 'Delete', description: 'Removes a row by its id.' },
  { value: 'blank', label: 'Blank', description: 'Starts with one step that returns nothing, for you to build on.' }
] as const

watch([name, entity, result, template, persist], () => {
  error.value = ''
})

async function submit() {
  const typed = name.value.trim()
  if (!typed || (what.value !== 'state' && !entity.value) || saving.value) return
  // What is made is shown instead of the item: unsaved edits are asked about before anything is written.
  if (!await editor.guardLeave()) return
  if (what.value === 'state') {
    const done = await run<{ stateId: string }>('state_create', { name: typed, persist: persist.value }, 'Could not create the state')
    if (!done) return
    editor.mode = 'data'
    editor.stateId = done.stateId
    editor.dataTab = 'fields'
  } else if (what.value === 'query') {
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
    :description="DESCRIPTIONS[what]"
    :error="error"
    :saving="saving"
    :submit-label="`Create ${words.label.toLowerCase()}`"
    :can-submit="!!name.trim() && (what === 'state' || !!entity)"
    @submit="submit"
  >
    <EditorFormRow
      v-if="what !== 'state'"
      label="Collection"
    >
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
      v-else-if="what === 'action'"
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
      :help="NAMES[what].help"
    >
      <EditorInput
        v-model="name"
        :placeholder="NAMES[what].placeholder"
        autofocus
        aria-label="Name"
        data-artifact-name
        @keydown.enter.prevent="submit"
      />
    </EditorFormRow>
    <template v-if="what === 'state'">
      <EditorFormRow
        label="Keeps its values"
        stacked
      >
        <EditorChoiceCards
          :model-value="persist"
          :items="PERSISTENCE"
          label="Keeps its values"
          hook="data-state-persistence"
          @update:model-value="persist = $event as StatePersist"
        />
      </EditorFormRow>
      <p
        class="text-[12px] leading-4 text-dimmed"
        data-state-first-field
      >
        It starts with one text field, “value”. Rename it and add the others in its Fields tab.
      </p>
    </template>
  </DataArtifactDialog>
</template>
