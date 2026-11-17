<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ARTIFACT_KINDS, attempt } from '../../editor/dataArtifacts.ts'
import type { ArtifactKind } from '../../editor/dataArtifacts.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { FOCUS_RING } from '../../editorUi.ts'

/**
 * The "+" dialog of the Queries and Actions sections (S10, DW-7d). A new query asks for a collection, One or Many rows and a
 * name (`query_create`) and opens on its Definition; a new action asks for a collection, a template (Create, Update, Delete or
 * Blank, each with a line saying what it starts with) and a name (`action_create`) and opens on its Overview. What the module
 * refuses is shown in the dialog and what was typed stays. Every new item is valid: the module makes it so.
 */
const { kind } = defineProps<{ kind: ArtifactKind | null }>()
const emit = defineEmits<{ close: [] }>()
const editor = useEditor()

/** The kind last asked for, so the dialog keeps its words while it closes. */
const shown = ref<ArtifactKind>(kind ?? 'query')
watch(() => kind, (next) => {
  if (!next) return
  shown.value = next
  entity.value = editor.dataCollection?.id ?? editor.collections[0]?.id ?? ''
  name.value = ''
  result.value = 'many'
  template.value = 'create'
  error.value = ''
})

const entity = ref(editor.dataCollection?.id ?? editor.collections[0]?.id ?? '')
const name = ref('')
const result = ref<'one' | 'many'>('many')
const template = ref<'create' | 'update' | 'delete' | 'blank'>('create')
const error = ref('')
const saving = ref(false)

const words = computed(() => ARTIFACT_KINDS[shown.value])
const collectionItems = computed(() => editor.collections.map(collection => ({ label: collection.name, value: collection.id })))
const RESULTS = [{ value: 'one', label: 'One' }, { value: 'many', label: 'Many' }]
const TEMPLATES = [
  { value: 'create', label: 'Create', description: 'Adds a row from the form\'s fields.' },
  { value: 'update', label: 'Update', description: 'Loads a row by its id and saves what changes in it.' },
  { value: 'delete', label: 'Delete', description: 'Removes a row by its id.' },
  { value: 'blank', label: 'Blank', description: 'Starts with one step that returns nothing, for you to build on.' }
] as const

watch([name, entity, result, template], () => {
  error.value = ''
})

const open = computed({
  get: () => kind !== null,
  set: (value) => {
    if (!value) emit('close')
  }
})

async function submit() {
  const typed = name.value.trim()
  if (!typed || !entity.value || saving.value) return
  saving.value = true
  const done = shown.value === 'query'
    ? await attempt<{ queryId: string }>(editor, 'query_create', { entity: entity.value, result: result.value, name: typed }, 'Could not create the query')
    : await attempt<{ actionId: string }>(editor, 'action_create', { entity: entity.value, template: template.value, name: typed }, 'Could not create the action')
  saving.value = false
  if ('error' in done) {
    error.value = done.error
    return
  }
  editor.mode = 'data'
  if ('queryId' in done.result) {
    editor.queryId = done.result.queryId
    editor.dataTab = 'definition'
  } else {
    editor.actionId = done.result.actionId
    editor.dataTab = 'overview'
  }
  emit('close')
}
</script>

<template>
  <EditorModal
    v-model:open="open"
    :title="`New ${words.label.toLowerCase()}`"
    :description="shown === 'query' ? 'A query reads a collection for your pages.' : 'An action changes a collection when a form or a button runs it.'"
  >
    <div
      class="space-y-3"
      data-artifact-dialog="create"
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
        v-if="shown === 'query'"
        label="Returns"
        help="Many rows, or the one row whose id a page gives"
      >
        <EditorSegmented
          :model-value="result"
          :items="RESULTS"
          data-artifact-result
          @update:model-value="result = $event as 'one' | 'many'"
        />
      </EditorFormRow>
      <EditorFormRow
        v-else
        label="Template"
        stacked
      >
        <div
          class="grid w-full grid-cols-2 gap-2"
          role="radiogroup"
          aria-label="Template"
        >
          <button
            v-for="option in TEMPLATES"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="template === option.value"
            class="flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors"
            :class="[FOCUS_RING, template === option.value ? 'border-primary bg-primary/10' : 'border-white/8 hover:bg-white/4']"
            :data-action-template="option.value"
            @click="template = option.value"
          >
            <span class="text-[12px] font-[550] text-highlighted">{{ option.label }}</span>
            <span
              class="text-[11px] leading-4 text-muted"
              data-action-template-description
            >{{ option.description }}</span>
          </button>
        </div>
      </EditorFormRow>
      <EditorFormRow
        label="Name"
        :help="`camelCased, like ${shown === 'query' ? 'recent posts → recentPosts' : 'publish post → publishPost'}`"
      >
        <EditorInput
          v-model="name"
          :placeholder="shown === 'query' ? 'recentPosts' : 'publishPost'"
          autofocus
          aria-label="Name"
          data-artifact-name
          @keydown.enter.prevent="submit"
        />
      </EditorFormRow>
      <p
        v-if="error"
        class="flex items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
        role="alert"
        data-artifact-error
      >
        <UIcon
          name="i-lucide-circle-alert"
          class="size-4 shrink-0"
        />
        {{ error }}
      </p>
    </div>

    <template #footer>
      <EditorButton
        label="Cancel"
        @click="open = false"
      />
      <EditorButton
        variant="primary"
        :label="`Create ${words.label.toLowerCase()}`"
        :loading="saving"
        :disabled="!name.trim() || !entity"
        data-artifact-submit
        @click="submit"
      />
    </template>
  </EditorModal>
</template>
