<script setup lang="ts">
import { mapItems } from '#shared/data/apiSource'
import type { ApiField } from '#shared/data/apiSource'
import { endpointPathProblem } from '#shared/data/remote'
import { fieldLabel } from '#shared/document/factory'
import type { Collection, Connection, ConnectionSource } from '#shared/document/schema'
import { mappingFields, mappingProblems, mappingRow } from './DataMappingTable.vue'
import type { MappingRow } from './DataMappingTable.vue'

/**
 * A collection read through a connection: its list endpoint (GET and a path),
 * a Test that calls `endpoint_test` and proposes fields, the mapping with a
 * preview, then Save. Without `collection` it creates one in `connection`;
 * with it, it saves that collection's list endpoint and mapping.
 */
const props = defineProps<{ connection: Connection, collection?: Collection }>()
const emit = defineEmits<{ done: [] }>()
const editor = useEditor()
const toast = useToast()

interface ListTest {
  status: number
  itemsPath?: string
  fields: ApiField[]
  items?: unknown[]
  total?: number
}

const source = props.collection?.source.type === 'connection' ? props.collection.source : undefined
const name = ref('')
const path = ref(source?.endpoints.list?.path ?? '/')
const itemsPath = ref(source?.endpoints.list?.itemsPath ?? '')
const rows = ref<MappingRow[]>(props.collection?.fields.map(mappingRow) ?? [])
const items = shallowRef<unknown[]>([])
const status = ref<number | null>(null)
const total = ref<number | null>(null)
const testing = ref(false)
const saving = ref(false)
const error = ref('')
/** The path and items path the current mapping is for; testing another proposes new fields. */
let mappedFor = source?.endpoints.list ? JSON.stringify([source.endpoints.list.path, source.endpoints.list.itemsPath ?? '']) : ''

const pathProblem = computed(() => (path.value.trim() ? endpointPathProblem(path.value.trim()) : 'Add a path, e.g. /posts'))

/** `/posts?_limit=10` → `Posts`. */
function nameFromPath(value: string): string {
  const last = value.split('?')[0]!.split('/').filter(Boolean).at(-1) ?? ''
  return fieldLabel(last.replace(/[^a-zA-Z0-9]+/g, ' ').trim()) || props.connection.name
}

async function test() {
  if (pathProblem.value) return
  error.value = ''
  testing.value = true
  try {
    const input: Record<string, unknown> = { projectId: editor.projectId, connectionId: props.connection.id, method: 'GET', path: path.value.trim() }
    if (status.value !== null || props.collection) input.itemsPath = itemsPath.value.trim()
    const result = await callAction<ListTest>('endpoint_test', input)
    status.value = result.status
    if (!result.items) {
      error.value = 'The response has no list of items; set the items path to point at one.'
      return
    }
    itemsPath.value = result.itemsPath ?? ''
    items.value = result.items
    total.value = result.total ?? result.items.length
    const tested = JSON.stringify([path.value.trim(), itemsPath.value])
    if (tested !== mappedFor || !rows.value.length) rows.value = result.fields.map(mappingRow)
    mappedFor = tested
    if (!name.value) name.value = nameFromPath(path.value)
  } catch (failure) {
    error.value = actionErrorMessage(failure)
  } finally {
    testing.value = false
  }
}

/** Another path detects the items path again. */
function onPathChange() {
  if (!props.collection) status.value = null
}

const problems = computed(() => mappingProblems(rows.value))
const fields = computed(() => mappingFields(rows.value))
const valid = computed(() => !pathProblem.value && problems.value.every(p => !p) && fields.value.length > 0)
const preview = computed(() => (valid.value ? mapItems(items.value, fields.value) : []))

async function save() {
  saving.value = true
  const list = { method: source?.endpoints.list?.method ?? 'GET', path: path.value.trim(), ...(itemsPath.value.trim() ? { itemsPath: itemsPath.value.trim() } : {}) }
  const next: ConnectionSource = source
    ? { ...source, endpoints: { ...source.endpoints, list } }
    : { type: 'connection', connectionId: props.connection.id, endpoints: { list } }
  const body = { source: next, fields: fields.value }
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
  if (props.collection && source?.endpoints.list) void test()
})
</script>

<template>
  <div
    class="space-y-4"
    data-connection-source
  >
    <UFormField
      v-if="!collection"
      label="Collection name"
      size="xs"
      help="Proposed from the path when left empty"
    >
      <UInput
        v-model="name"
        placeholder="Posts"
        class="w-full"
        autofocus
        data-api-name
      />
    </UFormField>
    <form
      class="flex items-start gap-2"
      @submit.prevent="test()"
    >
      <UFormField
        label="List endpoint"
        size="xs"
        :help="`Relative to ${connection.baseUrl}`"
        :error="path.trim() && pathProblem ? pathProblem : undefined"
        class="flex-1"
      >
        <div class="flex items-center gap-2">
          <span class="flex h-8 shrink-0 items-center rounded-md bg-elevated px-2 font-mono text-xs text-toned">GET</span>
          <UInput
            v-model="path"
            placeholder="/posts"
            class="w-full font-mono"
            data-endpoint-path="list"
            @update:model-value="onPathChange"
          />
        </div>
      </UFormField>
      <UButton
        type="submit"
        label="Test"
        icon="i-lucide-play"
        :loading="testing"
        :disabled="!!pathProblem"
        class="mt-5"
        data-endpoint-test="list"
      />
    </form>
    <p
      v-if="status !== null"
      class="text-xs text-muted"
      data-endpoint-status
    >
      <UBadge
        :label="String(status)"
        :color="status < 300 ? 'success' : 'error'"
        variant="subtle"
        size="sm"
        class="me-1.5 font-mono"
      />
      <template v-if="total !== null">
        {{ total }} items in the response.
      </template>
    </p>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-circle-alert"
      :description="error"
      data-api-error
    />

    <template v-if="total !== null || collection">
      <UFormField
        label="Items path"
        size="xs"
        help="Where the list is in the response; empty for a root array"
        class="w-64"
      >
        <UInput
          v-model="itemsPath"
          placeholder="data"
          class="w-full"
          data-api-items-path
          @keydown.enter.prevent="test()"
        />
      </UFormField>

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
        class="flex justify-end"
        @submit.prevent="save"
      >
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
