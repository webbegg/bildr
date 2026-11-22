<script setup lang="ts">
import { computed } from 'vue'
import type { QueryFile } from '@bildr/codegen/model'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { RESULTS, queryFields } from '../../shared/dataArtifacts.ts'
import type { QueryResultKind } from '../../shared/dataArtifacts.ts'
import { sameJson } from '../../editor/draftJson.ts'
import { OPS, changedOutside, changesOf, conditionText, draftOf, rebaseDraft, renameParam } from '../../editor/queryDraft.ts'
import type { Op, QueryDraft } from '../../editor/queryDraft.ts'
import { useDraftForm } from '../../editor/useDraftForm.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { basicTypeItems } from '../../shared/dataModel.ts'
import type { FieldType } from '../../shared/dataModel.ts'

/**
 * A query's Definition tab (S10): a form over `query_update` with `inPlace: true` (it edits the query itself, never a copy). The
 * label, the description, One or Many, the parameters (name, type, default), the condition (a field, an operator and a value
 * or a parameter), the sort (fields with a direction) and the limit (a number or a parameter). Edits are a draft: Save sends
 * what changed (`editor/queryDraft.ts`), and what the module refuses is shown under the form with the draft kept. A save
 * refreshes the model, so Results (and the tree) show the change. The module allows one condition, so there is one.
 *
 * The draft, its base and the notice for a query that changed under it are the shared draft form (`useDraftForm`,
 * `DataStaleNotice`, `DataDraftFooter`): what the user touched is judged against the query as it was when the draft was opened or
 * last saved, and Save waits for the choice between loading the new version and keeping the edits.
 */
const { query } = defineProps<{ query: QueryFile }>()
const editor = useEditor()

const fields = computed(() => queryFields(editor.model, query.from))
const fieldItems = computed(() => fields.value.map(field => ({ label: field.name, value: field.name })))
const typeOf = (name: string) => fields.value.find(field => field.name === name)?.type

const changesAgainst = (draft: QueryDraft, base: QueryFile) => changesOf(draft, base, fields.value)
const { draft, base, error, saving, dirty, stale, discard, keepMine } = useDraftForm<QueryFile, QueryDraft>({
  stored: () => query,
  id: () => query.id,
  label: () => query.label || query.name,
  open: draftOf,
  dirty: (current, base) => {
    const changed = changesAgainst(current, base)
    return Object.keys(changed.input).length > 0 || changed.problems.length > 0
  },
  changedOutside,
  rebase: rebaseDraft,
  untouched: (current, base) => sameJson(current, draftOf(base))
})
const changes = computed(() => changesAgainst(draft.value, base.value))

async function save() {
  if (stale.value) return
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
  // The model is refreshed: the form shows the query as it is now, and that is what the next edits start from.
  discard()
}

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
  <!-- The footer is at the bottom of the area when the form is short, and sticks to it when the form scrolls. -->
  <div
    class="flex size-full flex-col overflow-y-auto"
    data-query-definition
  >
    <div class="w-full max-w-2xl flex-1 space-y-6 px-0.5 py-4">
      <DataStaleNotice
        v-if="stale"
        prefix="def"
        title="This query changed since you started editing"
        description="Your edits are still here. Load the new version to drop them, or keep them: only the parts you changed replace the new version when you save."
        @load-new="discard"
        @keep-mine="keepMine"
      />
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
          help="Kept in the query's file"
        >
          <EditorTextarea
            v-model="draft.description"
            :rows="2"
            placeholder="What the query returns, in words"
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
            @update:model-value="draft.result = $event as QueryResultKind"
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
            :items="basicTypeItems"
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
        <p
          v-if="draft.where"
          class="text-xs text-dimmed"
          data-def-where-preview
        >
          {{ draft.result === 'one' ? 'The row' : 'Rows' }} where {{ conditionText(draft.where) }}
        </p>
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
    </div>

    <DataDraftFooter
      prefix="def"
      :error="error"
      :dirty="dirty"
      :saving="saving"
      :disabled="!dirty || stale"
      @discard="discard"
      @save="save"
    />
  </div>
</template>
