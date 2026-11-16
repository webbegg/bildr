<script setup lang="ts">
import { computed, nextTick, useTemplateRef } from 'vue'
import { DATA_TAB_LABELS } from '../../editor/dataLocation.ts'
import type { DataTab } from '../../editor/dataLocation.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { FOCUS_RING } from '../../editorUi.ts'

/**
 * The Data workspace's centre (S2): the item chosen in the tree, with the tabs its kind has. A
 * collection has Rows (the read-only table), Fields (the field editor, its settings beside it),
 * Endpoints (the repository's, when it is read through a connection) and JSON; a connection has
 * Endpoints (its settings and its collections' endpoints) and JSON. With nothing to show it is
 * the empty start. The tab strip is one tab stop: Left, Right, Home and End move along it.
 */
const editor = useEditor()
const strip = useTemplateRef<HTMLElement>('strip')

const connection = computed(() => editor.dataItem?.kind === 'connection' ? editor.connection : null)
const collection = computed(() => editor.dataItem?.kind === 'collection' ? editor.collection : null)
const title = computed(() => connection.value?.name ?? collection.value?.name ?? '')
const kind = computed(() => connection.value ? 'Connection' : 'Collection')
const icon = computed(() => connection.value ? 'i-lucide-server' : collection.value?.kind === 'rest' ? 'i-lucide-globe' : 'i-lucide-database')

async function onTabKeyDown(event: KeyboardEvent) {
  const tabs = editor.dataTabs
  const at = tabs.indexOf((event.target as HTMLElement | null)?.closest<HTMLElement>('[data-data-tab]')?.dataset.dataTab as DataTab)
  if (at < 0) return
  const to = ({ ArrowRight: (at + 1) % tabs.length, ArrowLeft: (at - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 } as Record<string, number | undefined>)[event.key]
  if (to === undefined) return
  event.preventDefault()
  editor.dataTab = tabs[to]!
  await nextTick()
  strip.value?.querySelector<HTMLElement>(`[data-data-tab="${tabs[to]}"]`)?.focus()
}
</script>

<template>
  <div
    class="flex min-w-0 flex-col"
    data-data-workspace
  >
    <DataEmpty v-if="!editor.dataItem" />
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
            class="size-full"
          />
          <div
            v-else-if="editor.dataTab === 'fields' && collection"
            class="size-full overflow-y-auto"
          >
            <DataSidebarFields class="mx-auto w-full max-w-2xl p-2" />
          </div>
          <div
            v-else-if="editor.dataTab === 'endpoints'"
            class="size-full overflow-y-auto"
          >
            <DataConnectionEndpoints
              v-if="connection"
              :connection="connection"
              class="mx-auto w-full max-w-xl"
            />
            <DataPanelEndpoints
              v-else-if="collection?.kind === 'rest'"
              :collection="collection"
              class="mx-auto w-full max-w-xl"
            />
            <div
              v-else-if="collection"
              class="flex size-full items-center justify-center p-6"
              data-endpoints-empty
            >
              <p class="max-w-sm text-center text-xs text-dimmed">
                {{ collection.name }} has no endpoints: its rows are stored by the app. Only a collection read through a connection has them.
              </p>
            </div>
          </div>
          <div
            v-else-if="editor.dataTab === 'json'"
            class="flex size-full items-center justify-center p-6"
            data-testid="data-json-tab"
          >
            <div class="flex max-w-sm flex-col items-center text-center">
              <div class="mb-4 flex size-12 items-center justify-center rounded-xl bg-white/6">
                <UIcon
                  name="i-lucide-file-json"
                  class="size-6 text-toned"
                />
              </div>
              <h3 class="text-base font-[550] text-highlighted">
                JSON
              </h3>
              <p class="mt-1.5 text-[12px] text-muted">
                Coming in a later step. The {{ kind.toLowerCase() }}'s model file will be edited here.
              </p>
            </div>
          </div>
        </div>
        <DataPanel />
      </div>
    </template>
  </div>
</template>
