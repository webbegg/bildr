<script setup lang="ts">
import { FOCUS_RING } from '../../editorUi.ts'

/**
 * One group of an API panel's tree (simple data S6, api panel P1): its Queries, its Actions or its Models, each by name, a query or an
 * action with its method in front and its method and path as the tooltip. A row opens the item's editor beside the tree and is marked
 * while it is open (`open`); it has its Rename and Delete, and the group's + makes a new one. A new item whose editor is open but that is
 * not saved yet is a row of its own (`pending`). Each group says what it is for when it is empty.
 */
export interface ApiListRow {
  name: string
  /** What the row says of the item in a line (`GET /products`, `3 fields`): its tooltip. */
  note: string
  /** For a query: where pages use it ("Used in shop, weather"), from the module's usage; empty when no page does. */
  used?: string
}
const { kind, title, rows, empty, open = undefined, pending = undefined } = defineProps<{
  kind: 'query' | 'action' | 'model'
  title: string
  rows: ApiListRow[]
  empty: string
  /** The name of the item whose editor is open, when it is of this group. */
  open?: string
  /** The name of a new item of this group whose editor is open and that is not saved yet. */
  pending?: string
}>()
const emit = defineEmits<{ open: [name: string], create: [], rename: [name: string], remove: [name: string] }>()

/** A query's or an action's method (`GET`), the start of its note. */
const methodOf = (row: ApiListRow) => row.note.split(' ')[0] ?? ''
const rowClass = (current: boolean) => [
  'flex w-full min-w-0 items-start gap-2 rounded-md py-1.5 ps-2 pe-14 text-left text-[12px]',
  FOCUS_RING,
  current ? 'bg-white/8 text-highlighted' : 'text-toned hover:bg-white/4'
]
</script>

<template>
  <section
    :aria-labelledby="`simple-api-${kind}-heading`"
    :data-api-section="kind === 'query' ? 'queries' : kind === 'action' ? 'actions' : 'models'"
  >
    <div class="flex h-7 items-center gap-1 ps-2 pe-0.5">
      <h3
        :id="`simple-api-${kind}-heading`"
        class="flex-1 text-[11px] font-[550] tracking-wide text-dimmed uppercase"
      >
        {{ title }}
      </h3>
      <EditorButton
        variant="ghost"
        size="xs"
        icon="i-lucide-plus"
        :aria-label="`New ${kind}`"
        :title="`New ${kind}`"
        :data-api-new="kind"
        @click="emit('create')"
      />
    </div>
    <ul
      v-if="rows.length || pending"
      class="space-y-0.5"
    >
      <li
        v-for="row in rows"
        :key="row.name"
        class="group relative"
        :data-api-item="`${kind}:${row.name}`"
      >
        <button
          type="button"
          :class="rowClass(row.name === open)"
          :title="row.note"
          :aria-current="row.name === open ? 'page' : undefined"
          data-api-open
          @click="emit('open', row.name)"
        >
          <span
            v-if="kind !== 'model'"
            class="w-11 shrink-0 pt-px font-mono text-[10px] font-[600]"
            :class="methodOf(row) === 'GET' ? 'text-success' : methodOf(row) === 'DELETE' ? 'text-error' : 'text-warning'"
            data-api-method
          >{{ methodOf(row) }}</span>
          <UIcon
            v-else
            name="i-lucide-shapes"
            class="mt-px size-3.5 shrink-0 text-dimmed"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ row.name }}</span>
            <span
              v-if="row.used"
              class="block truncate text-[11px] text-dimmed"
              :title="row.used"
              data-api-used
            >{{ row.used }}</span>
          </span>
        </button>
        <span class="absolute end-1 top-1 flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <EditorButton
            variant="ghost"
            size="xs"
            icon="i-lucide-pencil"
            :aria-label="`Rename ${row.name}`"
            :title="`Rename ${row.name}`"
            data-api-rename
            @click="emit('rename', row.name)"
          />
          <EditorButton
            variant="ghost"
            size="xs"
            icon="i-lucide-trash-2"
            :aria-label="`Delete ${row.name}`"
            :title="`Delete ${row.name}`"
            data-api-delete
            @click="emit('remove', row.name)"
          />
        </span>
      </li>
      <li
        v-if="pending"
        class="flex items-center gap-2 rounded-md bg-white/8 py-1.5 ps-2 pe-2 text-[12px] text-highlighted"
        aria-current="page"
        data-api-pending
      >
        <span class="min-w-0 flex-1 truncate">{{ pending }}</span>
        <span class="shrink-0 text-[10px] text-dimmed">Not saved</span>
      </li>
    </ul>
    <p
      v-else
      class="px-2 py-1 text-[11px] leading-4 text-dimmed"
      :data-api-empty="kind"
    >
      {{ empty }}
    </p>
  </section>
</template>
