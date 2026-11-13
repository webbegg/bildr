<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ActionCallError, callAction, errorMessage } from '../api.ts'
import { KINDS, canonical, getAt, isObject, newArtifactPath, setAt, stringifyModelFile } from '../model.ts'
import type { FormField, KindKey } from '../model.ts'
import type { Json, JsonObject, ModelProblem } from '../types.ts'
import ConfirmModal from './ConfirmModal.vue'
import FieldsEditor from './FieldsEditor.vue'
import ProblemsList from './ProblemsList.vue'

/**
 * One form per artifact kind, from that kind's `KINDS` entry. Editing works on
 * a copy of the file, so keys the form doesn't show are saved back unchanged.
 * Save writes `model_file_put`; the module validates the whole model and
 * answers `invalid` with the problems, shown above the form.
 */
const props = defineProps<{
  kind: KindKey
  /** The file of an existing artifact; absent for a new one. */
  path?: string
  /** The module folder a new artifact goes into. */
  module?: string
  initial: JsonObject
  entityIds: string[]
  datasourceIds: string[]
}>()

const emit = defineEmits<{ saved: [path: string], deleted: [path: string] }>()

const router = useRouter()
const spec = computed(() => KINDS[props.kind])
// A plain deep copy: `initial` may be a reactive proxy, which structuredClone refuses.
const draft = reactive<JsonObject>(JSON.parse(JSON.stringify(props.initial)) as JsonObject)
const jsonText = reactive<Record<string, string>>({})
for (const field of spec.value.fields) {
  if (field.type !== 'json') continue
  const value = getAt(props.initial, field.key)
  jsonText[field.key] = value === undefined ? '' : JSON.stringify(value, null, 2)
}

const saving = ref(false)
const deleting = ref(false)
const confirmDelete = ref(false)
const error = ref<{ message: string, problems: ModelProblem[] } | null>(null)
const saved = ref(false)

const targetPath = computed(() => props.path ?? newArtifactPath(props.kind, draft, props.module))

const textValue = (key: string) => {
  const value = getAt(draft, key)
  return value === undefined || value === null ? '' : String(value)
}
const setText = (field: FormField, value: string | number) => {
  const next = String(value)
  setAt(draft, field.key, next === '' && 'optional' in field && field.optional ? undefined : next)
}
const setNumber = (field: FormField, value: string | number) => {
  const next = String(value).trim()
  setAt(draft, field.key, next === '' || Number.isNaN(Number(next)) ? undefined : Number(next))
}
const setSelect = (field: FormField, value: unknown) => {
  setAt(draft, field.key, value === undefined || value === null || value === '' ? undefined : String(value))
}
const optionsOf = (field: FormField & { type: 'select' }) => {
  if (field.options === 'entities') return props.entityIds
  if (field.options === 'datasources') return props.datasourceIds
  return [...field.options]
}
const multiValue = (key: string) => {
  const value = getAt(draft, key)
  return Array.isArray(value) ? value.map(String) : []
}
const fieldsValue = computed<JsonObject[]>({
  get: () => Array.isArray(draft.fields) ? draft.fields.filter(isObject) : [],
  set: (value) => {
    draft.fields = value
  }
})

/** The file content, or the JSON parts that don't parse. */
const build = (): { content: string } | { problems: ModelProblem[] } => {
  const value = JSON.parse(JSON.stringify(draft)) as JsonObject
  const problems: ModelProblem[] = []
  for (const field of spec.value.fields) {
    if (field.type !== 'json') continue
    const text = (jsonText[field.key] ?? '').trim()
    if (text === '') {
      if (field.optional) setAt(value, field.key, undefined)
      else problems.push({ path: field.label, message: 'Required: enter JSON' })
      continue
    }
    try {
      setAt(value, field.key, JSON.parse(text) as Json)
    } catch (caught) {
      problems.push({ path: field.label, message: `Invalid JSON: ${errorMessage(caught)}` })
    }
  }
  return problems.length ? { problems } : { content: stringifyModelFile(canonical(props.kind, value)) }
}

const save = async () => {
  error.value = null
  saved.value = false
  const path = targetPath.value
  if (!path) {
    error.value = { message: `Give the ${spec.value.singular} a name (and an id) before saving.`, problems: [] }
    return
  }
  const built = build()
  if ('problems' in built) {
    error.value = { message: 'Some JSON parts are invalid.', problems: built.problems }
    return
  }
  saving.value = true
  try {
    await callAction('model_file_put', { path, content: built.content })
    saved.value = true
    emit('saved', path)
  } catch (caught) {
    error.value = { message: errorMessage(caught), problems: caught instanceof ActionCallError ? caught.problems ?? [] : [] }
  } finally {
    saving.value = false
  }
}

const remove = async () => {
  if (!props.path) return
  deleting.value = true
  error.value = null
  try {
    await callAction('model_file_delete', { path: props.path })
    confirmDelete.value = false
    emit('deleted', props.path)
  } catch (caught) {
    confirmDelete.value = false
    error.value = { message: errorMessage(caught), problems: caught instanceof ActionCallError ? caught.problems ?? [] : [] }
  } finally {
    deleting.value = false
  }
}

const viewCode = () => {
  if (props.path) void router.push({ path: '/code', query: { path: props.path } })
}
</script>

<template>
  <form
    class="space-y-4"
    @submit.prevent="save"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold">
          {{ path ? textValue('name') || textValue('id') || spec.singular : `New ${spec.singular}` }}
        </h2>
        <p class="text-sm text-muted">
          <code v-if="targetPath">{{ targetPath }}</code>
          <span v-else>Saved to a path from its name</span>
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          v-if="path"
          color="neutral"
          variant="outline"
          icon="i-lucide-file-code"
          label="View code"
          @click="viewCode"
        />
        <UButton
          v-if="path"
          data-testid="delete"
          color="error"
          variant="outline"
          icon="i-lucide-trash-2"
          label="Delete"
          @click="confirmDelete = true"
        />
        <UButton
          data-testid="save"
          type="submit"
          icon="i-lucide-save"
          label="Save"
          :loading="saving"
        />
      </div>
    </div>

    <div data-testid="form-problems">
      <ProblemsList
        v-if="error"
        title="Not saved"
        :message="error.message"
        :problems="error.problems"
      />
      <UAlert
        v-else-if="saved"
        color="success"
        variant="subtle"
        icon="i-lucide-check"
        title="Saved. The module regenerates the code."
      />
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <UFormField
        v-for="field in spec.fields"
        :key="field.key"
        :label="field.label"
        :hint="'optional' in field && field.optional ? 'optional' : undefined"
        :help="'hint' in field ? field.hint : undefined"
        :class="['json', 'fields', 'textarea', 'multi'].includes(field.type) ? 'md:col-span-2' : ''"
      >
        <UInput
          v-if="field.type === 'text'"
          :data-testid="`input-${field.key}`"
          :model-value="textValue(field.key)"
          :placeholder="field.placeholder"
          class="w-full"
          @update:model-value="setText(field, $event)"
        />
        <UTextarea
          v-else-if="field.type === 'textarea'"
          :data-testid="`input-${field.key}`"
          :model-value="textValue(field.key)"
          :rows="2"
          autoresize
          class="w-full"
          @update:model-value="setText(field, $event)"
        />
        <UInput
          v-else-if="field.type === 'number'"
          :data-testid="`input-${field.key}`"
          type="number"
          :model-value="textValue(field.key)"
          class="w-full"
          @update:model-value="setNumber(field, $event)"
        />
        <USwitch
          v-else-if="field.type === 'switch'"
          :data-testid="`input-${field.key}`"
          :model-value="getAt(draft, field.key) === true"
          @update:model-value="setAt(draft, field.key, $event)"
        />
        <USelect
          v-else-if="field.type === 'select'"
          :data-testid="`input-${field.key}`"
          :model-value="textValue(field.key) || undefined"
          :items="optionsOf(field)"
          placeholder="Choose…"
          class="w-full"
          @update:model-value="setSelect(field, $event)"
        />
        <UCheckboxGroup
          v-else-if="field.type === 'multi'"
          :data-testid="`input-${field.key}`"
          orientation="horizontal"
          :items="[...field.options]"
          :model-value="multiValue(field.key)"
          @update:model-value="setAt(draft, field.key, ($event as string[]).filter(value => field.options.includes(value)).sort((a, b) => field.options.indexOf(a) - field.options.indexOf(b)))"
        />
        <UTextarea
          v-else-if="field.type === 'json'"
          v-model="jsonText[field.key]"
          :data-testid="`input-${field.key}`"
          :rows="3"
          autoresize
          class="w-full font-mono text-xs"
        />
        <FieldsEditor
          v-else-if="field.type === 'fields'"
          v-model="fieldsValue"
        />
      </UFormField>
    </div>

    <ConfirmModal
      v-model:open="confirmDelete"
      :title="`Delete ${textValue('name') || textValue('id') || spec.singular}?`"
      :description="`${path} is removed. The model must stay valid without it.`"
      confirm-label="Delete"
      confirm-test-id="confirm-delete"
      :loading="deleting"
      @confirm="remove"
    />
  </form>
</template>
