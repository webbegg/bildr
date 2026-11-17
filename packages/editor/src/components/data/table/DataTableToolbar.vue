<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { FIELD_SHELL } from '../../../editorUi.ts'
import { filterLabel } from '../../../shared/dataTable.ts'
import type { TableFilter, TableSort } from '../../../shared/dataTable.ts'
import type { DataField } from '../../../shared/dataModel.ts'

/**
 * The rows table's toolbar, Framer CMS's: sort, filter and search icons with the active filters
 * as chips, the item count, and a `…` menu. The Live / Sample data switch and Refresh are `DataSourceSwitch`'s (`switchable`
 * is its); the menu's Refresh asks the parent for it too. The hosted Add item and bulk Delete are not here: rows are app data (E2).
 */
const props = defineProps<{ fields: DataField[], count: string, switchable: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const query = defineModel<string>('query', { required: true })
const sort = defineModel<TableSort | null>('sort', { required: true })
const filters = defineModel<TableFilter[]>('filters', { required: true })

const searching = ref(false)
const search = useTemplateRef<HTMLInputElement>('search')
const toolbar = useTemplateRef<HTMLElement>('toolbar')
const searchOpen = computed(() => searching.value || query.value !== '')

async function openSearch() {
  searching.value = true
  await nextTick()
  search.value?.focus()
}

/** An empty search folds back to its icon, unless focus stays in the toolbar (so its buttons don't shift under the click). */
function closeSearch(event?: FocusEvent) {
  const next = event?.relatedTarget as Node | null | undefined
  if (query.value || (next && toolbar.value?.contains(next))) return
  searching.value = false
}

function sortBy(key: string, direction: TableSort['direction'] = sort.value?.direction ?? 'asc') {
  sort.value = { key, direction }
}

const sortMenu = computed<DropdownMenuItem[][]>(() => [
  props.fields.map(field => ({
    label: field.label,
    type: 'checkbox' as const,
    checked: sort.value?.key === field.name,
    onSelect: () => sortBy(field.name)
  })),
  (['asc', 'desc'] as const).map(direction => ({
    label: direction === 'asc' ? 'Ascending' : 'Descending',
    icon: direction === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down',
    type: 'checkbox' as const,
    checked: sort.value?.direction === direction,
    disabled: !sort.value,
    onSelect: () => sort.value && sortBy(sort.value.key, direction)
  })),
  [{ label: 'Clear sort', icon: 'i-lucide-x', disabled: !sort.value, onSelect: () => (sort.value = null) }]
])

const moreMenu = computed<DropdownMenuItem[][]>(() => [
  [{ label: 'Refresh', icon: 'i-lucide-refresh-cw', onSelect: () => emit('refresh') }],
  [{ label: 'Clear filters', icon: 'i-lucide-x', disabled: !filters.value.length, onSelect: () => (filters.value = []) }]
])

function removeFilter(index: number) {
  filters.value = filters.value.filter((_, i) => i !== index)
}
</script>

<template>
  <header
    ref="toolbar"
    class="flex h-12 shrink-0 items-center gap-1 border-b border-white/5 px-3"
  >
    <EditorMenu :items="sortMenu">
      <UTooltip text="Sort">
        <EditorButton
          icon="i-lucide-arrow-up-down"
          variant="ghost"
          aria-label="Sort"
          :class="{ 'text-highlighted': sort }"
          :disabled="!fields.length"
          data-records-sort
        />
      </UTooltip>
    </EditorMenu>
    <DataTableFilterMenu
      :fields="fields"
      @add="filters = [...filters, $event]"
    />
    <UTooltip
      v-if="!searchOpen"
      text="Search"
    >
      <EditorButton
        icon="i-lucide-search"
        variant="ghost"
        aria-label="Search"
        data-records-search-open
        @click="openSearch"
      />
    </UTooltip>
    <label
      v-else
      :class="FIELD_SHELL"
      class="w-56 gap-2 px-2 text-muted"
    >
      <UIcon
        name="i-lucide-search"
        class="size-4 shrink-0"
      />
      <input
        ref="search"
        v-model="query"
        type="search"
        placeholder="Search…"
        aria-label="Search items"
        class="min-w-0 flex-1 bg-transparent text-highlighted outline-none placeholder:text-dimmed"
        data-records-search
        @keydown.esc="query = ''; closeSearch()"
        @blur="closeSearch"
      >
    </label>
    <div
      v-if="filters.length"
      class="ms-1 flex min-w-0 items-center gap-1 overflow-x-auto"
    >
      <button
        v-for="(filter, index) in filters"
        :key="index"
        type="button"
        class="flex h-6 shrink-0 items-center gap-1 rounded-lg bg-white/6 ps-2 pe-1 text-xs text-toned hover:bg-white/10"
        :aria-label="`Remove filter ${filterLabel(filter, fields)}`"
        data-filter-chip
        @click="removeFilter(index)"
      >
        {{ filterLabel(filter, fields) }}
        <UIcon
          name="i-lucide-x"
          class="size-3.5 text-dimmed"
        />
      </button>
    </div>
    <span
      class="ms-2 shrink-0 text-xs text-dimmed tabular-nums"
      data-records-count
    >{{ count }}</span>
    <div class="ms-auto flex shrink-0 items-center gap-2">
      <DataSourceSwitch :switchable="switchable" />
      <EditorMenu
        :items="moreMenu"
        :content="{ align: 'end' }"
      >
        <EditorButton
          icon="i-lucide-ellipsis"
          variant="ghost"
          aria-label="More"
          data-records-more
        />
      </EditorMenu>
    </div>
  </header>
</template>
