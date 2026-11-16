<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RowsSource } from '../../editor/dataView.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { fieldLabel } from '../../shared/dataModel.ts'
import type { DataCollection, FieldType } from '../../shared/dataModel.ts'
import { nextSort, recordsCount, rowId, rowsFailure, tableRows } from '../../shared/dataTable.ts'
import type { TableFilter, TableSort } from '../../shared/dataTable.ts'

/**
 * The shown collection's rows as a Framer CMS table: search, filters and sortable headers over
 * the loaded rows, and a row opens in the right panel. Read-only: the rows are app data reached
 * through the generated API (E2), so the hosted inline cell editing, quick-add row and bulk
 * delete are not ported, and none of it writes. What shows is what the app's list route answers
 * (Live), else the entity's sample data (the fixtures); the Live / Sample data switch shows the
 * choice and chooses, and says when Live is chosen but the app does not answer. A collection read
 * through a connection is always Live. `collection` is the one the workspace shows.
 */
const { collection } = defineProps<{ collection: DataCollection }>()
const editor = useEditor()
const fields = computed(() => collection.fields)
const rest = computed(() => collection.kind === 'rest')

/** The switch: Live reads the app's rows again (also when Live is chosen already: a retry), Sample data shows the collection's own. */
function chooseSource(source: RowsSource) {
  editor.rowsPreference = source
  if (source === 'live') void editor.reloadRecords()
}

const query = ref('')
const sort = ref<TableSort | null>(null)
const filters = ref<TableFilter[]>([])
const narrowed = computed(() => query.value.trim() !== '' || filters.value.length > 0)
const rows = computed(() => tableRows(editor.collectionRows, fields.value, { query: query.value, filters: filters.value, sort: sort.value }))
const count = computed(() => recordsCount({ shown: rows.value.length, total: editor.recordsTotal, narrowed: narrowed.value }))
const refreshing = computed(() => editor.recordsLoading)

watch(() => collection.id, () => {
  query.value = ''
  sort.value = null
  filters.value = []
})

const WIDTHS: Record<FieldType, string> = { text: 'min-w-56', uuid: 'min-w-56', integer: 'min-w-32', number: 'min-w-32', boolean: 'min-w-28', date: 'min-w-36', datetime: 'min-w-36', image: 'min-w-28' }

/** The row's id in the table: `rows` are sorted, so the position in the loaded rows is looked up for a row without an id. */
const idOf = (row: Record<string, unknown>) => rowId(row, editor.collectionRows.indexOf(row))

const toggle = (id: string) => {
  editor.recordId = editor.recordId === id ? null : id
}

const failure = computed(() => editor.recordsError ? rowsFailure(collection.plural, editor.recordsError) : '')

/** What an empty table says, for the rows it shows: the API's, the collection's own sample data (which Live falls back to when the app does not answer), or the app's. */
const emptyText = computed(() => {
  if (rest.value) return 'The API returned no items.'
  if (editor.rowsPreference === 'live' && editor.rowsSource === 'sample' && editor.recordsLoading) return 'Reading the app\'s rows…'
  if (editor.rowsSource === 'live') return 'No items yet. Rows are your app\'s data: they are added through the app, or seeded as sample data.'
  return editor.rowsFallback ? 'No items to show: the app is not answering and this collection has no sample data.' : 'No sample data yet for this collection.'
})

function sortIcon(key: string) {
  if (sort.value?.key !== key) return ''
  return sort.value.direction === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'
}
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
      :source="editor.rowsPreference"
      :shown="editor.rowsSource"
      :fallback="editor.rowsFallback"
      :switchable="!rest"
      :refreshing="refreshing"
      @refresh="editor.reloadRecords()"
      @source="chooseSource"
    />

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

    <div
      class="min-h-0 flex-1 overflow-auto outline-none"
      data-records-table
    >
      <table class="w-full border-separate border-spacing-0">
        <thead class="sticky top-0 z-10 bg-(--editor-canvas)">
          <tr class="h-10 text-left text-[12px] text-dimmed">
            <th class="w-4 border-b border-white/6" />
            <th
              v-for="field in fields"
              :key="field.id"
              class="border-b border-white/6 px-4 font-normal"
              :class="WIDTHS[field.type]"
              :aria-sort="sort?.key === field.name ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'"
            >
              <button
                type="button"
                class="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 hover:text-toned"
                :class="{ 'text-highlighted': sort?.key === field.name }"
                :title="field.name === fieldLabel(field.name) ? undefined : field.name"
                data-records-header
                @click="sort = nextSort(sort, field.name)"
              >
                <UIcon
                  v-if="sortIcon(field.name)"
                  :name="sortIcon(field.name)"
                  class="size-3.5"
                />
                {{ field.label }}
              </button>
            </th>
            <th class="w-11 border-b border-white/6" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="idOf(row)"
            class="group h-11 cursor-default"
            :class="editor.recordId === idOf(row) ? 'bg-primary/10' : 'hover:bg-white/3'"
            :data-record="idOf(row)"
            :data-open="editor.recordId === idOf(row) || undefined"
            @click="toggle(idOf(row))"
          >
            <td class="w-4 border-b border-white/5" />
            <td
              v-for="(field, col) in fields"
              :key="field.id"
              class="border-b border-l border-white/5 px-4"
              :class="field.type === 'text' ? 'max-w-0' : 'whitespace-nowrap'"
              :data-cell="`${index}-${col}`"
            >
              <DataTableCell
                :field="field"
                :value="row[field.name] ?? null"
              />
            </td>
            <td class="w-11 border-b border-white/5 pr-3 text-right">
              <UTooltip text="Open record">
                <EditorButton
                  icon="i-lucide-panel-right-open"
                  variant="ghost"
                  size="xs"
                  aria-label="Open record"
                  class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  :class="{ 'text-primary opacity-100': editor.recordId === idOf(row) }"
                  data-record-open
                  @click.stop="editor.recordId = idOf(row)"
                />
              </UTooltip>
            </td>
          </tr>
        </tbody>
      </table>
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
    </div>
  </section>
</template>
