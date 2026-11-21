<script setup lang="ts">
import { FOCUS_RING } from '../../editorUi.ts'

/**
 * One list of an API's panel (simple data, S6): its Queries, its Actions or its Models. A row opens the item's editor, and has its Rename
 * and Delete; the section's + makes a new one. Each list says what it is for when it is empty.
 */
export interface ApiListRow {
  name: string
  /** What the row says of the item in a line (`GET /products`, `3 fields`). */
  note: string
  /** For a query: where pages use it ("Used in shop, weather"), from the module's usage; empty when no page does. */
  used?: string
}
const { kind, title, rows, empty } = defineProps<{ kind: 'query' | 'action' | 'model', title: string, rows: ApiListRow[], empty: string }>()
const emit = defineEmits<{ open: [name: string], create: [], rename: [name: string], remove: [name: string] }>()
</script>

<template>
  <section
    :aria-labelledby="`simple-api-${kind}-heading`"
    :data-api-section="kind === 'query' ? 'queries' : kind === 'action' ? 'actions' : 'models'"
  >
    <div class="flex h-9 items-center justify-between">
      <h3
        :id="`simple-api-${kind}-heading`"
        class="text-[12px] font-[550] text-highlighted"
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
      v-if="rows.length"
      class="space-y-0.5"
    >
      <li
        v-for="row in rows"
        :key="row.name"
        class="group flex items-center gap-1 rounded-lg hover:bg-white/4"
        :data-api-item="`${kind}:${row.name}`"
      >
        <button
          type="button"
          :class="['flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left', FOCUS_RING]"
          data-api-open
          @click="emit('open', row.name)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] text-toned">{{ row.name }}</span>
            <span class="block truncate font-mono text-[11px] text-dimmed">{{ row.note }}</span>
            <span
              v-if="row.used"
              class="block truncate text-[11px] text-dimmed"
              :title="row.used"
              data-api-used
            >{{ row.used }}</span>
          </span>
        </button>
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
      </li>
    </ul>
    <p
      v-else
      class="rounded-lg border border-dashed border-white/10 px-3 py-3 text-[12px] leading-4 text-muted"
      :data-api-empty="kind"
    >
      {{ empty }}
    </p>
  </section>
</template>
