<script setup lang="ts">
import { computed, nextTick, useTemplateRef } from 'vue'
import { DATA_TAB_LABELS } from '../../editor/dataTabs.ts'
import { rovingTarget } from '../../editor/rovingKeys.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { FOCUS_RING } from '../../editorUi.ts'
import DataFiles from './DataFiles.vue'
import DataJson from './DataJson.vue'

/**
 * The Data workspace's centre (S2): the item chosen in the tree, with the tabs its kind has. A
 * collection has Rows (the read-only table), Fields (the field editor, its settings beside it),
 * Endpoints (the repository's, when it is read through a connection) and JSON (its file, S3); a connection has
 * Endpoints (its settings and its collections' endpoints) and JSON. With All model files chosen in the tree it
 * is the list of the model's files and their editor instead. With nothing to show it is
 * the empty start. The tab strip is one tab stop: Left and Right move along it (and wrap), Home and End go to its ends.
 */
const editor = useEditor()
const strip = useTemplateRef<HTMLElement>('strip')

const connection = computed(() => editor.dataConnection)
const collection = computed(() => editor.dataCollection)
const title = computed(() => connection.value?.name ?? collection.value?.name ?? '')
const kind = computed(() => connection.value ? 'Connection' : 'Collection')
const icon = computed(() => connection.value ? 'i-lucide-server' : collection.value?.kind === 'rest' ? 'i-lucide-globe' : 'i-lucide-database')
/** The shown item's own `.bildr/` file: what the JSON tab edits. */
const itemFile = computed(() => {
  const id = connection.value?.id ?? collection.value?.id
  return id ? editor.model?.paths[id] : undefined
})

async function onTabKeyDown(event: KeyboardEvent) {
  const tabs = editor.dataTabs
  const shown = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-data-tab]')?.dataset.dataTab
  const at = tabs.findIndex(tab => tab === shown)
  if (at < 0) return
  const to = rovingTarget(event.key, at, tabs.length, { axis: 'horizontal', wrap: true })
  if (to === null) return
  event.preventDefault()
  const next = tabs[to]!
  editor.dataTab = next
  await nextTick()
  strip.value?.querySelector<HTMLElement>(`[data-data-tab="${next}"]`)?.focus()
}
</script>

<template>
  <div
    class="flex min-w-0 flex-col"
    data-data-workspace
  >
    <DataFiles
      v-if="editor.dataFiles"
      class="min-h-0 flex-1"
    />
    <DataEmpty v-else-if="!editor.dataItem" />
    <template v-else>
      <header class="flex h-12 shrink-0 items-center gap-4 border-b border-default ps-4 pe-3">
        <div
          class="flex min-w-0 items-center gap-2"
          data-data-title
        >
          <UIcon
            :name="icon"
            class="size-4 shrink-0 text-dimmed"
          />
          <h2 class="truncate text-[13px] font-[550] text-highlighted">
            {{ title }}
          </h2>
          <span class="shrink-0 text-[11px] text-dimmed">{{ kind }}</span>
        </div>
        <div
          ref="strip"
          class="flex items-center gap-0.5"
          role="tablist"
          :aria-label="`${title} ${kind.toLowerCase()}`"
          @keydown="onTabKeyDown"
        >
          <button
            v-for="name in editor.dataTabs"
            :id="`data-tab-${name}`"
            :key="name"
            type="button"
            role="tab"
            :aria-selected="editor.dataTab === name"
            aria-controls="data-tabpanel"
            :tabindex="editor.dataTab === name ? 0 : -1"
            class="h-7 rounded-lg px-2.5 text-[12px] font-[550] transition-colors"
            :class="[FOCUS_RING, editor.dataTab === name ? 'bg-white/8 text-highlighted' : 'text-muted hover:text-default']"
            :data-data-tab="name"
            @click="editor.dataTab = name"
          >
            {{ DATA_TAB_LABELS[name] }}
          </button>
        </div>
      </header>

      <div
        id="data-tabpanel"
        class="flex min-h-0 flex-1"
        role="tabpanel"
        :aria-labelledby="`data-tab-${editor.dataTab}`"
        data-data-area
      >
        <div class="min-w-0 flex-1 overflow-hidden">
          <DataRecords
            v-if="editor.dataTab === 'rows' && collection"
            :collection="collection"
            class="size-full"
          />
          <!-- Fields and Endpoints are left-aligned with the header's title and the tab strip, not centred in the area. -->
          <div
            v-else-if="editor.dataTab === 'fields' && collection"
            class="size-full overflow-y-auto"
          >
            <DataFieldsTab
              :collection="collection"
              class="w-full max-w-2xl px-0.5 py-2"
            />
          </div>
          <div
            v-else-if="editor.dataTab === 'endpoints'"
            class="size-full overflow-y-auto"
          >
            <DataConnectionEndpoints
              v-if="connection"
              :connection="connection"
              class="w-full max-w-xl"
            />
            <DataPanelEndpoints
              v-else-if="collection?.kind === 'rest'"
              :collection="collection"
              class="w-full max-w-xl"
            />
            <DataEmptyState
              v-else-if="collection"
              icon="i-lucide-unplug"
              title="No endpoints"
              data-endpoints-empty
            >
              {{ collection.name }} has no endpoints: its rows are stored by the app. Only a collection read through a connection has them.
            </DataEmptyState>
          </div>
          <DataJson
            v-else-if="editor.dataTab === 'json'"
            :key="itemFile"
            :path="itemFile"
            :linked="!!collection"
          />
        </div>
        <DataPanel />
      </div>
    </template>
  </div>
</template>
