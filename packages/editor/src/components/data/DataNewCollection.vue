<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { takeRefusal } from '../../editor/dataArtifactActions.ts'
import { DEFAULT_STORAGE, nextStep, storageOptionsOf } from '../../editor/newCollection.ts'
import type { StorageKind } from '../../editor/newCollection.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { FOCUS_RING } from '../../editorUi.ts'

/**
 * The New collection dialog (S7, DW-6): a name and where the rows live. **Sample data** (the default) keeps them in a memory
 * source the user never has to hear about; **Database** is offered only when the project has one; **REST API** reads them through
 * an existing connection or a new one. Create makes the collection for the first two (one text field, `title`: the rest is added
 * in the Fields tab, which it opens) and refuses nothing silently: what the module refuses is shown here and what was typed stays.
 * REST API needs an endpoint, so Continue hands the name to the dialog of the connection (`connection`) or to Import from API
 * (`import`), which finishes the collection; nothing is made before that. `connection` opens it on REST API with that one chosen
 * (the connection's "Add…").
 */
const { connection = null } = defineProps<{ connection?: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  connection: [value: { connection: string, name: string }]
  import: [value: { name: string }]
}>()
const editor = useEditor()

/** The value of the connection list's "New connection…" entry. */
const NEW = '__new__'

const name = ref('')
const storage = ref<StorageKind>(DEFAULT_STORAGE)
const chosen = ref(NEW)
const error = ref('')
const saving = ref(false)

const options = computed(() => storageOptionsOf(editor.model))
const connectionItems = computed(() => [
  ...editor.connections.map(entry => ({ label: entry.name, value: entry.id })),
  { label: 'New connection…', value: NEW }
])

// Each time it opens it starts over: Sample data, or REST API on the connection it was asked for.
watch(open, (isOpen) => {
  if (!isOpen) return
  const asked = editor.connections.find(entry => entry.id === connection)
  name.value = ''
  storage.value = asked ? 'rest' : DEFAULT_STORAGE
  chosen.value = asked?.id ?? editor.connections[0]?.id ?? NEW
  error.value = ''
  saving.value = false
}, { immediate: true })

watch([name, storage, chosen], () => {
  error.value = ''
})

const canSubmit = computed(() => storage.value === 'rest' || !!name.value.trim())

async function submit() {
  if (!canSubmit.value || saving.value) return
  const next = nextStep({ storage: storage.value, connection: chosen.value === NEW ? null : chosen.value, name: name.value })
  if (next.kind !== 'create') {
    if (next.kind === 'connection') emit('connection', { connection: next.connection, name: next.name })
    else emit('import', { name: next.name })
    open.value = false
    return
  }
  saving.value = true
  const id = await editor.createCollection({ name: next.name, storage: next.storage })
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
    description="Choose where its rows live. You add its fields afterwards, in the Fields tab."
    :error="error"
    :saving="saving"
    :submit-label="storage === 'rest' ? 'Continue' : 'Create collection'"
    :can-submit="canSubmit"
    @submit="submit"
  >
    <EditorFormRow
      label="Name"
      stacked
    >
      <EditorInput
        v-model="name"
        :placeholder="storage === 'rest' ? 'Proposed from the endpoint when left empty' : 'Menu'"
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
      <div
        class="flex w-full flex-col gap-2"
        role="radiogroup"
        aria-label="Where its rows live"
      >
        <button
          v-for="option in options"
          :key="option.kind"
          type="button"
          role="radio"
          :aria-checked="storage === option.kind"
          class="flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors"
          :class="[FOCUS_RING, storage === option.kind ? 'border-primary bg-primary/10' : 'border-white/8 hover:bg-white/4']"
          :data-storage="option.kind"
          @click="storage = option.kind"
        >
          <span class="text-[12px] font-[550] text-highlighted">{{ option.label }}</span>
          <span
            class="text-[11px] leading-4 text-muted"
            data-storage-description
          >{{ option.description }}</span>
        </button>
      </div>
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
