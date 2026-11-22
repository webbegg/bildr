<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from 'vue'
import type { Row } from '@bildr/codegen/query'
import { fieldLabel } from '../../../shared/dataModel.ts'
import type { DataField, FieldType } from '../../../shared/dataModel.ts'
import { NO_CHOICE, cellEditText, cellValue, choiceValue, moveCell, selectChoices } from '../../../shared/dataGrid.ts'
import type { CellMove, CellPos } from '../../../shared/dataGrid.ts'
import { rowId } from '../../../shared/dataTable.ts'
import type { TableSort } from '../../../shared/dataTable.ts'
import { useDirtyReport } from '../../../editor/useDirtyReport.ts'
import { useEditor } from '../../../editor/useEditor.ts'
import type { CellValue, SaveRefusal } from '../../../editor/sampleRows.ts'

/** What a cell says when the row changed under it (a conflict): the typed value is kept, and the next Enter saves it over the row as it is now. */
const ROW_CHANGED = 'This row changed: your value is kept; press Enter to save it over the new row.'

/**
 * The rows table of the Data workspace: one column per field and one row per record, over rows it is given. The Rows tab
 * shows a collection's with sortable headers and a record that opens in the right panel; a query's Results shows
 * what the query returned, which the query has already ordered (`sortable` off) and which has no panel to open (`openable`
 * off). The default slot is what is said under it (no rows, no match). `loaded` is the rows `rows` was made from: a row
 * with no id is known by its place among them.
 *
 * `editable` (the Sample data of a collection, D4) makes it a grid: one cell is active (one tab stop; the arrows and Tab move it,
 * Enter or F2 or a double-click edits it, Escape cancels, Enter or Tab or leaving the cell saves it), a boolean is a switch, a
 * row has a checkbox and a delete button, and what is typed is saved at once through `save`, which answers the module's refusal
 * (undefined when it was saved). A refusal stays on its cell with the text that was typed; a cell is disabled while its save is
 * in flight. A read-only field's cells are shown and moved over, never edited. Without `editable` nothing here writes.
 * A cell whose save was refused holds text that is not saved, so it is an unsaved edit of the workspace ("Post row"): leaving it
 * asks first. It stops being one when the cell is saved, cancelled (Escape) or gone.
 */
const { fields, rows, loaded, sort = null, sortable = true, openable = true, openId = null, editable = false, selected = [], save = undefined } = defineProps<{
  fields: DataField[]
  rows: Row[]
  loaded: Row[]
  sort?: TableSort | null
  sortable?: boolean
  openable?: boolean
  /** The id of the row that is open. */
  openId?: string | null
  editable?: boolean
  /** The ids of the rows whose checkbox is on. */
  selected?: string[]
  /** `base` is the row as it was shown when the edit began (a row with no id is named by its place, which a delete moves). */
  save?: (row: string, field: DataField, value: CellValue, base: Row) => Promise<SaveRefusal | undefined>
}>()
const emit = defineEmits<{ sort: [key: string], toggle: [id: string], open: [id: string], select: [id: string, on: boolean], selectAll: [on: boolean], remove: [id: string] }>()

const WIDTHS: Record<FieldType, string> = {
  text: 'min-w-56', uuid: 'min-w-56', integer: 'min-w-32', number: 'min-w-32', boolean: 'min-w-28', date: 'min-w-36', datetime: 'min-w-36', image: 'min-w-28',
  email: 'min-w-56', url: 'min-w-56', phone: 'min-w-36', color: 'min-w-28', select: 'min-w-32', money: 'min-w-32', percent: 'min-w-28'
}
const PLACEHOLDERS: Partial<Record<FieldType, string>> = { date: 'YYYY-MM-DD', datetime: '2026-01-15T09:30:00Z' }

/** The row's id in the table: `rows` may be sorted, so the position in the loaded rows is looked up for a row without an id. */
const idOf = (row: Row) => rowId(row, loaded.indexOf(row))

function sortIcon(key: string) {
  if (sort?.key !== key) return ''
  return sort.direction === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'
}

const root = useTemplateRef<HTMLElement>('root')
const active = ref<CellPos | null>(null)
/** The cell being typed in: its row, field and text, and the text a refusal was for (blurring again does not ask again). */
const editing = ref<{ id: string, name: string, text: string, refused: string | null, base: Row } | null>(null)
/** The cells (`<row id>|<field>`) whose save is in flight, and the refusal of those whose last save was refused. */
const pending = reactive(new Set<string>())
const refusals = reactive<Record<string, string>>({})

const editor = useEditor()
// Another collection's fields, or Live rows (which are not edited), are not the cell that was being typed in: it is given up.
watch([() => editable, () => fields.map(field => field.id).join('|')], () => {
  editing.value = null
  active.value = null
})
useDirtyReport(() => editing.value?.refused != null ? `${editor.dataCollection?.name ?? 'Sample data'} row` : null)

const cellKey = (id: string, name: string) => `${id}|${name}`
const size = computed(() => ({ rows: rows.length, cols: fields.length }))
const isActive = (row: number, col: number) => active.value?.row === row && active.value.col === col
/** The one tab stop: the active cell, or the first until there is one. */
const tabStop = (row: number, col: number) => isActive(row, col) || (!active.value && row === 0 && col === 0) ? 0 : -1
const isEditing = (id: string, name: string) => editing.value?.id === id && editing.value.name === name
const allSelected = computed(() => rows.length > 0 && rows.every(row => selected.includes(idOf(row))))

function focusCell(pos: CellPos | null) {
  if (!pos) return
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-cell="${pos.row}-${pos.col}"]`)?.focus())
}

function activate(pos: CellPos, focus = true) {
  active.value = pos
  if (focus) focusCell(pos)
}

function focusInput() {
  void nextTick(() => {
    const input = root.value?.querySelector<HTMLInputElement>('[data-cell-input]')
    input?.focus()
    input?.select()
  })
}

function onCellClick(event: MouseEvent, row: number, col: number) {
  if (!editable) return
  // A click in a cell is the cell's: it does not open or close the record.
  event.stopPropagation()
  if (!(event.target as HTMLElement).closest('input')) activate({ row, col })
}

/** Sends a value for a cell, keeping its refusal for the cell. Resolves the refusal (`undefined`: it was saved), or `null` when nothing was sent. */
async function put(id: string, field: DataField, value: CellValue, base: Row): Promise<SaveRefusal | undefined | null> {
  const key = cellKey(id, field.name)
  if (!save || pending.has(key)) return null
  Reflect.deleteProperty(refusals, key)
  pending.add(key)
  const refused = await save(id, field, value, base)
  pending.delete(key)
  if (refused) refusals[key] = refused.message
  return refused
}

function beginEdit(row: number, col: number) {
  const field = fields[col]
  const shown = rows[row]
  if (!editable || !field || !shown || field.readonly) return
  activate({ row, col }, false)
  if (field.type === 'boolean') {
    void toggle(row, col)
    return
  }
  const id = idOf(shown)
  if (pending.has(cellKey(id, field.name))) return
  Reflect.deleteProperty(refusals, cellKey(id, field.name))
  editing.value = { id, name: field.name, text: cellEditText(shown[field.name]), refused: null, base: { ...shown } }
  focusInput()
}

async function toggle(row: number, col: number) {
  const field = fields[col]
  const shown = rows[row]
  if (!field || !shown || field.readonly) return
  await put(idOf(shown), field, shown[field.name] !== true, { ...shown })
  focusCell({ row, col })
}

/** Saves the text being typed (nothing is sent when it did not change). Resolves whether the cell is free again. */
async function commit(): Promise<boolean> {
  const current = editing.value
  if (!current) return true
  const field = fields.find(entry => entry.name === current.name)
  const key = cellKey(current.id, current.name)
  if (!field || pending.has(key)) return false
  const stored = loaded.find((row, index) => rowId(row, index) === current.id)
  if (current.text === cellEditText(stored?.[current.name])) {
    editing.value = null
    Reflect.deleteProperty(refusals, key)
    return true
  }
  const refused = await put(current.id, field, cellValue(field, current.text), current.base)
  if (refused === undefined) {
    editing.value = null
    return true
  }
  // Refused: the cell keeps what was typed, with the message, and asks again only when the text changes (Enter asks again at once).
  if (editing.value) {
    editing.value.refused = current.text
    // The row changed under the cell: the typed value is kept, and the base is the row as it is now, so the next Enter saves over it.
    if (refused?.conflict && refused.fresh) {
      editing.value.base = refused.fresh
      refusals[cellKey(current.id, current.name)] = ROW_CHANGED
    }
  }
  focusInput()
  return false
}

/** A select cell's choice: saved at once (None empties an optional one), the cell keeps the keyboard. */
async function choose(choice: string) {
  if (!editing.value) return
  editing.value.text = cellEditText(choiceValue(choice))
  if (await commit()) focusCell(active.value)
}

/** The dropdown closed: without a choice (Escape, a click away) the cell is given back as it was. */
function onSelectOpen(open: boolean) {
  if (open) return
  void nextTick(() => {
    const current = editing.value
    if (current && !pending.has(cellKey(current.id, current.name)) && current.refused === null) cancel()
  })
}

function cancel() {
  const current = editing.value
  if (!current) return
  Reflect.deleteProperty(refusals, cellKey(current.id, current.name))
  editing.value = null
  focusCell(active.value)
}

async function onInputKey(event: KeyboardEvent) {
  // Keys typed in a cell are the cell's: not the screen's shortcuts.
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    if (await commit()) focusCell(active.value)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  } else if (event.key === 'Tab') {
    event.preventDefault()
    if (!await commit()) return
    const to = active.value && moveCell(active.value, event.shiftKey ? 'previous' : 'next', size.value)
    if (to) activate(to)
    else focusCell(active.value)
  }
}

/** Leaving the cell saves it, unless a save is on its way or the text is the one already refused. */
function onInputBlur() {
  const current = editing.value
  if (!current || pending.has(cellKey(current.id, current.name)) || current.refused === current.text) return
  void commit()
}

const MOVES: Record<string, CellMove> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

function onCellKey(event: KeyboardEvent, row: number, col: number) {
  // Only the cell's own keys: the ones typed in its input or on its switch are theirs.
  if (!editable || event.target !== event.currentTarget || editing.value) return
  if (event.key === 'Enter' || event.key === 'F2') {
    event.preventDefault()
    beginEdit(row, col)
    return
  }
  const move = event.key === 'Tab' ? (event.shiftKey ? 'previous' : 'next') : MOVES[event.key]
  if (!move) return
  const to = moveCell({ row, col }, move, size.value)
  // Tab past the first or last cell leaves the grid, as it does any table.
  if (!to) return
  event.preventDefault()
  activate(to)
}
</script>

<template>
  <div
    ref="root"
    class="min-h-0 flex-1 overflow-auto outline-none"
    data-records-table
  >
    <table
      class="w-full border-separate border-spacing-0"
      :role="editable ? 'grid' : undefined"
      :aria-rowcount="editable ? rows.length + 1 : undefined"
    >
      <thead class="sticky top-0 z-10 bg-(--editor-canvas)">
        <tr class="h-10 text-left text-[12px] text-dimmed">
          <th
            class="border-b border-white/6"
            :class="editable ? 'w-9 text-center' : 'w-4'"
          >
            <input
              v-if="editable"
              type="checkbox"
              class="size-3.5 cursor-pointer scheme-dark accent-(--ui-primary)"
              aria-label="Select all rows"
              :checked="allSelected"
              :disabled="!rows.length"
              data-select-all
              @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
            >
          </th>
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
            class="border-b border-white/6"
            :class="editable ? 'w-20' : 'w-11'"
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
          <td class="border-b border-white/5 text-center">
            <input
              v-if="editable"
              type="checkbox"
              class="size-3.5 cursor-pointer scheme-dark accent-(--ui-primary)"
              aria-label="Select row"
              :checked="selected.includes(idOf(row))"
              data-row-select
              @click.stop
              @change="emit('select', idOf(row), ($event.target as HTMLInputElement).checked)"
            >
          </td>
          <td
            v-for="(field, col) in fields"
            :key="field.id"
            class="border-b border-l border-white/5 px-4 outline-none"
            :class="[field.type === 'text' ? 'max-w-0' : 'whitespace-nowrap', { 'focus-visible:ring-1 focus-visible:ring-primary/70 focus-visible:ring-inset': editable, 'bg-primary/5': editable && isActive(index, col) }]"
            :data-cell="`${index}-${col}`"
            :data-cell-active="(editable && isActive(index, col)) || undefined"
            :role="editable ? 'gridcell' : undefined"
            :tabindex="editable ? tabStop(index, col) : undefined"
            :aria-readonly="editable && field.readonly ? 'true' : undefined"
            :title="editable && field.readonly ? 'Read-only: the app sets it' : undefined"
            @click="onCellClick($event, index, col)"
            @dblclick="beginEdit(index, col)"
            @keydown="onCellKey($event, index, col)"
          >
            <button
              v-if="editable && field.type === 'boolean' && !field.readonly"
              type="button"
              role="switch"
              tabindex="-1"
              class="relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50"
              :class="row[field.name] === true ? 'bg-primary' : 'bg-white/15'"
              :aria-checked="row[field.name] === true"
              :aria-label="field.label"
              :disabled="pending.has(cellKey(idOf(row), field.name))"
              data-cell-toggle
              @click.stop="activate({ row: index, col }, false); toggle(index, col)"
            >
              <span
                class="absolute start-0.5 size-3 rounded-full bg-white transition-transform"
                :class="row[field.name] === true ? 'translate-x-3' : 'translate-x-0'"
              />
            </button>
            <EditorSelect
              v-else-if="editable && field.type === 'select' && isEditing(idOf(row), field.name)"
              :model-value="editing!.text === '' ? NO_CHOICE : editing!.text"
              :items="selectChoices(field)"
              :disabled="pending.has(cellKey(idOf(row), field.name))"
              :aria-label="field.label"
              default-open
              data-cell-select
              @update:model-value="choose"
              @update:open="onSelectOpen"
              @click.stop
            />
            <input
              v-else-if="editable && isEditing(idOf(row), field.name)"
              v-model="editing!.text"
              type="text"
              class="h-7 w-full min-w-0 rounded-md bg-elevated px-2 text-[12px] text-highlighted outline-none ring-1 ring-primary/70 disabled:opacity-60"
              :class="{ 'ring-error': refusals[cellKey(idOf(row), field.name)] }"
              :inputmode="field.type === 'integer' || field.type === 'number' ? 'decimal' : undefined"
              :placeholder="PLACEHOLDERS[field.type]"
              :aria-label="field.label"
              :aria-invalid="refusals[cellKey(idOf(row), field.name)] ? 'true' : undefined"
              :disabled="pending.has(cellKey(idOf(row), field.name))"
              data-cell-input
              @keydown="onInputKey"
              @blur="onInputBlur"
            >
            <DataTableCell
              v-else
              :field="field"
              :value="row[field.name] ?? null"
            />
            <p
              v-if="editable && refusals[cellKey(idOf(row), field.name)]"
              class="mt-0.5 text-[11px] leading-tight whitespace-normal text-error"
              role="alert"
              data-cell-error
            >
              {{ refusals[cellKey(idOf(row), field.name)] }}
            </p>
          </td>
          <td
            v-if="openable"
            class="border-b border-white/5 pr-3 text-right"
            :class="editable ? 'w-20' : 'w-11'"
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
            <UTooltip
              v-if="editable"
              text="Delete row"
            >
              <EditorButton
                icon="i-lucide-trash-2"
                variant="ghost"
                size="xs"
                aria-label="Delete row"
                class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                data-record-delete
                @click.stop="emit('remove', idOf(row))"
              />
            </UTooltip>
          </td>
        </tr>
      </tbody>
    </table>
    <slot />
  </div>
</template>
