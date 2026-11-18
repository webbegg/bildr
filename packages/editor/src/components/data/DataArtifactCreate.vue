<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useArtifactDialog } from '../../editor/useArtifactDialog.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { KEEPS_VALUES, PERSISTENCE, RESULTS } from '../../shared/dataArtifacts.ts'
import type { ArtifactKind, QueryResultKind, StatePersist } from '../../shared/dataArtifacts.ts'

/**
 * The "+" dialog of the Queries, Actions and State sections (S10, DW-7d, B2). A new query asks for a collection, One or Many rows and a
 * name (`query_create`) and opens on its Definition; a new action asks for a collection, a template (Create, Update, Delete or
 * Blank, each with a line saying what it starts with) and a name (`action_create`) and opens on its Overview; a new state asks for a
 * name and how long it keeps its values (`state_create`, on Forgotten on reload) and opens on its Fields. It starts with the one text field
 * the module gives it, `value`, and the dialog says so instead of asking for a first field: the Fields tab is where fields are named and
 * typed, as New collection leaves its first field, `title`, to the Fields tab. What the module refuses is shown in the dialog and what
 * was typed stays (and the unsaved edits the user agreed to discard first are reported again, as nothing was made). Every new item is
 * valid: the module makes it so. What differs by kind is `KINDS`: its words, whether it asks for a collection, the action it runs and
 * the item it opens.
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

/** What differs between the kinds: its words, the module action that makes it (with what it is given and the refusal's fallback) and the item it opens. */
interface Kind {
  description: string
  help: string
  placeholder: string
  /** Whether it is made over a collection, which the dialog asks for. */
  collection: boolean
  action: string
  fallback: string
  input: (name: string) => Record<string, unknown>
  /** Shows what was made, on the tab it opens on. */
  show: (made: Record<string, unknown>) => void
}
const KINDS: Record<ArtifactKind, Kind> = {
  query: {
    description: 'A query reads a collection for your pages.',
    help: 'camelCased, like recent posts → recentPosts',
    placeholder: 'recentPosts',
    collection: true,
    action: 'query_create',
    fallback: 'Could not create the query',
    input: typed => ({ entity: entity.value, result: result.value, name: typed }),
    show: (made) => {
      editor.queryId = made.queryId as string
      editor.dataTab = 'definition'
    }
  },
  action: {
    description: 'An action changes a collection when a form or a button runs it.',
    help: 'camelCased, like publish post → publishPost',
    placeholder: 'publishPost',
    collection: true,
    action: 'action_create',
    fallback: 'Could not create the action',
    input: typed => ({ entity: entity.value, template: template.value, name: typed }),
    show: (made) => {
      editor.actionId = made.actionId as string
      editor.dataTab = 'overview'
    }
  },
  state: {
    description: 'State is values the app remembers while it runs, like a filter or a toggle.',
    help: 'camelCased, like cart filter → cartFilter',
    placeholder: 'preferences',
    collection: false,
    action: 'state_create',
    fallback: 'Could not create the state',
    input: typed => ({ name: typed, persist: persist.value }),
    show: (made) => {
      editor.stateId = made.stateId as string
      editor.dataTab = 'fields'
    }
  }
}
const config = computed(() => KINDS[what.value])

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
  const current = config.value
  if (!typed || (current.collection && !entity.value) || saving.value) return
  // What is made is shown instead of the item: unsaved edits are asked about before anything is written.
  if (!await editor.guardLeave()) return
  const made = await run(current.action, current.input(typed), current.fallback)
  if (!made) {
    // Nothing was made, and the user may just have agreed to discard edits that are still on the screen.
    editor.reportDirtyAgain()
    return
  }
  editor.mode = 'data'
  current.show(made)
  emit('close')
}
</script>

<template>
  <DataArtifactDialog
    v-model:open="open"
    dialog="create"
    :title="`New ${words.label.toLowerCase()}`"
    :description="config.description"
    :error="error"
    :saving="saving"
    :submit-label="`Create ${words.label.toLowerCase()}`"
    :can-submit="!!name.trim() && (!config.collection || !!entity)"
    @submit="submit"
  >
    <EditorFormRow
      v-if="config.collection"
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
      :help="config.help"
    >
      <EditorInput
        v-model="name"
        :placeholder="config.placeholder"
        autofocus
        aria-label="Name"
        data-artifact-name
        @keydown.enter.prevent="submit"
      />
    </EditorFormRow>
    <template v-if="what === 'state'">
      <EditorFormRow
        :label="KEEPS_VALUES"
        stacked
      >
        <EditorChoiceCards
          :model-value="persist"
          :items="PERSISTENCE"
          :label="KEEPS_VALUES"
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
