<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { answeredImports, useDataSidebarTab } from '../../editor/dataSidebar.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { FOCUS_RING } from '../../editorUi.ts'
import { NEW_CONNECTION_URL } from '../../shared/dataModel.ts'

/**
 * The Data view sidebar, Framer CMS's: Collections / Fields as text tabs. Collections lists
 * **Collections** (entities stored by the app: its database or memory, then `+ Add…` for an
 * inline name) and **Synced**: each connection (a REST data source) as a folder of its
 * collections. The Synced `+` makes a new connection (an inline name, then the base URL in the
 * right panel) or opens the Import from URL dialog (also opened by each `editor.importRequest`).
 * Fields edits the shown collection's fields. The raw model files stay on the Model screen.
 */
const editor = useEditor()
const tab = useDataSidebarTab()
const TABS = [{ value: 'collections', label: 'Collections' }, { value: 'fields', label: 'Fields' }] as const

const internal = computed(() => editor.collections.filter(entry => entry.kind !== 'rest'))
const connections = computed(() => editor.connections)

const newName = ref('')
const adding = ref(false)
const fromApi = ref(false)
const connectionName = ref('')
const addingConnection = ref(false)
/** The connection whose `+ Add…` opened the new collection dialog. */
const addingTo = ref<string | null>(null)
const addingToConnection = computed(() => connections.value.find(entry => entry.id === addingTo.value))

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
  const result = await editor.run('datasource_create', { name, kind: 'rest', defaults: { baseUrl: NEW_CONNECTION_URL } }) as { datasourceId: string } | undefined
  if (result) {
    editor.connectionId = result.datasourceId
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
  if (await editor.createCollection(name)) {
    newName.value = ''
    adding.value = false
  }
}

function cancelAdd() {
  adding.value = false
  newName.value = ''
}
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
        class="h-7 rounded-lg px-2.5 text-[12px] font-[550] transition-colors"
        :class="[FOCUS_RING, tab === item.value ? 'bg-white/8 text-highlighted' : 'text-muted hover:text-default']"
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
          :count="editor.collectionCounts[collection.id]"
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
            class="flex h-9 w-full items-center gap-2.5 rounded-lg ps-3 text-left text-[12px] text-muted hover:bg-white/4 hover:text-toned"
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
          :counts="editor.collectionCounts"
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
        <p
          v-if="!connections.length && !addingConnection"
          class="ps-3.5 pe-3 py-1.5 text-xs text-dimmed"
        >
          Connect an API with +.
        </p>
      </section>

      <RouterLink
        to="/model"
        class="mt-3 flex h-9 items-center gap-2.5 rounded-lg ms-2 ps-3 pe-3 text-[12px] text-dimmed hover:bg-white/4 hover:text-toned"
        :class="FOCUS_RING"
        title="Edit the entities, repositories and data sources as raw files"
        data-raw-model
      >
        <UIcon
          name="i-lucide-file-json"
          class="size-4 shrink-0"
        />
        Raw model files
      </RouterLink>
    </div>

    <DataApiSource
      v-model:open="fromApi"
      title="Import from API"
      description="Paste a JSON endpoint, review the proposed mapping, then save. The rows stay live and read-only."
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
