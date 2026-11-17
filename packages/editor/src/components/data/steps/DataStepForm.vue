<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { entityById } from '../../../shared/dataModel.ts'
import type { DraftError, StepsContext } from '../../../editor/stepDraft.ts'
import { defaultLiteral } from '../../../editor/stepScope.ts'
import type { Lookup, Step, StepScope } from '../../../editor/stepScope.ts'

/**
 * The fields of one step, by its kind (S10, D10c); the kinds are the ones the generator writes (`generate/actions.ts`):
 *
 * - **check** (`validate`): nothing to set; it checks the body against the collection's fields.
 * - **refuse** (`assert`): a lookup (`unless`: a collection, how to find the row, and what to find it by) and the error it
 *   refuses with when it finds one, with what the error carries (`errorData`).
 * - **load**: the same lookup, the name the row is given (`as`) and the error to refuse with when there is no row (`orError`).
 * - **write** (`repository`): create, update or delete in a collection, the key and the row an update writes back, and the
 *   fields it sets.
 * - **return**: when it returns (always, or when a condition holds) and the row it returns.
 *
 * It does not change the step: it says the step it would be (`update:step`), and the card's owner puts it in the draft. An
 * error added here (`add-error`) is added to the draft first.
 */
const { step, scope, ctx, errors } = defineProps<{
  step: Step
  scope: StepScope
  ctx: StepsContext
  errors: DraftError[]
}>()
const emit = defineEmits<{ 'update:step': [step: Step], 'add-error': [error: Partial<DraftError>] }>()

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => isObject(value) ? value : {}

/** The step with `patch` over it: a key whose value is undefined is left out. */
function change(patch: Record<string, unknown>) {
  const next: Step = { ...step, ...patch }
  for (const key of Object.keys(patch)) if (patch[key] === undefined) Reflect.deleteProperty(next, key)
  emit('update:step', next)
}

/** The lookup of a refuse and a load: a refuse holds it in `unless`, a load in itself. */
const call = computed(() => step.kind === 'assert' ? record(step.unless) : step)
function changeCall(patch: Record<string, unknown>) {
  if (step.kind !== 'assert') return change(patch)
  const next = { ...record(step.unless), ...patch }
  for (const key of Object.keys(patch)) if (patch[key] === undefined) Reflect.deleteProperty(next, key)
  change({ unless: next })
}

const repo = computed(() => ctx.repos.find(entry => entry.id === call.value.repository))
const repoItems = computed(() => ctx.repos.map(entry => ({ label: entry.name, value: entry.id })))
const lookup = computed(() => repo.value?.lookups.find(entry => entry.op === call.value.op))
const args = computed(() => record(call.value.args))

/** The arguments of a lookup that the action already has an input of the same name for. */
function argsFor(found: Lookup | undefined) {
  return found && scope.input.some(entry => entry.path === found.arg) ? { [found.arg]: { $input: found.arg } } : {}
}

function pickCollection(id: string) {
  const next = ctx.repos.find(entry => entry.id === id)
  if (step.kind === 'repository') {
    const op = next?.writes[0] ?? ''
    change({ repository: id, op, id: undefined, from: undefined, set: undefined, ...keyFor(op) })
    return
  }
  const first = step.kind === 'assert' ? next?.lookups.find(entry => entry.op !== 'get') ?? next?.lookups[0] : next?.lookups[0]
  changeCall({ repository: id, op: first?.op ?? '', args: argsFor(first) })
}
function pickLookup(op: string) {
  changeCall({ op, args: argsFor(repo.value?.lookups.find(entry => entry.op === op)) })
}
function setArg(name: string, value: unknown) {
  changeCall({ args: { ...args.value, [name]: value } })
}

// ── The error a step raises ──────────────────────────────────────────────

const NEW = '__new'
/** "No error" for a load: a select option cannot be the empty text. */
const NONE = '__none'
const errorKey = computed(() => step.kind === 'assert' ? 'error' : 'orError')
const raised = computed(() => typeof step[errorKey.value] === 'string' ? step[errorKey.value] as string : '')
const errorItems = computed(() => [
  ...step.kind === 'load' ? [{ label: 'None: carry on without it', value: NONE }] : [],
  ...errors.map(error => ({ label: `${error.type} (${error.status})`, value: error.type })),
  { label: 'New error…', value: NEW }
])
const carried = computed(() => errors.find(error => error.type === raised.value)?.data ?? [])
const errorData = computed(() => record(step.errorData))

/** What an error carries, as far as the action has an input of the same name. */
const dataFor = (type: string) => Object.fromEntries((errors.find(error => error.type === type)?.data ?? [])
  .filter(entry => scope.input.some(input => input.path === entry.name))
  .map(entry => [entry.name, { $input: entry.name }]))

const adding = ref(false)
const fresh = reactive({ type: '', status: '422', message: '' })
const freshProblem = computed(() => {
  if (!/^[a-z][a-z0-9_]*$/.test(fresh.type)) return 'Use a name like “slug_taken”: lowercase letters, digits and _'
  if (errors.some(error => error.type === fresh.type)) return `“${fresh.type}” is declared already`
  if (!/^\d+$/.test(fresh.status) || Number(fresh.status) < 400 || Number(fresh.status) > 599) return 'The status is an HTTP error code, from 400 to 599'
  if (fresh.message.trim() === '') return 'Add the message the client gets'
  return ''
})

function pickError(type: string) {
  if (type === NEW) {
    adding.value = true
    return
  }
  adding.value = false
  if (type === NONE) change({ orError: undefined, errorData: undefined })
  else change({ [errorKey.value]: type, errorData: Object.keys(dataFor(type)).length ? dataFor(type) : undefined })
}

function addError() {
  if (freshProblem.value) return
  emit('add-error', { type: fresh.type, status: fresh.status, message: fresh.message, data: [] })
  change({ [errorKey.value]: fresh.type, errorData: undefined })
  Object.assign(fresh, { type: '', status: '422', message: '' })
  adding.value = false
}

function setErrorData(name: string, value: unknown) {
  change({ errorData: { ...errorData.value, [name]: value } })
}

// ── A write ──────────────────────────────────────────────────────────────

const OPS = { create: 'Create', update: 'Update', delete: 'Delete' } as const
const opItems = computed(() => (repo.value?.writes ?? []).map(op => ({ label: OPS[op], value: op })))
/** The key an update or a delete takes, when the action has an input of that name. */
const keyFor = (op: string) => (op === 'update' || op === 'delete') && scope.input.some(entry => entry.path === 'id') ? { id: { $input: 'id' } } : {}
const set = computed(() => record(step.set))
const unset = computed(() => (repo.value?.fields ?? []).filter(field => !(field.name in set.value)).map(field => ({ label: field.name, value: field.name })))
const typeOfField = (name: string) => repo.value?.fields.find(field => field.name === name)?.type

function pickOp(op: string) {
  // An update writes back a row an earlier step loaded: the first of this collection's, when there is one.
  const row = repo.value ? scope.vars.find(entry => entry.row === repo.value!.entity) : undefined
  change({
    op,
    ...op === 'create' ? { id: undefined, from: undefined } : {},
    ...op === 'delete' ? { from: undefined, set: undefined } : {},
    ...step.id === undefined ? keyFor(op) : {},
    ...op === 'update' && step.from === undefined && row ? { from: { $var: row.path } } : {}
  })
}
function setField(name: string, value: unknown) {
  change({ set: { ...set.value, [name]: value } })
}
function addField(name: string) {
  change({ set: { ...set.value, [name]: defaultLiteral(typeOfField(name)) } })
}
function removeField(name: string) {
  const { [name]: _gone, ...rest } = set.value
  change({ set: Object.keys(rest).length ? rest : undefined })
}

// ── A return ─────────────────────────────────────────────────────────────

const WHEN = [{ label: 'Always', value: 'always' }, { label: 'When…', value: 'when' }]
const output = computed(() => ctx.action.output ? entityById(ctx.model, ctx.action.output.entity)?.name : undefined)
const body = computed(() => ctx.action.input.entity ? entityById(ctx.model, ctx.action.input.entity)?.name : undefined)
const returnsNothing = computed(() => isObject(step.value) && step.value.$var === 'undefined')
</script>

<template>
  <div
    class="space-y-3"
    data-step-form
  >
    <p
      v-if="step.kind === 'validate'"
      class="text-[12px] text-toned"
    >
      {{ body ? `Checks the body against the fields of ${body}: a value that is missing or does not fit is refused.` : 'This action takes no body to check.' }}
    </p>

    <template v-else-if="step.kind === 'assert' || step.kind === 'load'">
      <EditorFormRow
        v-if="step.kind === 'load'"
        label="Name"
        help="What later steps call the row"
      >
        <EditorInput
          :model-value="typeof step.as === 'string' ? step.as : ''"
          placeholder="post"
          aria-label="Name of the loaded row"
          mono
          data-step-field="as"
          @update:model-value="change({ as: $event })"
        />
      </EditorFormRow>
      <EditorFormRow label="Collection">
        <EditorSelect
          :model-value="typeof call.repository === 'string' ? call.repository : ''"
          :items="repoItems"
          placeholder="Pick a collection"
          aria-label="Collection to look in"
          data-step-field="repository"
          @update:model-value="pickCollection"
        />
      </EditorFormRow>
      <EditorFormRow
        v-if="repo"
        label="Look up"
        :help="step.kind === 'assert' ? 'The action refuses when it finds a row' : undefined"
      >
        <EditorSelect
          :model-value="typeof call.op === 'string' ? call.op : ''"
          :items="repo.lookups.map(entry => ({ label: entry.label, value: entry.op }))"
          placeholder="Pick how to look it up"
          aria-label="How to look it up"
          data-step-field="op"
          @update:model-value="pickLookup"
        />
      </EditorFormRow>
      <EditorFormRow
        v-if="lookup"
        :label="lookup.arg"
      >
        <DataStepValue
          :value="args[lookup.arg]"
          :scope="scope"
          :type="lookup.type"
          :label="`Value of ${lookup.arg} to look up`"
          :data-step-arg="lookup.arg"
          @update:value="setArg(lookup.arg, $event)"
        />
      </EditorFormRow>
      <EditorFormRow
        :label="step.kind === 'assert' ? 'Refuse with' : 'When there is none'"
        :help="step.kind === 'load' ? 'Refuses with an error, or carries on without the row' : undefined"
      >
        <EditorSelect
          :model-value="adding ? NEW : raised || (step.kind === 'load' ? NONE : '')"
          :items="errorItems"
          :placeholder="step.kind === 'assert' ? 'Pick an error' : 'Carry on'"
          :aria-label="step.kind === 'assert' ? 'Error to refuse with' : 'Error when there is no row'"
          :data-step-field="errorKey"
          @update:model-value="pickError"
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
            v-if="freshProblem && fresh.type"
            class="min-w-0 flex-1 text-[12px] leading-4 text-error"
            data-new-error-problem
          >
            {{ freshProblem }}
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
            :disabled="!!freshProblem"
            data-new-error-add
            @click="addError"
          />
        </div>
      </div>
      <EditorFormRow
        v-for="data in carried"
        :key="data.name"
        :label="data.name"
        help="What the error carries"
      >
        <DataStepValue
          :value="errorData[data.name]"
          :scope="scope"
          :type="data.type"
          :label="`Value of ${data.name} the error carries`"
          :data-step-error-data="data.name"
          @update:value="setErrorData(data.name, $event)"
        />
      </EditorFormRow>
    </template>

    <template v-else-if="step.kind === 'repository'">
      <EditorFormRow label="Collection">
        <EditorSelect
          :model-value="typeof step.repository === 'string' ? step.repository : ''"
          :items="repoItems"
          placeholder="Pick a collection"
          aria-label="Collection to write"
          data-step-field="repository"
          @update:model-value="pickCollection"
        />
      </EditorFormRow>
      <EditorFormRow
        v-if="repo"
        label="Does"
        help="A repository step is the last step: the action returns its result"
      >
        <EditorSelect
          :model-value="typeof step.op === 'string' ? step.op : ''"
          :items="opItems"
          placeholder="Pick what to do"
          aria-label="What to do"
          data-step-field="op"
          @update:model-value="pickOp"
        />
      </EditorFormRow>
      <template v-if="repo && (step.op === 'update' || step.op === 'delete')">
        <EditorFormRow label="Key">
          <DataStepValue
            :value="step.id"
            :scope="scope"
            :type="repo.key"
            label="Key of the row"
            data-step-field="id"
            @update:value="change({ id: $event })"
          />
        </EditorFormRow>
        <EditorFormRow
          v-if="step.op === 'update'"
          label="Row"
          help="The loaded row the changes go over"
        >
          <DataStepValue
            :value="step.from"
            :scope="scope"
            label="Row to write back"
            :allow="['var']"
            rows
            data-step-field="from"
            @update:value="change({ from: $event })"
          />
        </EditorFormRow>
      </template>
      <div
        v-if="repo && step.op !== 'delete' && (step.op === 'create' || step.op === 'update')"
        class="space-y-2"
        data-step-sets
      >
        <div class="flex items-center gap-2">
          <h4 class="flex-1 text-[12px] font-[550] text-highlighted">
            Sets
          </h4>
          <EditorSelect
            v-if="unset.length"
            model-value=""
            :items="unset"
            placeholder="Set a field…"
            aria-label="Set a field"
            class="w-40"
            data-step-set-add
            @update:model-value="addField"
          />
        </div>
        <p
          v-if="!Object.keys(set).length"
          class="text-xs text-dimmed"
        >
          {{ step.op === 'create' ? 'Nothing is set but the checked input.' : 'Nothing is set: the row is written back as it is.' }}
        </p>
        <div
          v-for="(value, name) in set"
          :key="name"
          class="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-2"
          :data-step-set="name"
        >
          <code class="truncate text-[11px] text-toned">{{ name }}</code>
          <DataStepValue
            :value="value"
            :scope="scope"
            :type="typeOfField(name)"
            :label="`Value of ${name}`"
            @update:value="setField(name, $event)"
          />
          <EditorButton
            icon="i-lucide-x"
            variant="ghost"
            size="xs"
            :aria-label="`Do not set ${name}`"
            data-step-set-remove
            @click="removeField(name)"
          />
        </div>
      </div>
    </template>

    <template v-else-if="step.kind === 'return'">
      <EditorFormRow label="Runs">
        <EditorSelect
          :model-value="step.if === true ? 'always' : 'when'"
          :items="WHEN"
          aria-label="When it returns"
          class="w-32 shrink-0"
          data-step-field="if"
          @update:model-value="change({ if: $event === 'always' ? true : undefined })"
        />
        <DataStepValue
          v-if="step.if !== true"
          :value="step.if"
          :scope="scope"
          type="boolean"
          label="Condition"
          :allow="['input', 'var']"
          data-step-field="condition"
          @update:value="change({ if: $event })"
        />
      </EditorFormRow>
      <EditorFormRow
        label="Returns"
        :help="output ? undefined : 'This action has no output'"
      >
        <DataStepValue
          v-if="output"
          :value="step.value"
          :scope="scope"
          :label="`The ${output} to return`"
          :allow="['var']"
          rows
          data-step-field="value"
          @update:value="change({ value: $event })"
        />
        <template v-else>
          <span
            class="flex h-[30px] items-center text-[12px] text-toned"
            data-step-nothing
          >Nothing</span>
          <EditorButton
            v-if="!returnsNothing"
            label="Return nothing"
            size="xs"
            data-step-reset-value
            @click="change({ value: { $var: 'undefined' } })"
          />
        </template>
      </EditorFormRow>
    </template>
  </div>
</template>
