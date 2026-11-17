<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditor } from '../../editor/useEditor.ts'
import { addSampleRow, deleteSampleRows, saveSampleValue } from '../../editor/sampleRows.ts'
import type { DataCollection, DataField } from '../../shared/dataModel.ts'
import { nextSort, recordsCount, rowId, tableRows } from '../../shared/dataTable.ts'
import type { TableFilter, TableSort } from '../../shared/dataTable.ts'
import type { CellValue } from '../../editor/sampleRows.ts'
import type { Row } from '@bildr/codegen/query'

/**
 * The shown collection's rows as a Framer CMS table: search, filters and sortable headers over
 * the loaded rows, and a row opens in the right panel. What shows is what the app's list route answers
 * (Live), else the entity's sample data (the fixtures); the Live / Sample data switch (`DataSourceSwitch`) shows the
 * choice and chooses, and says when Live is chosen but the app does not answer, which `DataRowsFailure` explains. A collection read
 * through a connection is always Live. `collection` is the one the workspace shows.
 *
 * Live rows are the app's data, reached through the generated API: read-only (E2), with a hint to switch. Sample data is
 * edited here (D4, S4): cells in place (`DataRowsTable`), Add row, a delete per row, and the rows checked deleted together
 * after a confirmation. Each save is one module action (`editor/sampleRows.ts`) that validates against the collection's
 * fields and writes `.bildr/`; a refusal shows where the user is working, on the cell or under the bar.
 */
const { collection } = defineProps<{ collection: DataCollection }>()
const editor = useEditor()
const fields = computed(() => collection.fields)
const rest = computed(() => collection.kind === 'rest')
const editable = computed(() => editor.rowsEditable)

const query = ref('')
const sort = ref<TableSort | null>(null)
const filters = ref<TableFilter[]>([])
const narrowed = computed(() => query.value.trim() !== '' || filters.value.length > 0)
const rows = computed(() => tableRows(editor.collectionRows, fields.value, { query: query.value, filters: filters.value, sort: sort.value }))
const count = computed(() => recordsCount({ shown: rows.value.length, total: editor.recordsTotal, narrowed: narrowed.value }))

/** The rows whose checkbox is on, by id: only the ones the collection still has and the table still shows. */
const checked = ref<string[]>([])
const shownIds = computed(() => rows.value.map(row => rowId(row, editor.collectionRows.indexOf(row))))
const selected = computed(() => checked.value.filter(id => shownIds.value.includes(id)))
/** What the last add or delete said when the module refused it. */
const problem = ref('')
const busy = ref(false)

watch(() => collection.id, () => {
  query.value = ''
  sort.value = null
  filters.value = []
})
// Another collection, another source, or no editing: nothing stays selected, and no old refusal stays shown.
watch([() => collection.id, editable], () => {
  checked.value = []
  problem.value = ''
})

const toggle = (id: string) => {
  editor.recordId = editor.recordId === id ? null : id
}

const save = (row: string, field: DataField, value: CellValue, base: Row) => saveSampleValue(editor, collection.id, row, field.name, value, base)

/** The rows with these ids as the table shows them now, by id: what a delete sends as `base`. */
const shownRows = (ids: string[]) => Object.fromEntries(editor.collectionRows.flatMap((row, index) => ids.includes(rowId(row, index)) ? [[rowId(row, index), { ...row }]] : []))

function select(id: string, on: boolean) {
  checked.value = on ? [...new Set([...checked.value, id])] : checked.value.filter(entry => entry !== id)
}

async function run(job: () => Promise<string | undefined>) {
  problem.value = ''
  busy.value = true
  problem.value = await job() ?? ''
  busy.value = false
}

const addRow = () => run(() => addSampleRow(editor, collection.id))

const remove = (id: string) => run(async () => {
  const refused = await deleteSampleRows(editor, collection.id, [id], shownRows([id]))
  if (!refused) checked.value = checked.value.filter(entry => entry !== id)
  return refused
})

async function removeSelected() {
  const ids = selected.value
  const one = ids.length === 1
  // The rows as they are shown when the user chooses, not as they are after the confirmation.
  const base = shownRows(ids)
  if (!ids.length || !await editor.confirm({
    title: `Delete ${one ? '1 row' : `${ids.length} rows`}?`,
    description: `${one ? 'The row leaves' : `The ${ids.length} rows leave`} the sample data of ${collection.name}. Undo brings ${one ? 'it' : 'them'} back. The app's own rows are not touched.`,
    confirmLabel: one ? 'Delete row' : 'Delete rows',
    danger: true
  })) return
  await run(async () => {
    const refused = await deleteSampleRows(editor, collection.id, ids, base)
    if (!refused) checked.value = []
    return refused
  })
}

/** What an empty table says, for the rows it shows: the API's, the collection's own sample data (which Live falls back to when the app does not answer), or the app's. */
const emptyText = computed(() => {
  if (rest.value) return 'The API returned no items.'
  if (editor.rowsPreference === 'live' && editor.rowsSource === 'sample' && editor.recordsLoading) return 'Reading the app\'s rows…'
  if (editor.rowsSource === 'live') return 'No items yet. Rows are your app\'s data: they are added through the app, or seeded as sample data.'
  return editor.rowsFallback ? 'No items to show: the app is not answering and this collection has no sample data.' : 'No sample data yet for this collection.'
})
</script>

<template>
  <section
    class="flex size-full flex-col text-[12px]"
    data-records
  >
    <DataTableToolbar
      v-model:query="query"
      v-model:sort="sort"
      v-model:filters="filters"
      :fields="fields"
      :count="count"
      :switchable="!rest"
      @refresh="editor.reloadRecords()"
    />

    <DataRowsFailure :collection="collection" />

    <div
      v-if="!rest"
      class="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-white/5 px-3 py-1.5"
      data-rows-bar
    >
      <template v-if="editable">
        <EditorButton
          icon="i-lucide-plus"
          label="Add row"
          size="xs"
          :disabled="!fields.length || busy"
          data-add-row
          @click="addRow"
        />
        <EditorButton
          v-if="selected.length"
          icon="i-lucide-trash-2"
          :label="selected.length === 1 ? 'Delete 1 row' : `Delete ${selected.length} rows`"
          variant="danger"
          size="xs"
          :disabled="busy"
          data-delete-selected
          @click="removeSelected"
        />
        <p
          v-if="problem"
          class="text-xs text-error"
          role="alert"
          data-rows-error
        >
          {{ problem }}
        </p>
      </template>
      <p
        v-else
        class="text-xs text-muted"
        data-live-hint
      >
        Live rows come from your app. Switch to Sample data to edit.
      </p>
    </div>

    <DataRowsTable
      :fields="fields"
      :rows="rows"
      :loaded="editor.collectionRows"
      :sort="sort"
      :open-id="editor.recordId"
      :editable="editable"
      :selected="selected"
      :save="save"
      @sort="sort = nextSort(sort, $event)"
      @toggle="toggle"
      @open="editor.recordId = $event"
      @select="select"
      @select-all="checked = $event ? shownIds : []"
      @remove="remove"
    >
      <p
        v-if="!fields.length"
        class="px-4 py-6 text-xs text-dimmed"
      >
        Add a field in the Fields tab to start.
      </p>
      <p
        v-else-if="!rows.length && query.trim()"
        class="px-4 py-6 text-xs text-dimmed"
      >
        No items match “{{ query.trim() }}”.
      </p>
      <p
        v-else-if="!rows.length && filters.length"
        class="px-4 py-6 text-xs text-dimmed"
      >
        No items match the filters.
      </p>
      <p
        v-else-if="!rows.length"
        class="px-4 py-6 text-xs text-dimmed"
        data-records-empty
      >
        {{ emptyText }}
      </p>
    </DataRowsTable>
  </section>
</template>
