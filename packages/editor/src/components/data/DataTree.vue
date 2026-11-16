<script setup lang="ts">
import { computed, provide, reactive, ref, useTemplateRef, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { dataItemKey } from '../../editor/dataTabs.ts'
import { FILES_KEY, TREE_STOP, answeredImports, treeItems } from '../../editor/dataTree.ts'
import { rovingTarget } from '../../editor/rovingKeys.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { NEW_CONNECTION_URL } from '../../shared/dataModel.ts'

/**
 * The Data workspace's tree, Framer CMS's: **Collections** (entities stored by the app: its
 * database or memory, then `+ Add…` for an inline name) and **Connections**: each connection (a
 * REST API) as a folder of the collections read through it. Choosing an item shows it in the
 * workspace beside the tree, on the tabs its kind has. The Connections `+` makes a new
 * connection (an inline name, then the base URL in its Endpoints tab) or opens the Import from URL
 * dialog (also opened by each `editor.importRequest`). **All model files** (S3) ends the tree: the artifacts with no
 * collection or connection (pages, queries, actions…) and every file as JSON.
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
const items = computed(() => treeItems(editor.collections, editor.connections, collapsed))

function toggle(id: string) {
  if (!collapsed.delete(id)) collapsed.add(id)
}

const shownKey = computed(() => editor.dataFiles ? FILES_KEY : editor.dataItem ? dataItemKey(editor.dataItem) : null)
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

const connectionMenu: DropdownMenuItem[] = [
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
function connectionMenuClosed(event: Event) {
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
          v-if="!internal.length && !adding"
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
          @add="addingTo = connection.id"
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

      <DataFilesRow />
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
