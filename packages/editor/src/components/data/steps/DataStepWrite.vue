<script setup lang="ts">
import { computed } from 'vue'
import { defaultLiteral, patched, record } from '../../../editor/stepExpr.ts'
import type { Step } from '../../../editor/stepExpr.ts'
import type { StepsContext } from '../../../editor/stepDraft.ts'
import type { StepScope } from '../../../editor/stepScope.ts'

/**
 * A Write step (`repository`, S10, D10c): creates, updates or deletes a row of a collection. The key and the row an update writes
 * back, and the fields a create or an update sets, each a value (`DataStepValue`) or left out. A write is the last step: the
 * action returns its result.
 */
const { step, scope, ctx } = defineProps<{
  step: Step
  scope: StepScope
  ctx: StepsContext
}>()
const emit = defineEmits<{ 'update:step': [step: Step] }>()

const OPS = { create: 'Create', update: 'Update', delete: 'Delete' } as const
const repo = computed(() => ctx.repos.find(entry => entry.id === step.repository))
const repoItems = computed(() => ctx.repos.map(entry => ({ label: entry.name, value: entry.id })))
const opItems = computed(() => (repo.value?.writes ?? []).map(op => ({ label: OPS[op], value: op })))
/** The key an update or a delete takes, when the action has an input of that name. */
const keyFor = (op: string) => (op === 'update' || op === 'delete') && scope.input.some(entry => entry.path === 'id') ? { id: { $input: 'id' } } : {}
const set = computed(() => record(step.set))
const unset = computed(() => (repo.value?.fields ?? []).filter(field => !(field.name in set.value)).map(field => ({ label: field.name, onSelect: () => addField(field.name) })))
const typeOfField = (name: string) => repo.value?.fields.find(field => field.name === name)?.type
const change = (patch: Record<string, unknown>) => emit('update:step', patched(step, patch))

function pickCollection(id: string) {
  const op = ctx.repos.find(entry => entry.id === id)?.writes[0] ?? ''
  change({ repository: id, op, id: undefined, from: undefined, set: undefined, ...keyFor(op) })
}
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
</script>

<template>
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
    label="Write"
    help="A write is the last step: the action returns its result"
  >
    <EditorSelect
      :model-value="typeof step.op === 'string' ? step.op : ''"
      :items="opItems"
      placeholder="Pick what to do"
      aria-label="What to write"
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
    v-if="repo && (step.op === 'create' || step.op === 'update')"
    class="space-y-2"
    data-step-sets
  >
    <h4 class="text-[12px] font-[550] text-highlighted">
      Sets
    </h4>
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
    <EditorMenu
      v-if="unset.length"
      :items="unset"
    >
      <EditorButton
        icon="i-lucide-plus"
        variant="ghost"
        size="xs"
        label="Add a field"
        data-step-set-add
      />
    </EditorMenu>
  </div>
</template>
