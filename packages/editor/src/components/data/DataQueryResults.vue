<script setup lang="ts">
import { computed, watch } from 'vue'
import type { QueryFile } from '@bildr/codegen/model'
import { draftOf, summaryOf } from '../../editor/queryDraft.ts'
import { paramDefaults, reconcileInputs, runQuery, withInput } from '../../editor/runQuery.ts'
import type { ParamInputs, StoredInputs } from '../../editor/runQuery.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { queryFields } from '../../shared/dataArtifacts.ts'
import { fieldLabel } from '../../shared/dataModel.ts'

/**
 * A query's Results tab (S10, DW-7b): the query run in the editor over the rows the collection's Rows tab shows (the app's
 * list route when it answers, else the Sample data; the same Live / Sample data switch, `DataSourceSwitch`), with its condition,
 * ordering and limit (`editor/runQuery.ts`, which matches the generated `use<Name>`). One line above says what the query does,
 * with a link to its Definition. Each parameter has an input, typed by the parameter's type and prefilled with its default;
 * what was typed is kept in `inputs` (the workspace's, by query) while another tab shows, and reconciled with the query each
 * time it is shown: an input of a parameter that is gone, or whose type changed, is dropped. A query that returns one row shows
 * it as a record, or says there is no match. Read-only: nothing here writes.
 */
const { query } = defineProps<{ query: QueryFile }>()
const inputs = defineModel<Record<string, StoredInputs>>('inputs', { required: true })
const editor = useEditor()

const collection = computed(() => editor.collections.find(entry => entry.id === query.from) ?? null)
const fields = computed(() => collection.value?.fields ?? [])
const rest = computed(() => collection.value?.kind === 'rest')
const summary = computed(() => summaryOf(draftOf(query), queryFields(editor.model, query.from)))

/** What was typed for this query, as the query is now. */
const stored = computed(() => reconcileInputs(inputs.value[query.id], query))
watch(stored, (next) => {
  if (next === inputs.value[query.id]) return
  const { [query.id]: _dropped, ...others } = inputs.value
  inputs.value = next ? { ...others, [query.id]: next } : others
}, { immediate: true })

/** The inputs the query runs with: its parameters' defaults, over which what was typed goes. */
const given = computed<ParamInputs>(() => ({ ...paramDefaults(query), ...stored.value?.values }))
const found = computed(() => runQuery(query, editor.collectionRows, given.value))
const rows = computed(() => found.value.rows)
const record = computed(() => query.result === 'one' ? found.value.value as Record<string, unknown> | null : null)

const NUMERIC_INPUTS: Record<string, string> = { integer: 'numeric', number: 'decimal' }

function setInput(param: QueryFile['params'][number], value: string | boolean) {
  inputs.value = { ...inputs.value, [query.id]: withInput(stored.value, param, value) }
}

const count = computed(() => {
  const { total } = found.value
  return `${rows.value.length}${total > rows.value.length ? ` of ${total}` : ''} ${rows.value.length === 1 && total === 1 ? 'result' : 'results'}`
})

/** What no results says: why there are none, for the rows the query read. */
const emptyText = computed(() => {
  if (Object.keys(found.value.problems).length) return 'No results: fix the parameters above.'
  if (!editor.collectionRows.length) return editor.recordsLoading ? 'Reading the app\'s rows…' : 'No results. The collection has no rows to read yet.'
  return 'No results. No row meets the condition.'
})
</script>

<template>
  <section
    class="flex size-full flex-col text-[12px]"
    data-query-results
  >
    <header class="flex h-12 shrink-0 items-center gap-1 border-b border-white/5 px-4">
      <span
        v-if="query.result === 'many'"
        class="text-xs text-dimmed tabular-nums"
        data-results-count
      >{{ count }}</span>
      <span
        v-else
        class="text-xs text-dimmed"
        data-results-count
      >One row</span>
      <div class="ms-auto flex shrink-0 items-center gap-2">
        <DataSourceSwitch :switchable="!rest" />
      </div>
    </header>

    <p
      class="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-2 text-xs text-muted"
      data-query-summary
    >
      <span
        class="min-w-0 truncate"
        data-query-summary-text
      >{{ summary }}</span>
      <button
        type="button"
        class="shrink-0 text-muted underline underline-offset-2 hover:text-highlighted"
        data-edit-definition
        @click="editor.dataTab = 'definition'"
      >
        Edit definition
      </button>
    </p>

    <div
      v-if="query.params.length"
      class="flex shrink-0 flex-wrap items-start gap-x-4 gap-y-2 border-b border-white/5 px-4 py-3"
      data-query-params
    >
      <div
        v-for="param in query.params"
        :key="param.name"
        class="flex w-44 flex-col gap-1"
        :data-query-param-row="param.name"
      >
        <label
          class="text-xs text-muted"
          :for="`query-param-${param.name}`"
        >{{ fieldLabel(param.name) }}</label>
        <EditorSwitch
          v-if="param.type === 'boolean'"
          :id="`query-param-${param.name}`"
          :model-value="given[param.name] === true"
          :aria-label="fieldLabel(param.name)"
          :data-query-param="param.name"
          @update:model-value="setInput(param, $event)"
        />
        <EditorInput
          v-else
          :id="`query-param-${param.name}`"
          :model-value="String(given[param.name] ?? '')"
          :inputmode="NUMERIC_INPUTS[param.type]"
          :placeholder="param.default === undefined ? 'No default' : undefined"
          :invalid="!!found.problems[param.name]"
          :aria-label="fieldLabel(param.name)"
          :data-query-param="param.name"
          @update:model-value="setInput(param, $event)"
        />
        <p
          v-if="found.problems[param.name]"
          class="text-xs text-error"
          role="alert"
        >
          {{ found.problems[param.name] }}
        </p>
      </div>
    </div>

    <DataRowsFailure
      v-if="collection"
      :collection="collection"
    />

    <template v-if="query.result === 'one'">
      <div
        v-if="record"
        class="min-h-0 flex-1 overflow-y-auto"
        data-query-record
      >
        <div class="w-full max-w-xl py-2">
          <EditorRow
            v-for="field in fields"
            :key="field.id"
            :label="field.label"
            :title="`${field.label} (${field.name})`"
            :name="field.name"
            :data-record-field="field.name"
          >
            <DataPanelValue
              :field="field"
              :model-value="record[field.name] ?? null"
            />
          </EditorRow>
        </div>
      </div>
      <p
        v-else
        class="px-4 py-6 text-xs text-dimmed"
        data-query-no-match
      >
        {{ Object.keys(found.problems).length ? 'No match: fix the parameters above.' : 'No match' }}
      </p>
    </template>
    <DataRowsTable
      v-else
      :fields="fields"
      :rows="rows"
      :loaded="editor.collectionRows"
      :sortable="false"
      :openable="false"
    >
      <p
        v-if="!rows.length"
        class="px-4 py-6 text-xs text-dimmed"
        data-records-empty
      >
        {{ emptyText }}
      </p>
    </DataRowsTable>
  </section>
</template>
