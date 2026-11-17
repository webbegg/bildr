<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { QueryFile } from '@bildr/codegen/model'
import { attempt, queryFields } from '../../editor/dataArtifacts.ts'
import { OPS, changesOf, draftOf, renameParam } from '../../editor/queryDraft.ts'
import type { Op, QueryDraft } from '../../editor/queryDraft.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { fieldTypeItems } from '../../shared/dataModel.ts'
import type { FieldType } from '../../shared/dataModel.ts'

/**
 * A query's Definition tab (S10): a form over `query_update` with `inPlace: true` (it edits the query itself, never a copy). The
 * label, the description, One or Many, the parameters (name, type, default), the condition (a field, an operator and a value
 * or a parameter), the sort (fields with a direction) and the limit (a number or a parameter). Edits are a draft: Save sends
 * what changed (`editor/queryDraft.ts`), and what the module refuses is shown under the form with the draft kept. A save
 * refreshes the model, so Results (and the tree) show the change. The module allows one condition, so there is one.
 */
const { query } = defineProps<{ query: QueryFile }>()
const editor = useEditor()

const fields = computed(() => queryFields(editor.model, query.from))
const fieldItems = computed(() => fields.value.map(field => ({ label: field.name, value: field.name })))
const typeOf = (name: string) => fields.value.find(field => field.name === name)?.type

const draft = ref<QueryDraft>(draftOf(query))
const error = ref('')
const saving = ref(false)

const changes = computed(() => changesOf(draft.value, query, fields.value))
const dirty = computed(() => Object.keys(changes.value.input).length > 0 || changes.value.problems.length > 0)

// Another query, or the model changed under a form with nothing typed in it: the form shows it. Edits that are not saved stay.
watch(() => query.id, () => {
  draft.value = draftOf(query)
  error.value = ''
})
watch(() => JSON.stringify(draftOf(query)), (next, previous) => {
  if (JSON.stringify(draft.value) === previous) draft.value = JSON.parse(next) as QueryDraft
})
watch(draft, () => {
  error.value = ''
}, { deep: true })

async function save() {
  if (changes.value.problems.length) {
    error.value = changes.value.problems.join('. ')
    return
  }
  saving.value = true
  const done = await attempt(editor, 'query_update', { query: query.id, inPlace: true, ...changes.value.input }, 'Could not save the query')
  saving.value = false
  if ('error' in done) {
    error.value = done.error
    return
  }
  // The model is refreshed: the form shows the query as it is now.
  draft.value = draftOf(query)
}

const RESULTS = [{ value: 'one', label: 'One' }, { value: 'many', label: 'Many' }]
const opItems = OPS.map(op => ({ label: op.label, value: op.value }))
const DIRECTIONS = [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]
const YES_NO = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
const NUMERIC = ['integer', 'number']

const paramItems = computed(() => draft.value.params.filter(param => param.name).map(param => ({ label: param.name, value: param.name })))
const numericParams = computed(() => draft.value.params.filter(param => param.name && NUMERIC.includes(param.type)).map(param => ({ label: param.name, value: param.name })))
const whereKinds = computed(() => [{ value: 'value', label: 'Value' }, { value: 'param', label: 'Parameter', disabled: !paramItems.value.length }])
const limitKinds = computed(() => [
  { value: 'none', label: 'No limit' },
  { value: 'number', label: 'Number' },
  { value: 'param', label: 'Parameter', disabled: !numericParams.value.length && draft.value.limit.kind !== 'param' }
])
const booleanValue = computed(() => draft.value.where !== null && typeOf(draft.value.where.field) === 'boolean' && draft.value.where.op !== 'in' && draft.value.where.op !== 'like')

function addParam() {
  draft.value.params.push({ name: '', type: 'text', default: '' })
}

function removeParam(index: number) {
  draft.value.params.splice(index, 1)
}

function addWhere() {
  const first = fields.value.find(field => field.name !== 'id') ?? fields.value[0]
  draft.value.where = { field: first?.name ?? '', op: 'eq', kind: 'value', value: first?.type === 'boolean' ? 'true' : '', param: '' }
}

function setWhereField(name: string) {
  const where = draft.value.where
  if (!where) return
  where.field = name
  where.value = typeOf(name) === 'boolean' ? 'true' : ''
}

function setWhereKind(kind: string) {
  const where = draft.value.where
  if (!where) return
  where.kind = kind as 'value' | 'param'
  if (kind === 'param' && !where.param) where.param = paramItems.value[0]?.value ?? ''
}

function addSort() {
  const used = new Set(draft.value.orderBy.map(order => order.field))
  draft.value.orderBy.push({ field: (fields.value.find(field => !used.has(field.name)) ?? fields.value[0])?.name ?? '', direction: 'asc' })
}

function setLimitKind(kind: string) {
  const limit = draft.value.limit
  limit.kind = kind as 'none' | 'number' | 'param'
  if (kind === 'param' && !limit.param) limit.param = numericParams.value[0]?.value ?? ''
}
</script>

<template>
  <div
    class="size-full overflow-y-auto"
    data-query-definition
  >
    <div class="w-full max-w-2xl space-y-6 px-0.5 py-4">
      <section class="space-y-3">
        <EditorFormRow label="Label">
          <EditorInput
            v-model="draft.label"
            data-def="label"
            aria-label="Query label"
          />
        </EditorFormRow>
        <EditorFormRow
          label="Description"
          help="What the query returns, in words"
        >
          <EditorTextarea
            v-model="draft.description"
            :rows="2"
            data-def="description"
            aria-label="Query description"
          />
        </EditorFormRow>
        <EditorFormRow
          label="Returns"
          help="Many rows, or the one row the condition picks"
        >
          <EditorSegmented
            :model-value="draft.result"
            :items="RESULTS"
            data-def="result"
            @update:model-value="draft.result = $event as 'one' | 'many'"
          />
        </EditorFormRow>
      </section>

      <section
        class="space-y-2"
        data-def-params
      >
        <div class="flex items-center">
          <h3 class="flex-1 text-[12px] font-[550] text-highlighted">
            Parameters
          </h3>
          <EditorButton
            icon="i-lucide-plus"
            variant="ghost"
            size="xs"
            aria-label="Add parameter"
            data-def-param-add
            @click="addParam"
          />
        </div>
        <p
          v-if="!draft.params.length"
          class="text-xs text-dimmed"
        >
          No parameters. A parameter is a value a page gives the query, like a limit or a slug.
        </p>
        <div
          v-for="(param, index) in draft.params"
          :key="index"
          class="grid grid-cols-[minmax(0,1fr)_132px_minmax(0,1fr)_auto] items-center gap-2"
          :data-def-param-row="index"
        >
          <EditorInput
            :model-value="param.name"
            placeholder="name"
            aria-label="Parameter name"
            data-def-param-name
            @update:model-value="draft = renameParam(draft, index, $event)"
          />
          <EditorSelect
            :model-value="param.type"
            :items="fieldTypeItems"
            aria-label="Parameter type"
            data-def-param-type
            @update:model-value="param.type = $event as FieldType"
          />
          <EditorSelect
            v-if="param.type === 'boolean'"
            :model-value="param.default || 'none'"
            :items="[{ value: 'none', label: 'No default' }, ...YES_NO]"
            aria-label="Parameter default"
            data-def-param-default
            @update:model-value="param.default = $event === 'none' ? '' : $event"
          />
          <EditorInput
            v-else
            v-model="param.default"
            placeholder="No default"
            aria-label="Parameter default"
            data-def-param-default
          />
          <EditorButton
            icon="i-lucide-x"
            variant="ghost"
            size="xs"
            :aria-label="`Remove parameter ${param.name}`"
            data-def-param-remove
            @click="removeParam(index)"
          />
        </div>
      </section>

      <section class="space-y-2">
        <div class="flex items-center">
          <h3 class="flex-1 text-[12px] font-[550] text-highlighted">
            Condition
          </h3>
          <EditorButton
            v-if="!draft.where"
            icon="i-lucide-plus"
            variant="ghost"
            size="xs"
            aria-label="Add condition"
            data-def-where-add
            @click="addWhere"
          />
        </div>
        <p
          v-if="!draft.where"
          class="text-xs text-dimmed"
        >
          No condition: every row is returned.
        </p>
        <div
          v-else
          class="grid grid-cols-[minmax(0,1fr)_140px_104px_minmax(0,1fr)_auto] items-center gap-2"
          data-def-where
        >
          <EditorSelect
            :model-value="draft.where.field"
            :items="fieldItems"
            aria-label="Condition field"
            data-def-where-field
            @update:model-value="setWhereField"
          />
          <EditorSelect
            :model-value="draft.where.op"
            :items="opItems"
            aria-label="Condition operator"
            data-def-where-op
            @update:model-value="draft.where.op = $event as Op"
          />
          <EditorSelect
            v-if="draft.where.kind !== 'expression'"
            :model-value="draft.where.kind"
            :items="whereKinds"
            aria-label="Condition value from"
            data-def-where-kind
            @update:model-value="setWhereKind"
          />
          <code
            v-if="draft.where.kind === 'expression'"
            class="col-span-2 truncate rounded-lg bg-elevated px-2 py-1.5 text-[11px] text-muted"
            data-def-where-expression
          >{{ JSON.stringify(draft.where.expression) }}</code>
          <EditorSelect
            v-else-if="draft.where.kind === 'param'"
            :model-value="draft.where.param"
            :items="paramItems"
            placeholder="Parameter"
            aria-label="Condition parameter"
            data-def-where-param
            @update:model-value="draft.where.param = $event"
          />
          <EditorSelect
            v-else-if="booleanValue"
            :model-value="draft.where.value"
            :items="YES_NO"
            aria-label="Condition value"
            data-def-where-value
            @update:model-value="draft.where.value = $event"
          />
          <EditorInput
            v-else
            v-model="draft.where.value"
            :placeholder="draft.where.op === 'in' ? 'a, b, c' : draft.where.op === 'like' ? 'a%' : 'value'"
            aria-label="Condition value"
            data-def-where-value
          />
          <EditorButton
            icon="i-lucide-x"
            variant="ghost"
            size="xs"
            aria-label="Remove condition"
            data-def-where-remove
            @click="draft.where = null"
          />
        </div>
      </section>

      <section class="space-y-2">
        <div class="flex items-center">
          <h3 class="flex-1 text-[12px] font-[550] text-highlighted">
            Sort
          </h3>
          <EditorButton
            icon="i-lucide-plus"
            variant="ghost"
            size="xs"
            aria-label="Add sort"
            data-def-sort-add
            @click="addSort"
          />
        </div>
        <p
          v-if="!draft.orderBy.length"
          class="text-xs text-dimmed"
        >
          No sort: rows come back in the order the collection keeps them.
        </p>
        <div
          v-for="(order, index) in draft.orderBy"
          :key="index"
          class="grid grid-cols-[minmax(0,1fr)_140px_auto] items-center gap-2"
          :data-def-sort="index"
        >
          <EditorSelect
            :model-value="order.field"
            :items="fieldItems"
            aria-label="Sort field"
            data-def-sort-field
            @update:model-value="order.field = $event"
          />
          <EditorSelect
            :model-value="order.direction"
            :items="DIRECTIONS"
            aria-label="Sort direction"
            data-def-sort-direction
            @update:model-value="order.direction = $event as 'asc' | 'desc'"
          />
          <EditorButton
            icon="i-lucide-x"
            variant="ghost"
            size="xs"
            aria-label="Remove sort"
            data-def-sort-remove
            @click="draft.orderBy.splice(index, 1)"
          />
        </div>
      </section>

      <section class="space-y-2">
        <h3 class="text-[12px] font-[550] text-highlighted">
          Limit
        </h3>
        <div class="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-2">
          <EditorSelect
            :model-value="draft.limit.kind"
            :items="limitKinds"
            aria-label="Limit"
            data-def-limit-kind
            @update:model-value="setLimitKind"
          />
          <EditorInput
            v-if="draft.limit.kind === 'number'"
            v-model="draft.limit.number"
            inputmode="numeric"
            placeholder="Rows"
            aria-label="Limit rows"
            data-def-limit-number
          />
          <EditorSelect
            v-else-if="draft.limit.kind === 'param'"
            :model-value="draft.limit.param"
            :items="numericParams"
            placeholder="Parameter"
            aria-label="Limit parameter"
            data-def-limit-param
            @update:model-value="draft.limit.param = $event"
          />
          <code
            v-else-if="draft.limit.kind === 'expression'"
            class="truncate rounded-lg bg-elevated px-2 py-1.5 text-[11px] text-muted"
          >{{ JSON.stringify(draft.limit.expression) }}</code>
        </div>
      </section>

      <div class="flex items-start gap-3 border-t border-white/6 pt-4">
        <p
          v-if="error"
          class="min-w-0 flex-1 rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
          role="alert"
          data-def-error
        >
          {{ error }}
        </p>
        <span
          v-else
          class="flex-1"
        />
        <EditorButton
          variant="primary"
          label="Save"
          :loading="saving"
          :disabled="!dirty"
          data-def-save
          @click="save"
        />
      </div>
    </div>
  </div>
</template>
