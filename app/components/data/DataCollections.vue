<script lang="ts">
/** The last Import from API request each editor's sidebar answered, so a request made before it mounts (⌘K from the Canvas) still opens the dialog. */
const answeredImports = new WeakMap<object, number>()
</script>

<script setup lang="ts">
/**
 * The Data view sidebar, Framer CMS's: **Collections** (stored in bildr) and
 * **Synced** (read live from an API), each a row per collection with its
 * record count, then `+ Add…`: an inline name for a new collection, or the
 * Import from API dialog (also opened by each `editor.importRequest`).
 */
const editor = useEditor()

const internal = computed(() => editor.project?.collections.filter(c => c.source.type === 'internal') ?? [])
const synced = computed(() => editor.project?.collections.filter(c => c.source.type === 'api') ?? [])

const newName = ref('')
const adding = ref(false)
const fromApi = ref(false)

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

watch(() => JSON.stringify(editor.project?.collections.map(c => (c.source.type === 'api' ? [c.id, c.source] : c.id)) ?? []), () => void loadCounts(), { immediate: true })

// The shown collection's count follows its records as they are added or deleted.
watch(() => editor.recordsTotal, (total) => {
  const shown = editor.collection
  if (shown && !editor.recordsError) counts.value = { ...counts.value, [shown.id]: total }
})
</script>

<template>
  <div class="overflow-y-auto pb-2">
    <section data-collections-internal>
      <p class="ps-3.5 pe-2 pt-3 pb-1.5 text-sm font-semibold text-highlighted">
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
        <UInput
          v-model="newName"
          size="sm"
          placeholder="Collection name"
          autofocus
          class="w-full"
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
          class="flex h-8 w-full items-center gap-2.5 rounded-lg ps-3 text-left text-sm text-dimmed hover:bg-white/4 hover:text-toned"
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

    <div class="mx-3.5 my-2 border-t border-default" />

    <section data-collections-synced>
      <p class="ps-3.5 pe-2 pt-1.5 pb-1.5 text-sm font-semibold text-highlighted">
        Synced
      </p>
      <DataCollectionRow
        v-for="collection in synced"
        :key="collection.id"
        :collection="collection"
        :count="counts[collection.id]"
      />
      <div class="px-2">
        <button
          type="button"
          class="flex h-8 w-full items-center gap-2.5 rounded-lg ps-3 text-left text-sm text-dimmed hover:bg-white/4 hover:text-toned"
          title="Import from API"
          data-from-api
          @click="fromApi = true"
        >
          <UIcon
            name="i-lucide-plus"
            class="size-4 shrink-0"
          />
          Add…
        </button>
      </div>
    </section>

    <UModal
      v-model:open="fromApi"
      title="Import from API"
      description="Paste a JSON endpoint, review the proposed mapping, then save. The records stay live and read-only."
      :ui="{ content: 'sm:max-w-5xl' }"
    >
      <template #body>
        <DataApiSource @done="fromApi = false" />
      </template>
    </UModal>
  </div>
</template>
