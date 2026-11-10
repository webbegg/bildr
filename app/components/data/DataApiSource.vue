<script setup lang="ts">
import { mapItems } from '#shared/data/apiSource'
import type { ApiField } from '#shared/data/apiSource'
import { fieldLabel } from '#shared/document/factory'
import type { Collection } from '#shared/document/schema'
import { mappingFields, mappingProblems, mappingRow } from './DataMappingTable.vue'
import type { MappingRow } from './DataMappingTable.vue'

/**
 * The "From API" flow: fetch a JSON endpoint, review and edit the proposed
 * mapping with a live preview, then save it as a new collection (or, given
 * `collection`, as that API collection's new mapping). The preview maps the
 * fetched items in the browser with the same `mapItems` the server uses.
 */
const props = defineProps<{ collection?: Collection }>()
const emit = defineEmits<{ done: [] }>()
const editor = useEditor()
const toast = useToast()

interface Preview {
  itemsPath: string
  fields: ApiField[]
  items: unknown[]
  total: number
}

const source = props.collection?.source.type === 'api' ? props.collection.source : undefined
const url = ref(source?.url ?? '')
const itemsPath = ref(source?.itemsPath ?? '')
const rows = ref<MappingRow[]>(props.collection?.fields.map(mappingRow) ?? [])
const items = shallowRef<unknown[]>([])
const total = ref<number | null>(null)
const name = ref('')
const fetching = ref(false)
const saving = ref(false)
const error = ref('')
/** The URL and items path the current mapping is for; fetching another proposes new fields. */
let mappedFor = source ? JSON.stringify([source.url, source.itemsPath]) : ''

/** `https://rickandmortyapi.com/api/character` → `Character`. */
function nameFromUrl(value: string): string {
  try {
    const last = new URL(value).pathname.split('/').filter(Boolean).at(-1) ?? ''
    return fieldLabel(last.replace(/[^a-zA-Z0-9]+/g, ' ').trim()) || 'API data'
  } catch {
    return 'API data'
  }
}

/** Fetches the URL; the proposed fields replace the mapping only for a new URL or items path. */
async function fetchPreview() {
  error.value = ''
  fetching.value = true
  try {
    const input: Record<string, unknown> = { projectId: editor.projectId, url: url.value.trim() }
    if (source?.headers) input.headers = source.headers
    if (total.value !== null || props.collection) input.itemsPath = itemsPath.value.trim()
    const preview = await callAction<Preview>('api_source_preview', input)
    itemsPath.value = preview.itemsPath
    items.value = preview.items
    total.value = preview.total
    const fetched = JSON.stringify([url.value.trim(), preview.itemsPath])
    if (fetched !== mappedFor || !rows.value.length) rows.value = preview.fields.map(mappingRow)
    mappedFor = fetched
    if (!name.value) name.value = nameFromUrl(url.value)
  } catch (failure) {
    error.value = actionErrorMessage(failure)
  } finally {
    fetching.value = false
  }
}

/** A fresh fetch of a new URL detects the items path again. */
function onUrlChange() {
  if (!props.collection) total.value = null
}

const problems = computed(() => mappingProblems(rows.value))
const fields = computed(() => mappingFields(rows.value))
const valid = computed(() => problems.value.every(p => !p) && fields.value.length > 0)
const preview = computed(() => (valid.value ? mapItems(items.value, fields.value) : []))

async function save() {
  saving.value = true
  // Headers set by an agent (api_source_preview, collection_update) stay.
  const body = { source: { type: 'api', url: url.value.trim(), itemsPath: itemsPath.value.trim(), ...(source?.headers ? { headers: source.headers } : {}) }, fields: fields.value }
  const result = props.collection
    ? await editor.run('collection_update', { collection: props.collection.id, ...body })
    : await editor.run<{ collectionId: string }>('collection_create', { name: name.value.trim(), ...body })
  saving.value = false
  if (!result) return
  if (!props.collection) editor.collectionId = (result as { collectionId: string }).collectionId
  toast.add({ title: props.collection ? 'Mapping saved' : 'Collection created', icon: 'i-lucide-check', color: 'success' })
  emit('done')
}

onMounted(() => {
  if (props.collection) void fetchPreview()
})
</script>

<template>
  <div
    class="space-y-4"
    data-api-source
  >
    <form
      class="flex items-end gap-2"
      @submit.prevent="fetchPreview()"
    >
      <UFormField
        label="API URL"
        size="xs"
        help="A public JSON endpoint (GET, no auth)"
        class="flex-1"
      >
        <UInput
          v-model="url"
          placeholder="https://rickandmortyapi.com/api/character"
          class="w-full"
          data-api-url
          @update:model-value="onUrlChange"
        />
      </UFormField>
      <UButton
        type="submit"
        :label="collection || total !== null ? 'Refetch' : 'Fetch'"
        icon="i-lucide-download"
        :loading="fetching"
        :disabled="!url.trim()"
        data-api-fetch
        class="mb-5"
      />
    </form>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-circle-alert"
      :description="error"
      data-api-error
    />

    <template v-if="total !== null || collection">
      <div class="flex items-end gap-3">
        <UFormField
          label="Items path"
          size="xs"
          help="Where the list is in the response; empty for a root array"
          class="w-64"
        >
          <UInput
            v-model="itemsPath"
            placeholder="results"
            class="w-full"
            data-api-items-path
            @keydown.enter.prevent="fetchPreview()"
          />
        </UFormField>
        <p
          v-if="total !== null"
          class="mb-6 text-xs text-muted"
        >
          {{ total }} items in the response. Changing the path and fetching proposes new fields.
        </p>
      </div>

      <DataMappingTable
        v-model="rows"
        :problems="problems"
      />
      <DataMappingPreview
        :fields="fields"
        :rows="preview"
        :valid="valid"
      />

      <form
        class="flex items-end justify-end gap-2"
        @submit.prevent="save"
      >
        <UFormField
          v-if="!collection"
          label="Collection name"
          size="xs"
          class="flex-1"
        >
          <UInput
            v-model="name"
            class="w-full"
            data-api-name
          />
        </UFormField>
        <UButton
          type="submit"
          :label="collection ? 'Save mapping' : 'Save collection'"
          icon="i-lucide-check"
          :loading="saving"
          :disabled="!valid || (!collection && !name.trim())"
          data-api-save
        />
      </form>
    </template>
  </div>
</template>
