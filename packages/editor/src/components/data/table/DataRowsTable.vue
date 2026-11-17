<script setup lang="ts">
import type { Row } from '@bildr/codegen/query'
import { fieldLabel } from '../../../shared/dataModel.ts'
import type { DataField, FieldType } from '../../../shared/dataModel.ts'
import { rowId } from '../../../shared/dataTable.ts'
import type { TableSort } from '../../../shared/dataTable.ts'

/**
 * The rows table of the Data workspace: one column per field and one row per record, over rows it is given. The Rows tab
 * shows a collection's with sortable headers and a record that opens in the right panel; a query's Results shows
 * what the query returned, which the query has already ordered (`sortable` off) and which has no panel to open (`openable`
 * off). The default slot is what is said under it (no rows, no match). `loaded` is the rows `rows` was made from: a row
 * with no id is known by its place among them.
 */
const { fields, rows, loaded, sort = null, sortable = true, openable = true, openId = null } = defineProps<{
  fields: DataField[]
  rows: Row[]
  loaded: Row[]
  sort?: TableSort | null
  sortable?: boolean
  openable?: boolean
  /** The id of the row that is open. */
  openId?: string | null
}>()
const emit = defineEmits<{ sort: [key: string], toggle: [id: string], open: [id: string] }>()

const WIDTHS: Record<FieldType, string> = { text: 'min-w-56', uuid: 'min-w-56', integer: 'min-w-32', number: 'min-w-32', boolean: 'min-w-28', date: 'min-w-36', datetime: 'min-w-36', image: 'min-w-28' }

/** The row's id in the table: `rows` may be sorted, so the position in the loaded rows is looked up for a row without an id. */
const idOf = (row: Row) => rowId(row, loaded.indexOf(row))

function sortIcon(key: string) {
  if (sort?.key !== key) return ''
  return sort.direction === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'
}
</script>

<template>
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
              v-if="sortable"
              type="button"
              class="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 hover:text-toned"
              :class="{ 'text-highlighted': sort?.key === field.name }"
              :title="field.name === fieldLabel(field.name) ? undefined : field.name"
              data-records-header
              @click="emit('sort', field.name)"
            >
              <UIcon
                v-if="sortIcon(field.name)"
                :name="sortIcon(field.name)"
                class="size-3.5"
              />
              {{ field.label }}
            </button>
            <span
              v-else
              :title="field.name === fieldLabel(field.name) ? undefined : field.name"
              data-records-header
            >{{ field.label }}</span>
          </th>
          <th
            v-if="openable"
            class="w-11 border-b border-white/6"
          />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in rows"
          :key="idOf(row)"
          class="group h-11 cursor-default"
          :class="openId === idOf(row) ? 'bg-primary/10' : 'hover:bg-white/3'"
          :data-record="idOf(row)"
          :data-open="openId === idOf(row) || undefined"
          @click="openable && emit('toggle', idOf(row))"
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
          <td
            v-if="openable"
            class="w-11 border-b border-white/5 pr-3 text-right"
          >
            <UTooltip text="Open record">
              <EditorButton
                icon="i-lucide-panel-right-open"
                variant="ghost"
                size="xs"
                aria-label="Open record"
                class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                :class="{ 'text-primary opacity-100': openId === idOf(row) }"
                data-record-open
                @click.stop="emit('open', idOf(row))"
              />
            </UTooltip>
          </td>
        </tr>
      </tbody>
    </table>
    <slot />
  </div>
</template>
