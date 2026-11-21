<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { answerLists, initialOpen, treeRows } from '../../editor/answerTree.ts'
import type { TreeRow } from '../../editor/answerTree.ts'

/**
 * What the API answered, in Try it (api-calls T2, S5): three tabs.
 *
 * - Tree: the JSON as a tree, open on the way to the recommended list (`answerLists`); each node folds. A list of objects says how many
 *   items it has, "Recommended" on the one the module would take, and — when the query or action answers a model (`pickable`) — "Use as
 *   the list", which makes it answer a list and sets "Where the list is" to that path (`pick`). The current one says "The list".
 * - Raw: the answer as it came (JSON pretty-printed, or the text).
 * - Headers: the answer's headers, as the module gives them (cookies, sign-ins and the source's key header already left out).
 *
 * An answer that is not JSON has no Tree; one with no headers has no Headers.
 */
const { json, text = '', headers = {}, current = null, pickable = false } = defineProps<{
  json?: unknown
  text?: string
  headers?: Record<string, string>
  /** Where the list is now, when the operation answers a list. */
  current?: string | null
  pickable?: boolean
}>()
const emit = defineEmits<{ pick: [path: string] }>()

const isJson = computed(() => json !== undefined)
const headerList = computed(() => Object.entries(headers))
const tabs = computed(() => [
  ...(isJson.value ? [{ value: 'tree', label: 'Tree' }] : []),
  { value: 'raw', label: 'Raw' },
  ...(headerList.value.length ? [{ value: 'headers', label: 'Headers' }] : [])
])
const tab = ref(isJson.value ? 'tree' : 'raw')

const lists = computed(() => isJson.value ? answerLists(json) : [])
const open = ref(new Set<string>())
watch(() => json, () => {
  open.value = initialOpen(json, lists.value)
  if (!tabs.value.some(entry => entry.value === tab.value)) tab.value = isJson.value ? 'tree' : 'raw'
}, { immediate: true })
const rows = computed(() => isJson.value ? treeRows(json, open.value, lists.value) : [])
/** The answer itself, when it is the list. */
const rootList = computed(() => lists.value.find(list => list.path === ''))
const raw = computed(() => isJson.value ? JSON.stringify(json, null, 2) : text)

/** `["data","items"]` → `data.items`, the row's hook. */
const keysOf = (row: TreeRow) => (JSON.parse(row.id) as string[]).join('.')

function toggle(row: TreeRow) {
  const next = new Set(open.value)
  if (next.has(row.id)) next.delete(row.id)
  else next.add(row.id)
  open.value = next
}
</script>

<template>
  <div
    class="space-y-2"
    data-answer
  >
    <div
      class="w-48"
      data-answer-tabs
    >
      <EditorSegmented
        :model-value="tab"
        :items="tabs"
        @update:model-value="tab = $event"
      />
    </div>

    <div
      v-if="tab === 'tree' && isJson"
      class="max-h-96 overflow-auto rounded-md bg-black/20 py-1 font-mono text-[11px] leading-5"
      role="tree"
      data-answer-tree
    >
      <div
        v-if="rootList"
        class="flex min-w-0 items-center gap-1.5 px-1.5 font-sans text-[11px] text-toned"
        data-answer-row=""
      >
        <span>The answer is a list of {{ rootList.count }} {{ rootList.count === 1 ? 'item' : 'items' }}</span>
        <span
          v-if="current === ''"
          class="ms-auto flex shrink-0 items-center gap-1 text-success"
          data-answer-current
        ><UIcon
          name="i-lucide-check"
          class="size-3.5"
        />The list</span>
        <EditorButton
          v-else-if="pickable"
          class="ms-auto shrink-0"
          size="xs"
          variant="ghost"
          label="Use as the list"
          data-answer-use-list
          @click="emit('pick', '')"
        />
      </div>
      <div
        v-for="row in rows"
        :key="row.id"
        class="group flex min-w-0 items-center gap-1.5 pe-2 hover:bg-white/4"
        :style="{ paddingInlineStart: `${row.depth * 14 + 6}px` }"
        role="treeitem"
        :aria-expanded="row.kind === 'object' || row.kind === 'array' ? row.open : undefined"
        :data-answer-row="row.kind === 'more' ? undefined : keysOf(row)"
      >
        <button
          v-if="row.kind === 'object' || row.kind === 'array'"
          type="button"
          class="flex size-4 shrink-0 items-center justify-center rounded text-dimmed hover:text-highlighted"
          :aria-label="row.open ? `Fold ${row.key}` : `Open ${row.key}`"
          data-answer-toggle
          @click="toggle(row)"
        >
          <UIcon
            :name="row.open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3.5"
          />
        </button>
        <span
          v-else
          class="size-4 shrink-0"
        />
        <span
          class="shrink-0"
          :class="row.kind === 'more' ? 'text-dimmed' : 'text-toned'"
        >{{ row.key }}</span>
        <span
          class="min-w-0 truncate"
          :class="row.kind === 'value' ? 'text-highlighted' : 'text-dimmed'"
        >{{ row.summary }}</span>
        <template v-if="row.list">
          <span
            v-if="row.list.recommended"
            class="shrink-0 rounded bg-primary/12 px-1 font-sans text-[10px] font-[550] text-primary"
            data-answer-recommended
          >Recommended</span>
          <span
            v-if="current !== null && current === row.list.path"
            class="ms-auto flex shrink-0 items-center gap-1 font-sans text-[11px] text-success"
            data-answer-current
          ><UIcon
            name="i-lucide-check"
            class="size-3.5"
          />The list</span>
          <EditorButton
            v-else-if="pickable"
            class="ms-auto shrink-0 opacity-70 group-hover:opacity-100"
            size="xs"
            variant="ghost"
            label="Use as the list"
            data-answer-use-list
            @click="emit('pick', row.list.path)"
          />
        </template>
      </div>
    </div>

    <pre
      v-else-if="tab === 'raw'"
      class="max-h-96 overflow-auto rounded-md bg-black/20 p-2 font-mono text-[11px] leading-4 text-toned"
      data-answer-raw
    >{{ raw }}</pre>

    <dl
      v-else-if="tab === 'headers'"
      class="grid max-h-96 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 overflow-auto rounded-md bg-black/20 p-2 font-mono text-[11px] leading-4"
      data-answer-headers
    >
      <template
        v-for="[name, value] in headerList"
        :key="name"
      >
        <dt class="text-dimmed">
          {{ name }}
        </dt>
        <dd
          class="min-w-0 break-all text-toned"
          :data-answer-header="name"
        >
          {{ value }}
        </dd>
      </template>
    </dl>
  </div>
</template>
