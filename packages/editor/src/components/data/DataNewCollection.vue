<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { takeRefusal } from '../../editor/dataArtifactActions.ts'
import { DEFAULT_STORAGE, NEW_CONNECTION, canSubmit as canSubmitName, connectionChoices, settleStorage, sourceFor, storageOptionsOf, submitOutcome } from '../../editor/newCollection.ts'
import type { StorageKind } from '../../editor/newCollection.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * The New collection dialog (S7, DW-6): a name and where the rows live. **Sample data** (the default) keeps them in a memory
 * source the user never has to hear about; **Database** is offered only when the project has one; **REST API** reads them through
 * an existing connection or a new one. Create makes the collection for the first two (one text field, `title`: the rest is added
 * in the Fields tab, which it opens) and refuses nothing silently: what the module refuses is shown here and what was typed stays.
 * REST API needs an endpoint, so Continue hands the name to the dialog of the connection (`connection`) or to the one that makes a
 * new connection (`import`), which finishes the collection; nothing is made before that. `connection` opens it on REST API with
 * that one chosen (the connection's "Add…").
 *
 * It cannot be closed while it creates, and what a create answers after the dialog was closed and opened again is not
 * for the dialog it is now: nothing closes, nothing is shown, the mode and the tab stay. A Database chosen when the project
 * loses its database falls back to Sample data.
 */
const { connection = null } = defineProps<{ connection?: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  connection: [value: { connection: string, name: string }]
  import: [value: { name: string }]
}>()
const editor = useEditor()

const name = ref('')
const storage = ref<StorageKind>(DEFAULT_STORAGE)
const chosen = ref(NEW_CONNECTION)
const error = ref('')
const saving = ref(false)
/** Counts the times it opened: a create answers for the opening it started in. */
let opening = 0

const options = computed(() => storageOptionsOf(editor.model))
const hasDatabase = computed(() => !!editor.model && sourceFor(editor.model, 'database') !== undefined)
const connectionItems = computed(() => connectionChoices(editor.connections))
const submittable = computed(() => canSubmitName(storage.value, name.value))

// Each time it opens it starts over: Sample data, or REST API on the connection it was asked for.
watch(open, (isOpen) => {
  if (!isOpen) return
  opening++
  const asked = editor.connections.find(entry => entry.id === connection)
  name.value = ''
  storage.value = asked ? 'rest' : DEFAULT_STORAGE
  chosen.value = asked?.id ?? editor.connections[0]?.id ?? NEW_CONNECTION
  error.value = ''
  saving.value = false
}, { immediate: true })

watch([name, storage, chosen], () => {
  error.value = ''
})

// The project can lose its database while this is open: a choice it no longer offers gives way to Sample data.
watch(() => editor.model, (model) => {
  storage.value = settleStorage(model, storage.value)
})

async function submit() {
  if (!submittable.value || saving.value) return
  const outcome = submitOutcome({ storage: storage.value, connection: chosen.value, name: name.value })
  if (outcome.kind !== 'create') {
    if (outcome.kind === 'connection') emit('connection', { connection: outcome.connection, name: outcome.name })
    else emit('import', { name: outcome.name })
    open.value = false
    return
  }
  const started = opening
  saving.value = true
  const id = await editor.createCollection({ name: outcome.name, storage: outcome.storage })
  if (started !== opening) return
  saving.value = false
  if (!id) {
    error.value = takeRefusal(editor, 'Could not create the collection').error
    return
  }
  editor.mode = 'data'
  editor.dataTab = 'fields'
  open.value = false
}
</script>

<template>
  <DataArtifactDialog
    v-model:open="open"
    dialog="create"
    title="New collection"
    description="It starts with one text field, title. You add more in the Fields tab."
    :error="error"
    :saving="saving"
    :submit-label="storage === 'rest' ? 'Continue' : 'Create collection'"
    :can-submit="submittable"
    @submit="submit"
  >
    <EditorFormRow
      :label="storage === 'rest' ? 'Name (optional)' : 'Name'"
      stacked
    >
      <EditorInput
        v-model="name"
        :placeholder="storage === 'rest' ? 'Proposed from the API address when left empty' : 'Menu'"
        autofocus
        aria-label="New collection name"
        data-new-collection-name
        @keydown.enter.prevent="submit"
      />
    </EditorFormRow>
    <EditorFormRow
      label="Where its rows live"
      stacked
    >
      <EditorChoiceCards
        v-model="storage"
        :items="options.map(option => ({ value: option.kind, label: option.label, description: option.description }))"
        label="Where its rows live"
        hook="data-storage"
      />
      <p
        v-if="!hasDatabase"
        class="text-[11px] leading-4 text-dimmed"
        data-no-database
      >
        No database in this project yet
      </p>
    </EditorFormRow>
    <EditorFormRow
      v-if="storage === 'rest'"
      label="Connection"
      stacked
    >
      <EditorSelect
        v-model="chosen"
        :items="connectionItems"
        aria-label="Connection"
        data-new-collection-connection
      />
    </EditorFormRow>
  </DataArtifactDialog>
</template>
