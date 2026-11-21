<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ApiSource } from '@bildr/codegen/edit'
import DataArtifactDialog from '../data/DataArtifactDialog.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { apiQueryPages, usedInPagesWords } from '../../shared/apiPageUse.ts'
import { modelNameOf, operationNameOf } from '../../shared/simpleApi.ts'
import { plainWords } from '../../shared/simpleData.ts'

/**
 * The name, Rename and Delete dialogs of an API's queries, actions and models, and the Delete dialog of the API itself (simple data, S6),
 * one shell for the four (`DataArtifactDialog`). **New** asks for a name only: nothing is written until the editor it opens is saved, so
 * it checks the name against the API's own (a query and an action share their names) and hands it on (`named`). **Rename** runs
 * `api_<kind>_rename` and **Delete** runs `api_<kind>_delete` (`datasource_delete` for the API); what the module refuses (a model a
 * query uses, a name taken) is shown here, in the section's words, with what was typed kept. Words are normalised as the module names things:
 * a query or an action in camelCase, a model in PascalCase; the dialog says the name it will have.
 */
export type ItemKind = 'query' | 'action' | 'model'
export interface ItemTarget {
  mode: 'new' | 'rename' | 'delete'
  /** What it is about: a query, an action, a model, or the API itself. */
  kind: ItemKind | 'api'
  /** The item's name (the API's name for `api`); empty for a new one. */
  name: string
}

const { target, source } = defineProps<{ target: ItemTarget | null, source: ApiSource }>()
const emit = defineEmits<{ close: [], named: [kind: ItemKind, name: string], renamed: [kind: ItemKind, from: string, to: string], deleted: [kind: ItemKind | 'api', name: string] }>()
const editor = useEditor()

/** What was asked for last, so the dialog keeps its words while it closes. */
const shown = ref<ItemTarget | null>(target)
const typed = ref('')
const error = ref('')
const saving = ref(false)
watch(() => target, (next) => {
  if (!next) return
  shown.value = next
  typed.value = next.mode === 'rename' ? next.name : ''
  error.value = ''
}, { immediate: true })
watch(typed, () => {
  error.value = ''
})
const open = computed({
  get: () => target !== null,
  set: (value) => {
    if (!value) emit('close')
  }
})

const NOUN = { query: 'query', action: 'action', model: 'model', api: 'API' } as const
const noun = computed(() => NOUN[shown.value?.kind ?? 'query'])
const normalised = computed(() => shown.value?.kind === 'model' ? modelNameOf(typed.value) : operationNameOf(typed.value))
/** Why a new name can't be taken, before anything is asked of the module. */
const taken = computed(() => {
  if (shown.value?.mode !== 'new' || !normalised.value) return ''
  const name = normalised.value
  if (shown.value.kind === 'model') return source.models.some(model => model.name === name) ? `A model is already named “${name}”` : ''
  return [...source.queries, ...source.actions].some(item => item.name === name) ? `A query or an action is already named “${name}”` : ''
})

/** The pages that read the query being deleted: the module refuses while any does, and the dialog says so before it is asked. */
const usedBy = computed(() => (shown.value?.mode === 'delete' && shown.value.kind === 'query' ? apiQueryPages(editor.model, source.id, shown.value.name) : []))

const title = computed(() => {
  const now = shown.value
  if (!now) return ''
  return now.mode === 'new' ? `New ${noun.value}` : now.mode === 'rename' ? `Rename ${noun.value}` : `Delete ${now.name}?`
})
const description = computed(() => {
  const now = shown.value
  if (now?.mode === 'delete') return now.kind === 'api' ? 'This removes the API with all its queries, actions and models.' : now.kind === 'model' ? 'A model that a query, an action or another model uses can\'t be deleted.' : `This removes the ${noun.value}.`
  if (now?.mode === 'new') return now.kind === 'model' ? 'A model is the shape of what an API answers or takes, like a product with a title and a price.' : 'Nothing is saved until you press Save in the next step.'
  return undefined
})
const canSubmit = computed(() => shown.value?.mode === 'delete' || (!!normalised.value && !taken.value))

async function submit() {
  const now = shown.value
  if (!now || !canSubmit.value || saving.value) return
  if (now.mode === 'new') {
    open.value = false
    emit('named', now.kind as ItemKind, normalised.value)
    return
  }
  saving.value = true
  const done = now.mode === 'rename'
    ? now.name === normalised.value ? { result: {} } : await attempt(editor, `api_${now.kind}_rename`, { datasource: source.id, [now.kind]: now.name, name: normalised.value }, `Could not rename the ${noun.value}`)
    : now.kind === 'api'
      ? await attempt(editor, 'datasource_delete', { datasource: source.id }, 'Could not delete the API')
      : await attempt(editor, `api_${now.kind}_delete`, { datasource: source.id, [now.kind]: now.name }, `Could not delete the ${noun.value}`)
  saving.value = false
  if ('error' in done) {
    error.value = plainWords(done.error)
    return
  }
  open.value = false
  if (now.mode === 'rename') emit('renamed', now.kind as ItemKind, now.name, normalised.value)
  else emit('deleted', now.kind, now.name)
}
</script>

<template>
  <DataArtifactDialog
    v-model:open="open"
    :dialog="shown?.mode === 'new' ? 'create' : shown?.mode ?? 'create'"
    :title="title"
    :description="description"
    :error="taken || error"
    :saving="saving"
    :submit-label="shown?.mode === 'new' ? 'Continue' : shown?.mode === 'rename' ? 'Rename' : 'Delete'"
    :submit-variant="shown?.mode === 'delete' ? 'danger' : 'primary'"
    :can-submit="canSubmit"
    @submit="submit"
  >
    <template v-if="shown?.mode === 'delete'">
      <p
        class="text-[12px] leading-4 text-muted"
        data-api-item-delete-note
      >
        {{ shown.kind === 'api' ? 'The API' : `The ${noun}` }} “{{ shown.name }}” will be removed.
      </p>
      <p
        v-if="usedBy.length"
        class="mt-2 text-[12px] leading-4 text-muted"
        data-api-item-delete-used
      >
        {{ usedInPagesWords(usedBy) }}. A query that pages use can't be deleted: take it off those pages first.
      </p>
    </template>
    <template v-else>
      <EditorFormRow
        label="Name"
        :help="normalised && normalised !== typed.trim() ? `It will be called “${normalised}”` : shown?.kind === 'model' ? 'Any words, like “Order line”' : 'Any words, like “Find products”'"
        stacked
      >
        <EditorInput
          v-model="typed"
          autofocus
          aria-label="Name"
          data-api-item-name
          @keydown.enter.prevent="submit"
        />
      </EditorFormRow>
    </template>
  </DataArtifactDialog>
</template>
