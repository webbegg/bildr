<script setup lang="ts">
import { computed } from 'vue'
import type { QueryFile } from '@bildr/codegen/model'
import { paramDefaults, runQuery } from '../../editor/runQuery.ts'
import type { ParamInputs } from '../../editor/runQuery.ts'
import type { RowsSource } from '../../editor/dataView.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { fieldLabel } from '../../shared/dataModel.ts'
import { rowsFailure } from '../../shared/dataTable.ts'

/**
 * A query's Results tab (S10, DW-7b): the query run in the editor over the rows the collection's Rows tab shows (the app's
 * list route when it answers, else the Sample data; the same Live / Sample data switch), with its condition, ordering and
 * limit (`editor/runQuery.ts`, which matches the generated `use<Name>`). Each parameter has an input above the results,
 * typed by the parameter's type and prefilled with its default; what was typed is kept in `inputs` (the workspace's, by
 * query) while another tab shows. A query that returns one row shows it as a record, or says there is no match. Read-only: nothing here writes.
 */
const { query } = defineProps<{ query: QueryFile }>()
const inputs = defineModel<Record<string, ParamInputs>>('inputs', { required: true })
const editor = useEditor()

const collection = computed(() => editor.collections.find(entry => entry.id === query.from) ?? null)
const fields = computed(() => collection.value?.fields ?? [])
const rest = computed(() => collection.value?.kind === 'rest')
/** The inputs the query runs with: its parameters' defaults, over which what was typed goes. */
const given = computed<ParamInputs>(() => ({ ...paramDefaults(query), ...inputs.value[query.id] }))
const found = computed(() => runQuery(query, editor.collectionRows, given.value))
const rows = computed(() => found.value.rows)
const record = computed(() => query.result === 'one' ? found.value.value as Record<string, unknown> | null : null)
const failure = computed(() => collection.value && editor.recordsError ? rowsFailure(collection.value.plural, editor.recordsError) : '')

const NUMERIC_INPUTS: Record<string, string> = { integer: 'numeric', number: 'decimal' }

function type(name: string, value: string | boolean) {
  inputs.value = { ...inputs.value, [query.id]: { ...inputs.value[query.id], [name]: value } }
}

/** The switch: Live reads the app's rows again (also when Live is chosen already: a retry), Sample data shows the collection's own. */
function chooseSource(source: RowsSource) {
  editor.rowsPreference = source
  if (source === 'live') void editor.reloadRecords()
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
        <DataSourceSwitch
          :source="editor.rowsPreference"
          :shown="editor.rowsSource"
          :fallback="editor.rowsFallback"
          :switchable="!rest"
          @source="chooseSource"
        />
        <UTooltip text="Refresh">
          <EditorButton
            icon="i-lucide-refresh-cw"
            variant="ghost"
            size="xs"
            aria-label="Refresh"
            :loading="editor.recordsLoading"
            data-records-refresh
            @click="editor.reloadRecords()"
          />
        </UTooltip>
      </div>
    </header>

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
          @update:model-value="type(param.name, $event)"
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
          @update:model-value="type(param.name, $event)"
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

    <p
      v-if="failure"
      class="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-2 text-xs"
      :class="rest ? 'bg-error/10 text-error' : 'bg-white/4 text-muted'"
      data-records-error
    >
      <UIcon
        :name="rest ? 'i-lucide-circle-alert' : 'i-lucide-info'"
        class="size-4 shrink-0"
      />
      <span>{{ rest ? failure : `Showing the sample data. ${failure} Start the app (nuxt dev) and refresh.` }}</span>
    </p>

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
