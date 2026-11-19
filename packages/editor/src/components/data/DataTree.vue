<script setup lang="ts">
import { computed, provide, reactive, ref, useTemplateRef, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { dataItemKey } from '../../editor/dataTabs.ts'
import { TREE_STOP, answeredDataRequests, storeFolded, storedFolded, treeItems } from '../../editor/dataTree.ts'
import type { ArtifactFilters } from '../../editor/dataTree.ts'
import type { ArtifactKind } from '../../shared/dataArtifacts.ts'
import { rovingTarget } from '../../editor/rovingKeys.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { NEW_CONNECTION_URL } from '../../shared/dataModel.ts'

/**
 * The Data workspace's tree, Framer CMS's: **Collections** (stored by the app: its database or
 * Sample data, then `Add…`, which opens the New collection dialog: S7, also opened by a `new-collection` `editor.dataRequest`)
 * and **Connections**: each connection (a
 * REST API) as a folder of the collections read through it. Choosing an item shows it in the
 * workspace beside the tree, on the tabs its kind has. The Connections `+` makes a new
 * connection (an inline name, then the base URL in its Endpoints tab) or opens the Import from URL
 * dialog (also opened by an `import` `editor.dataRequest`). New collection's REST API hands on to a second dialog that finishes the
 * collection (step 2: "New collection from <connection>", or "from a new connection"), with the name typed. **Queries**, **Actions** (S10) and **State** (B2) follow, each with a header that folds it
 * (remembered), a `+` that opens its create dialog, a filter box when it has many items and a `…` menu per row that renames or
 * deletes it (F2 and Delete do too, as on the collection and connection rows). **Migrations** (S6) is listed only while a migration plan
 * is pending and the project has a database, with its number of changes. **All model files** (S3)
 * ends the tree: the artifacts with no collection or connection (pages, components…) and every file as JSON.
 *
 * It is a tree with one tab stop (a roving tabindex: the item that has the focus, else the one shown):
 * Up and Down move between the items and stop at the ends, Home and End go to the first and last,
 * Enter picks, Left collapses a connection (or goes from a collection to its connection) and Right
 * expands it (or goes to its first collection).
 */
const editor = useEditor()
const tree = useTemplateRef<HTMLElement>('tree')

/** The connections folded in the tree, by id. */
const collapsed = reactive(new Set<string>())
/** What each of the Queries, Actions and State sections is filtered by: the tree lists only what it lets through, so the keys move along that. */
const filters = reactive<ArtifactFilters>({ queries: '', actions: '', states: '' })
/** The Queries, Actions and State sections folded, remembered across reloads. */
const folded = reactive(storedFolded())
const items = computed(() => treeItems({ collections: editor.collections, connections: editor.connections, collapsed, artifacts: { queries: editor.queries, actions: editor.actions, states: editor.states }, filters, folded, migrations: editor.dataPlan !== null }))

function toggleSection(kind: ArtifactKind) {
  if (!folded.delete(kind)) folded.add(kind)
  storeFolded(folded)
}

/** The create, rename or delete dialog of a query, an action or a state that is open. */
const creating = ref<ArtifactKind | null>(null)
const renamingArtifact = ref<{ kind: ArtifactKind, id: string } | null>(null)
const deletingArtifact = ref<{ kind: ArtifactKind, id: string } | null>(null)

function toggle(id: string) {
  if (!collapsed.delete(id)) collapsed.add(id)
}

/** The key of the item shown: a special view is the tree's entry of the same name (`FILES_KEY`, `MIGRATIONS_KEY`). */
const shownKey = computed(() => editor.dataSpecial ?? (editor.dataItem ? dataItemKey(editor.dataItem) : null))
const focusedKey = ref<string | null>(null)
/** The tab stop: the item with the focus, else the one shown, else the first: always one that is listed. */
const stop = computed(() => {
  const keys = items.value.map(item => item.key)
  return [focusedKey.value, shownKey.value].find(key => key !== null && keys.includes(key)) ?? keys[0] ?? ''
})
provide(TREE_STOP, stop)
// Choosing an item makes it the stop, whichever item had the focus last.
watch(shownKey, () => {
  focusedKey.value = null
})

const keyOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest<HTMLElement>('[data-tree-item]')?.dataset.treeItem

const focus = (key: string) => [...tree.value?.querySelectorAll<HTMLElement>('[data-tree-item]') ?? []].find(item => item.dataset.treeItem === key)?.focus()

function onFocusIn(event: FocusEvent) {
  focusedKey.value = keyOf(event.target) ?? focusedKey.value
}

function onKeyDown(event: KeyboardEvent) {
  const key = keyOf(event.target)
  const at = items.value.findIndex(item => item.key === key)
  const item = items.value[at]
  if (!item) return
  if (event.key === 'Enter') {
    event.preventDefault()
    ;(event.target as HTMLElement).closest<HTMLElement>('[data-tree-item]')?.click()
    return
  }
  const to = rovingTarget(event.key, at, items.value.length, { axis: 'vertical' })
  if (to !== null) {
    event.preventDefault()
    focus(items.value[to]!.key)
    return
  }
  const id = item.key.slice(item.key.indexOf(':') + 1)
  if (event.key === 'ArrowLeft') {
    if (item.expandable && item.open) collapsed.add(id)
    else if (item.parent) focus(item.parent)
    else return
    event.preventDefault()
  } else if (event.key === 'ArrowRight' && item.expandable) {
    event.preventDefault()
    if (!item.open) collapsed.delete(id)
    else if (items.value[at + 1]?.parent === item.key) focus(items.value[at + 1]!.key)
  }
}

const internal = computed(() => editor.collections.filter(entry => entry.kind !== 'rest'))
const connections = computed(() => editor.connections)

/** The New collection dialog, and the connection whose `Add…` opened it. */
const newCollectionOpen = ref(false)
const newCollectionIn = ref<string | null>(null)

/** What opens the Import from URL dialog: the name New collection took (a new connection was chosen there), if any. */
interface ImportRequest {
  name: string
  fromNewCollection: boolean
}
const importing = ref<ImportRequest | null>(null)
/** The last one, so the dialog keeps its title while it closes. */
const lastImport = ref<ImportRequest>({ name: '', fromNewCollection: false })
watch(importing, (request) => {
  if (request) lastImport.value = request
})

const connectionName = ref('')
const addingConnection = ref(false)
/** What opens the collection dialog of a connection: the connection New collection chose, and the name typed there. */
const addingTo = ref<{ connection: string, name: string } | null>(null)
const addingToConnection = computed(() => connections.value.find(entry => entry.id === addingTo.value?.connection))

/** The last connection asked for, so the dialog keeps its text while it closes. */
const dialogConnection = ref(addingToConnection.value)
watch(addingToConnection, (connection) => {
  if (connection) dialogConnection.value = connection
})

const connectionMenu: DropdownMenuItem[] = [
  { label: 'New connection', icon: 'i-lucide-server', onSelect: () => (addingConnection.value = true) },
  { label: 'Import from URL', icon: 'i-lucide-globe', slot: 'from-api', onSelect: () => openImport() }
]

async function addConnection() {
  const name = connectionName.value.trim()
  if (!name) return
  // The connection made is shown instead of the item: unsaved edits are asked about before anything is written.
  if (!await editor.guardLeave()) return
  const result = await editor.run('datasource_create', { name, kind: 'rest', defaults: { baseUrl: NEW_CONNECTION_URL } }) as { datasourceId: string } | undefined
  if (result) {
    editor.connectionId = result.datasourceId
    cancelConnection()
    return
  }
  // Nothing was made, and the user may just have agreed to discard edits that are still on the screen.
  editor.reportDirtyAgain()
}

function cancelConnection() {
  addingConnection.value = false
  connectionName.value = ''
}

const connectionInput = useTemplateRef<{ focus: () => void }>('connectionInput')

/** The menu hands focus back to its `+` on close, which blurred (and so cancelled) the new connection's name; give it to the name instead. */
function connectionMenuClosed(event: Event) {
  if (!addingConnection.value) return
  event.preventDefault()
  connectionInput.value?.focus()
}

// A dialog asked for (⌘K, the empty state) opens once, even when it was asked for before this tree was made.
watch(() => editor.dataRequest, (request) => {
  if (!request || request.seq <= (answeredDataRequests.get(editor) ?? 0)) return
  answeredDataRequests.set(editor, request.seq)
  if (request.kind === 'import') openImport()
  else openNewCollection(null)
}, { immediate: true })

/** Opens New collection, on REST API with `connection` chosen when it is the one whose `Add…` was used. */
function openNewCollection(connection: string | null) {
  newCollectionIn.value = connection
  newCollectionOpen.value = true
}

/** Opens Import from URL; `name` is what New collection took when a new connection was chosen there (it is step 2 then). */
function openImport(name = '', fromNewCollection = false) {
  importing.value = { name, fromNewCollection }
}

/** Opens the collection dialog of a connection: New collection chose it, and its name stays. */
function openConnectionCollection(request: { connection: string, name: string }) {
  addingTo.value = request
}
</script>

<template>
  <div class="flex flex-col">
    <div
      ref="tree"
      class="min-h-0 flex-1 overflow-y-auto pb-2"
      role="tree"
      aria-label="Data items"
      data-data-tree
      @keydown="onKeyDown"
      @focusin="onFocusIn"
    >
      <section data-collections-internal>
        <p class="ps-3.5 pe-2 pt-3 pb-1 text-xs font-medium text-dimmed">
          Collections
        </p>
        <p
          v-if="!internal.length"
          class="ps-3.5 pe-3 py-1.5 text-xs text-dimmed"
        >
          No collections yet.
        </p>
        <DataCollectionRow
          v-for="collection in internal"
          :key="collection.id"
          :collection="collection"
          :count="editor.collectionCounts[collection.id]"
        />
        <div class="px-2">
          <button
            type="button"
            class="flex h-9 w-full items-center gap-2.5 rounded-lg ps-3 text-left text-[12px] text-muted hover:bg-white/4 hover:text-toned"
            aria-label="Add collection"
            @click="openNewCollection(null)"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-4 shrink-0"
            />
            Add…
          </button>
        </div>
      </section>

      <!--
        S9 keeps the hook names `data-collections-synced` and `data-synced-add` (the e2e and the hosted
        scripts find the Connections section and its `+` by them) although the user sees "Connections".
      -->
      <section
        class="mt-2"
        data-collections-synced
      >
        <div class="flex items-center ps-3.5 pe-3 pt-1 pb-0.5">
          <p class="flex-1 text-xs font-medium text-dimmed">
            Connections
          </p>
          <EditorMenu
            :items="connectionMenu"
            :content="{ align: 'end' }"
            :on-close-auto-focus="connectionMenuClosed"
          >
            <EditorButton
              icon="i-lucide-plus"
              variant="ghost"
              size="xs"
              aria-label="Add connection"
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
          :open="!collapsed.has(connection.id)"
          @add="openNewCollection(connection.id)"
          @toggle="toggle(connection.id)"
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
          No connections yet. Add one with +.
        </p>
      </section>

      <DataArtifactSection
        v-model:filter="filters.queries"
        kind="query"
        :items="editor.queries"
        :folded="folded.has('query')"
        @toggle="toggleSection('query')"
        @create="creating = 'query'"
        @rename="renamingArtifact = { kind: 'query', id: $event }"
        @delete="deletingArtifact = { kind: 'query', id: $event }"
      />
      <DataArtifactSection
        v-model:filter="filters.actions"
        kind="action"
        :items="editor.actions"
        :folded="folded.has('action')"
        @toggle="toggleSection('action')"
        @create="creating = 'action'"
        @rename="renamingArtifact = { kind: 'action', id: $event }"
        @delete="deletingArtifact = { kind: 'action', id: $event }"
      />
      <DataArtifactSection
        v-model:filter="filters.states"
        kind="state"
        :items="editor.states"
        :folded="folded.has('state')"
        @toggle="toggleSection('state')"
        @create="creating = 'state'"
        @rename="renamingArtifact = { kind: 'state', id: $event }"
        @delete="deletingArtifact = { kind: 'state', id: $event }"
      />

      <DataMigrationsRow />
      <DataFilesRow />
    </div>

    <DataArtifactCreate
      :kind="creating"
      @close="creating = null"
    />
    <DataArtifactRename
      :target="renamingArtifact"
      @close="renamingArtifact = null"
    />
    <DataArtifactDelete
      :target="deletingArtifact"
      @close="deletingArtifact = null"
    />

    <DataNewCollection
      v-model:open="newCollectionOpen"
      :connection="newCollectionIn"
      @connection="openConnectionCollection"
      @import="openImport($event.name, true)"
    />

    <DataApiSource
      :open="importing !== null"
      :initial-name="lastImport.name"
      :title="lastImport.fromNewCollection ? 'New collection from a new connection' : 'Import from URL'"
      :description="`${lastImport.fromNewCollection ? 'Step 2 of 2. ' : ''}Paste a JSON endpoint, review the proposed mapping, then save. The rows stay live and read-only.`"
      @update:open="!$event && (importing = null)"
    />

    <DataConnectionSource
      v-if="dialogConnection"
      :open="!!addingToConnection"
      :connection="dialogConnection"
      :initial-name="addingTo?.name"
      :title="`New collection from ${dialogConnection.name}`"
      description="Step 2 of 2. Test the list endpoint, review the proposed fields, then save."
      @update:open="!$event && (addingTo = null)"
    />
  </div>
</template>
