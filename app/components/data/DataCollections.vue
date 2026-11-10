<script lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Ref } from 'vue'

/** A new connection's base URL until it is set in the right panel (connection_create needs one). */
export const NEW_CONNECTION_URL = 'https://api.example.com'

/** The last Import from API request each editor's sidebar answered, so a request made before it mounts (⌘K from the Canvas) still opens the dialog. */
const answeredImports = new WeakMap<object, number>()

export type DataSidebarTab = 'collections' | 'fields'
const tabs = new WeakMap<object, Ref<DataSidebarTab>>()

/** The Data sidebar's tab, one per editor (Collections at first), so the right panel can switch it to Fields. */
export function useDataSidebarTab(): Ref<DataSidebarTab> {
  const editor = useEditor()
  let tab = tabs.get(editor)
  if (!tab) tabs.set(editor, tab = ref<DataSidebarTab>('collections'))
  return tab
}
</script>

<script setup lang="ts">
/**
 * The Data view sidebar, Framer CMS's: Collections / Fields as text tabs.
 * Collections lists **Collections** (stored in bildr, then `+ Add…` for an
 * inline name) and **Synced**: each connection as a folder of its
 * collections, then the legacy one-URL API collections. The Synced `+` makes
 * a new connection (an inline name, then the base URL in the right panel) or
 * opens the Import from URL dialog (also opened by each
 * `editor.importRequest`). Fields edits the shown collection's fields.
 */
const editor = useEditor()
const tab = useDataSidebarTab()
const TABS = [{ value: 'collections', label: 'Collections' }, { value: 'fields', label: 'Fields' }] as const

const internal = computed(() => editor.project?.collections.filter(c => c.source.type === 'internal') ?? [])
const synced = computed(() => editor.project?.collections.filter(c => c.source.type === 'api') ?? [])
const connections = computed(() => editor.project?.connections ?? [])

const newName = ref('')
const adding = ref(false)
const fromApi = ref(false)
const connectionName = ref('')
const addingConnection = ref(false)
/** The connection whose `+ Add…` opened the new collection dialog. */
const addingTo = ref<string | null>(null)
const addingToConnection = computed(() => connections.value.find(c => c.id === addingTo.value))

/** The last connection asked for, so the dialog keeps its text while it closes. */
const dialogConnection = ref(addingToConnection.value)
watch(addingToConnection, (connection) => {
  if (connection) dialogConnection.value = connection
})

const syncedMenu: DropdownMenuItem[] = [
  { label: 'New connection', icon: 'i-lucide-server', onSelect: () => (addingConnection.value = true) },
  { label: 'Import from URL', icon: 'i-lucide-globe', slot: 'from-api', onSelect: () => (fromApi.value = true) }
]

async function addConnection() {
  const name = connectionName.value.trim()
  if (!name) return
  const result = await editor.run<{ connectionId: string }>('connection_create', { name, baseUrl: NEW_CONNECTION_URL })
  if (result) {
    editor.connectionId = result.connectionId
    cancelConnection()
  }
}

function cancelConnection() {
  addingConnection.value = false
  connectionName.value = ''
}

const connectionInput = useTemplateRef<{ focus: () => void }>('connectionInput')

/** The menu hands focus back to its `+` on close, which blurred (and so cancelled) the new connection's name; give it to the name instead. */
function syncedMenuClosed(event: Event) {
  if (!addingConnection.value) return
  event.preventDefault()
  connectionInput.value?.focus()
}

watch(() => editor.importRequest, (request) => {
  if (request > (answeredImports.get(editor) ?? 0)) fromApi.value = true
  answeredImports.set(editor, request)
}, { immediate: true })

async function addCollection() {
  const name = newName.value.trim()
  if (!name) return
  const result = await editor.run<{ collectionId: string }>('collection_create', { name })
  if (result) {
    editor.collectionId = result.collectionId
    newName.value = ''
    adding.value = false
  }
}

function cancelAdd() {
  adding.value = false
  newName.value = ''
}

// Record counts: one `record_list` of 1 per collection (its total), reloaded when the collections or API sources change; API ones that fail show none.
const counts = ref<Record<string, number>>({})
let countLoad = 0

async function loadCounts() {
  const load = ++countLoad
  const entries = await Promise.all((editor.project?.collections ?? []).map(c =>
    callAction<{ total: number }>('record_list', { projectId: editor.projectId, collection: c.id, limit: 1 }).then(r => [[c.id, r.total] as const], () => [])
  ))
  if (load === countLoad) counts.value = Object.fromEntries(entries.flat())
}

watch(() => JSON.stringify([editor.project?.collections.map(c => (c.source.type === 'internal' ? c.id : [c.id, c.source])), editor.project?.connections]), () => void loadCounts(), { immediate: true })

// The shown collection's count follows its records as they are added or deleted.
watch(() => editor.recordsTotal, (total) => {
  const shown = editor.collection
  if (shown && !editor.recordsError) counts.value = { ...counts.value, [shown.id]: total }
})
</script>

<template>
  <div class="flex flex-col">
    <div
      class="flex items-center gap-0.5 border-b border-default p-2"
      role="tablist"
      aria-label="Data sidebar"
    >
      <button
        v-for="item in TABS"
        :key="item.value"
        type="button"
        role="tab"
        :aria-selected="tab === item.value"
        class="h-7 rounded-md px-2.5 text-sm font-medium transition-colors"
        :class="tab === item.value ? 'bg-white/8 text-highlighted' : 'text-muted hover:text-default'"
        :data-data-tab="item.value"
        @click="tab = item.value"
      >
        {{ item.label }}
      </button>
    </div>

    <DataSidebarFields
      v-if="tab === 'fields'"
      class="min-h-0 flex-1"
    />
    <div
      v-show="tab === 'collections'"
      class="min-h-0 flex-1 overflow-y-auto pb-2"
    >
      <section data-collections-internal>
        <p class="ps-3.5 pe-2 pt-3 pb-1 text-xs font-medium text-dimmed">
          Collections
        </p>
        <DataCollectionRow
          v-for="collection in internal"
          :key="collection.id"
          :collection="collection"
          :count="counts[collection.id]"
        />
        <form
          v-if="adding"
          class="px-2"
          @submit.prevent="addCollection"
        >
          <EditorInput
            v-model="newName"
            placeholder="Collection name"
            autofocus
            aria-label="New collection name"
            @keydown.esc="cancelAdd"
            @blur="!newName.trim() && cancelAdd()"
          />
        </form>
        <div
          v-else
          class="px-2"
        >
          <button
            type="button"
            class="flex h-9 w-full items-center gap-2.5 rounded-lg ps-3 text-left text-sm text-muted hover:bg-white/4 hover:text-toned"
            aria-label="Add collection"
            @click="adding = true"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-4 shrink-0"
            />
            Add…
          </button>
        </div>
      </section>

      <section
        class="mt-2"
        data-collections-synced
      >
        <div class="flex items-center ps-3.5 pe-3 pt-1 pb-0.5">
          <p class="flex-1 text-xs font-medium text-dimmed">
            Synced
          </p>
          <EditorMenu
            :items="syncedMenu"
            :content="{ align: 'end' }"
            :on-close-auto-focus="syncedMenuClosed"
          >
            <EditorButton
              icon="i-lucide-plus"
              variant="ghost"
              size="xs"
              aria-label="Add synced data"
              data-synced-add
            />
            <template #from-api-label>
              <span data-from-api>Import from URL</span>
            </template>
          </EditorMenu>
        </div>
        <DataConnectionFolder
          v-for="connection in connections"
          :key="connection.id"
          :connection="connection"
          :counts="counts"
          @add="addingTo = connection.id"
        />
        <form
          v-if="addingConnection"
          class="px-2"
          data-new-connection
          @submit.prevent="addConnection"
        >
          <EditorInput
            ref="connectionInput"
            v-model="connectionName"
            placeholder="Connection name"
            autofocus
            aria-label="New connection name"
            @keydown.esc="cancelConnection"
            @blur="!connectionName.trim() && cancelConnection()"
          />
        </form>
        <DataCollectionRow
          v-for="collection in synced"
          :key="collection.id"
          :collection="collection"
          :count="counts[collection.id]"
        />
        <p
          v-if="!connections.length && !synced.length && !addingConnection"
          class="ps-3.5 pe-3 py-1.5 text-xs text-dimmed"
        >
          Connect an API with +.
        </p>
      </section>
    </div>

    <DataApiSource
      v-model:open="fromApi"
      title="Import from API"
      description="Paste a JSON endpoint, review the proposed mapping, then save. The records stay live and read-only."
    />

    <DataConnectionSource
      v-if="dialogConnection"
      :open="!!addingToConnection"
      :connection="dialogConnection"
      title="New collection"
      :description="`In ${dialogConnection.name}: test the list endpoint, review the proposed fields, then save.`"
      @update:open="!$event && (addingTo = null)"
    />
  </div>
</template>
