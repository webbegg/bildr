<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditor } from '../../editor/useEditor.ts'
import type { DataCollection } from '../../shared/dataModel.ts'
import { nextSort, recordsCount, tableRows } from '../../shared/dataTable.ts'
import type { TableFilter, TableSort } from '../../shared/dataTable.ts'

/**
 * The shown collection's rows as a Framer CMS table: search, filters and sortable headers over
 * the loaded rows, and a row opens in the right panel. Read-only: the rows are app data reached
 * through the generated API (E2), so the hosted inline cell editing, quick-add row and bulk
 * delete are not ported, and none of it writes. What shows is what the app's list route answers
 * (Live), else the entity's sample data (the fixtures); the Live / Sample data switch (`DataSourceSwitch`) shows the
 * choice and chooses, and says when Live is chosen but the app does not answer, which `DataRowsFailure` explains. A collection read
 * through a connection is always Live. `collection` is the one the workspace shows.
 */
const { collection } = defineProps<{ collection: DataCollection }>()
const editor = useEditor()
const fields = computed(() => collection.fields)
const rest = computed(() => collection.kind === 'rest')

const query = ref('')
const sort = ref<TableSort | null>(null)
const filters = ref<TableFilter[]>([])
const narrowed = computed(() => query.value.trim() !== '' || filters.value.length > 0)
const rows = computed(() => tableRows(editor.collectionRows, fields.value, { query: query.value, filters: filters.value, sort: sort.value }))
const count = computed(() => recordsCount({ shown: rows.value.length, total: editor.recordsTotal, narrowed: narrowed.value }))

watch(() => collection.id, () => {
  query.value = ''
  sort.value = null
  filters.value = []
})

const toggle = (id: string) => {
  editor.recordId = editor.recordId === id ? null : id
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

    <DataRowsTable
      :fields="fields"
      :rows="rows"
      :loaded="editor.collectionRows"
      :sort="sort"
      :open-id="editor.recordId"
      @sort="sort = nextSort(sort, $event)"
      @toggle="toggle"
      @open="editor.recordId = $event"
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
