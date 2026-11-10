<script setup lang="ts">
import type { DataRecord, RecordValue } from '#shared/data/records'
import { cellInput, moveCell, moveForKey, nextSort, parseCell, selectRows, tableRows } from '#shared/data/table'
import type { CellMove, TableCell, TableFilter, TableSort } from '#shared/data/table'
import type { Collection, Field } from '#shared/document/schema'

/**
 * The shown collection's records as a Framer CMS table: search, filters,
 * sortable headers, inline cell editing with keyboard navigation, a quick-add row and
 * bulk delete. API collections are read-only. Records are not undoable.
 */
const editor = useEditor()
const toast = useToast()
const collection = computed(() => editor.collection as Collection)
const fields = computed(() => collection.value.fields)
const live = computed(() => collection.value.source.type === 'api')
const canAdd = computed(() => !live.value && fields.value.length > 0)

const query = ref('')
const sort = ref<TableSort | null>(null)
const filters = ref<TableFilter[]>([])
const narrowed = computed(() => query.value.trim() !== '' || filters.value.length > 0)
const rows = computed(() => tableRows(editor.records, fields.value, { query: query.value, filters: filters.value, sort: sort.value }))
const size = computed(() => ({ rows: rows.value.length + (canAdd.value ? 1 : 0), cols: fields.value.length }))

const selected = ref<string[]>([])
const anchor = ref<string | null>(null)
const active = ref<TableCell | null>(null)
const editing = ref<{ id: string, key: string, initial?: string } | null>(null)
const refreshing = ref(false)

const scroller = useTemplateRef<HTMLElement>('scroller')
const addRow = useTemplateRef<{ focus: (col: number) => void }>('addRow')

watch(() => collection.value.id, () => {
  query.value = ''
  sort.value = null
  filters.value = []
  selected.value = []
  anchor.value = null
  active.value = null
  editing.value = null
})

watch(() => editor.records, (records) => {
  const ids = new Set(records.map(r => r.id))
  selected.value = selected.value.filter(id => ids.has(id))
})

const WIDTHS: Record<Field['type'], string> = { text: 'min-w-56', number: 'min-w-32', boolean: 'min-w-28', date: 'min-w-36', image: 'min-w-28' }

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`
const count = computed(() => {
  if (editor.recordsTotal > editor.records.length) return `showing the first ${editor.records.length} of ${editor.recordsTotal}`
  return narrowed.value ? `${rows.value.length} of ${items(editor.recordsTotal)}` : items(editor.recordsTotal)
})

const allSelected = computed(() => rows.value.length > 0 && rows.value.every(r => selected.value.includes(r.id)))
const someSelected = computed(() => !allSelected.value && rows.value.some(r => selected.value.includes(r.id)))

function toggleAll() {
  const shown = new Set(rows.value.map(r => r.id))
  selected.value = allSelected.value
    ? selected.value.filter(id => !shown.has(id))
    : [...selected.value.filter(id => !shown.has(id)), ...shown]
}

function toggleRow(id: string, event: MouseEvent) {
  selected.value = selectRows(rows.value.map(r => r.id), selected.value, id, anchor.value, event.shiftKey)
  anchor.value = id
  scroller.value?.focus({ preventScroll: true })
}

function focusTable() {
  scroller.value?.focus({ preventScroll: true })
}

async function go(cell: TableCell) {
  active.value = cell
  if (canAdd.value && cell.row === rows.value.length) {
    addRow.value?.focus(cell.col)
    return
  }
  focusTable()
  await nextTick()
  scroller.value?.querySelector(`[data-cell="${cell.row}-${cell.col}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function startEdit(cell: TableCell, initial?: string) {
  const record = rows.value[cell.row]
  const field = fields.value[cell.col]
  if (!record || !field || live.value) return
  if (field.type === 'boolean') void commit(record, field, record.values[field.key] !== true)
  else editing.value = { id: record.id, key: field.key, initial }
}

async function commit(record: DataRecord, field: Field, raw: string | boolean, move?: CellMove) {
  editing.value = null
  await nextTick()
  if (!document.activeElement || document.activeElement === document.body) focusTable()
  if (move && active.value) void go(moveCell(active.value, move, size.value))
  const current = record.values[field.key] ?? null
  if (typeof raw === 'string' && raw === cellInput(field.type, current)) return
  await editor.runData('record_update', { recordId: record.id, values: { [field.key]: parseCell(field.type, raw) ?? null } })
}

function cancel() {
  editing.value = null
  focusTable()
}

function clickCell(row: number, col: number) {
  active.value = { row, col }
  const field = fields.value[col]!
  if (live.value || field.type === 'boolean') focusTable()
  else startEdit({ row, col })
}

function onKey(event: KeyboardEvent) {
  if (editing.value || (event.target as HTMLElement).closest('input')) return
  const meta = event.metaKey || event.ctrlKey || event.altKey
  if ((event.key === 'Backspace' || event.key === 'Delete') && selected.value.length && !live.value) {
    event.preventDefault()
    void removeSelected()
    return
  }
  const move = moveForKey(event.key, event.shiftKey)
  if (move && !meta && size.value.rows && size.value.cols) {
    event.preventDefault()
    void go(active.value ? moveCell(active.value, move, size.value) : { row: 0, col: 0 })
    return
  }
  if (event.key === 'Escape') {
    if (active.value) active.value = null
    else selected.value = []
    return
  }
  if (!active.value || meta) return
  const field = fields.value[active.value.col]
  if (event.key === 'Enter' || (event.key === ' ' && field?.type === 'boolean')) {
    event.preventDefault()
    startEdit(active.value)
  } else if (event.key.length === 1 && field?.type !== 'boolean' && field?.type !== 'date') {
    event.preventDefault()
    startEdit(active.value, event.key)
  }
}

async function create(values: Record<string, RecordValue>): Promise<boolean> {
  return (await editor.runData('record_create', { values })) !== undefined
}

function leaveAddRow(col: number) {
  if (rows.value.length) void go({ row: rows.value.length - 1, col })
  else focusTable()
}

async function removeSelected() {
  const ids = [...selected.value]
  if (!confirm(`Delete ${items(ids.length)}? This cannot be undone.`)) return
  try {
    for (const recordId of ids) await callAction('record_delete', { projectId: editor.projectId, collection: collection.value.id, recordId })
  } catch (error) {
    toast.add({ title: 'Action failed', description: actionErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
  }
  if (editor.recordId && ids.includes(editor.recordId)) editor.recordId = null
  selected.value = []
  active.value = null
  await refresh()
  focusTable()
}

async function refresh() {
  refreshing.value = true
  try {
    await editor.reloadRecords()
    editor.recordsError = ''
  } catch (error) {
    editor.recordsError = actionErrorMessage(error)
  } finally {
    refreshing.value = false
  }
}

function sortIcon(key: string) {
  if (sort.value?.key !== key) return ''
  return sort.value.direction === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'
}
</script>

<template>
  <section
    class="flex size-full flex-col text-sm"
    data-records
  >
    <DataTableToolbar
      v-model:query="query"
      v-model:sort="sort"
      v-model:filters="filters"
      :fields="fields"
      :count="count"
      :can-add="canAdd"
      :live="live"
      :refreshing="refreshing"
      :selected="selected.length"
      @add="go({ row: rows.length, col: 0 })"
      @refresh="refresh"
      @remove="removeSelected"
    />

    <p
      v-if="editor.recordsError"
      class="flex shrink-0 items-center gap-2 border-b border-white/5 bg-error/10 px-4 py-2 text-xs text-error"
      data-records-error
    >
      <UIcon
        name="i-lucide-circle-alert"
        class="size-4 shrink-0"
      />
      {{ editor.recordsError }}
    </p>

    <div
      ref="scroller"
      tabindex="0"
      class="min-h-0 flex-1 overflow-auto outline-none"
      data-records-table
      @keydown="onKey"
    >
      <table class="w-full border-separate border-spacing-0">
        <thead class="sticky top-0 z-10 bg-[#1e1e1e]">
          <tr class="h-10 text-left text-[13px] text-dimmed">
            <th class="w-10 border-b border-white/6 pl-4">
              <DataTableCheck
                v-if="!live && rows.length"
                :checked="allSelected"
                :indeterminate="someSelected"
                label="Select all"
                @toggle="toggleAll"
              />
            </th>
            <th
              v-for="field in fields"
              :key="field.key"
              class="border-b border-white/6 px-4 font-normal"
              :class="WIDTHS[field.type]"
              :aria-sort="sort?.key === field.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'"
            >
              <button
                type="button"
                class="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 hover:text-toned"
                :class="{ 'text-highlighted': sort?.key === field.key }"
                data-records-header
                @click="sort = nextSort(sort, field.key)"
              >
                <UIcon
                  v-if="sortIcon(field.key)"
                  :name="sortIcon(field.key)"
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
            v-for="(record, row) in rows"
            :key="record.id"
            class="group h-11"
            :class="editor.recordId === record.id ? 'bg-primary/10' : selected.includes(record.id) ? 'bg-white/4' : 'hover:bg-white/3'"
            :data-record="record.id"
            :data-open="editor.recordId === record.id || undefined"
          >
            <td class="w-10 border-b border-white/5 pl-4">
              <DataTableCheck
                v-if="!live"
                :checked="selected.includes(record.id)"
                :label="`Select item ${row + 1}`"
                @toggle="toggleRow(record.id, $event)"
              />
            </td>
            <td
              v-for="(field, col) in fields"
              :key="field.key"
              class="border-b border-l border-white/5 px-4"
              :class="[
                field.type === 'text' ? 'max-w-0' : 'whitespace-nowrap',
                active?.row === row && active?.col === col ? 'rounded-[4px] shadow-[inset_0_0_0_2px_var(--editor-selection)]' : '',
                live ? 'cursor-default' : 'cursor-text'
              ]"
              :data-cell="`${row}-${col}`"
              :data-active="(active?.row === row && active?.col === col) || undefined"
              @click="clickCell(row, col)"
            >
              <DataTableCell
                :field="field"
                :value="record.values[field.key] ?? null"
                :editing="editing?.id === record.id && editing.key === field.key"
                :initial="editing?.id === record.id && editing.key === field.key ? editing.initial : undefined"
                :read-only="live"
                @commit="(raw, move) => commit(record, field, raw, move)"
                @cancel="cancel"
              />
            </td>
            <td class="w-11 border-b border-white/5 pr-3 text-right">
              <UTooltip text="Open record">
                <UButton
                  icon="i-lucide-panel-right-open"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Open record"
                  class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  :class="{ 'text-primary opacity-100': editor.recordId === record.id }"
                  data-record-open
                  @click.stop="editor.recordId = record.id"
                />
              </UTooltip>
            </td>
          </tr>
          <DataTableAddRow
            v-if="canAdd"
            ref="addRow"
            :fields="fields"
            :create="create"
            @leave="leaveAddRow"
          />
        </tbody>
      </table>
      <p
        v-if="!fields.length"
        class="px-4 py-6 text-xs text-dimmed"
      >
        Add a field in the panel on the right to start.
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
        {{ live ? 'The API returned no items.' : 'No items yet. Type in the row above and press Return.' }}
      </p>
    </div>
  </section>
</template>
