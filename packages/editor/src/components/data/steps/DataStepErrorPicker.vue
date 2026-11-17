<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { errorProblems } from '../../../editor/stepDraft.ts'
import type { DraftError } from '../../../editor/stepDraft.ts'
import { record } from '../../../editor/stepExpr.ts'
import type { Step } from '../../../editor/stepExpr.ts'
import type { StepScope } from '../../../editor/stepScope.ts'

/**
 * The error a refuse (`error`) or a load (`orError`) raises (S10, D10c): one of the action's errors, a new one added on the
 * spot, or, for a load, none (it carries on without the row), and a value for each thing the error carries (`errorData`). It does
 * not change the step: it says what would change (`change`), and an error added here (`add-error`) is added to the draft first.
 */
const { step, field, scope, errors, label, help } = defineProps<{
  step: Step
  /** The part of the step that names the error. */
  field: 'error' | 'orError'
  scope: StepScope
  errors: DraftError[]
  label: string
  help?: string
}>()
const emit = defineEmits<{ 'change': [patch: Record<string, unknown>], 'add-error': [error: Partial<DraftError>] }>()

const NEW = '__new'
/** "No error" for a load: a select option cannot be the empty text. */
const NONE = '__none'
const optional = computed(() => field === 'orError')
const raised = computed(() => typeof step[field] === 'string' ? step[field] : '')
const items = computed(() => [
  ...optional.value ? [{ label: 'Carry on without it', value: NONE }] : [],
  ...errors.map(error => ({ label: `${error.type} (${error.status})`, value: error.type })),
  { label: 'New error…', value: NEW }
])
const carried = computed(() => errors.find(error => error.type === raised.value)?.data ?? [])
const data = computed(() => record(step.errorData))
const capital = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

/** What an error carries, as far as the action has an input of the same name. */
const dataFor = (type: string) => Object.fromEntries((errors.find(error => error.type === type)?.data ?? [])
  .filter(entry => scope.input.some(input => input.path === entry.name))
  .map(entry => [entry.name, { $input: entry.name }]))

const adding = ref(false)
const fresh = reactive({ type: '', status: '422', message: '' })
const problem = computed(() => errorProblems({ ...fresh, data: [] }, new Set(errors.map(error => error.type)))[0] ?? '')

function pick(type: string) {
  if (type === NEW) {
    adding.value = true
    return
  }
  adding.value = false
  if (type === NONE) emit('change', { orError: undefined, errorData: undefined })
  else emit('change', { [field]: type, errorData: Object.keys(dataFor(type)).length ? dataFor(type) : undefined })
}

function add() {
  if (problem.value) return
  emit('add-error', { type: fresh.type, status: fresh.status, message: fresh.message, data: [] })
  emit('change', { [field]: fresh.type, errorData: undefined })
  Object.assign(fresh, { type: '', status: '422', message: '' })
  adding.value = false
}
</script>

<template>
  <EditorFormRow
    :label="label"
    :help="help"
  >
    <EditorSelect
      :model-value="adding ? NEW : raised || (optional ? NONE : '')"
      :items="items"
      :placeholder="optional ? 'Carry on without it' : 'Pick an error'"
      :aria-label="optional ? 'Error when there is no row' : 'Error to refuse with'"
      :data-step-field="field"
      @update:model-value="pick"
    />
  </EditorFormRow>
  <div
    v-if="adding"
    class="space-y-2 rounded-lg bg-white/4 p-3"
    data-step-new-error
  >
    <div class="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
      <EditorInput
        v-model="fresh.type"
        placeholder="slug_taken"
        aria-label="New error name"
        mono
        data-new-error="type"
      />
      <EditorInput
        v-model="fresh.status"
        inputmode="numeric"
        placeholder="422"
        aria-label="New error status"
        data-new-error="status"
      />
    </div>
    <EditorInput
      v-model="fresh.message"
      placeholder="The message the client gets"
      aria-label="New error message"
      data-new-error="message"
    />
    <div class="flex items-center gap-2">
      <p
        v-if="problem && fresh.type"
        class="min-w-0 flex-1 text-[12px] leading-4 text-error"
        data-new-error-problem
      >
        {{ problem }}
      </p>
      <span
        v-else
        class="flex-1"
      />
      <EditorButton
        label="Cancel"
        size="xs"
        @click="adding = false"
      />
      <EditorButton
        label="Add error"
        variant="primary"
        size="xs"
        :disabled="!!problem"
        data-new-error-add
        @click="add"
      />
    </div>
  </div>
  <EditorFormRow
    v-for="entry in carried"
    :key="entry.name"
    :label="capital(entry.name)"
    help="What the error carries"
  >
    <DataStepValue
      :value="data[entry.name]"
      :scope="scope"
      :type="entry.type"
      :label="`Value of ${entry.name} the error carries`"
      :data-step-error-data="entry.name"
      @update:value="emit('change', { errorData: { ...data, [entry.name]: $event } })"
    />
  </EditorFormRow>
</template>
