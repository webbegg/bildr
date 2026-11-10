<script setup lang="ts">
import { mapItems } from '#shared/data/apiSource'
import type { ApiField } from '#shared/data/apiSource'
import type { PageTwo } from '#shared/data/paging'
import { endpointPathProblem } from '#shared/data/remote'
import { fieldLabel } from '#shared/document/factory'
import type { Collection, Connection, ConnectionSource, Paging } from '#shared/document/schema'
import { mappingFields, mappingProblems, mappingRow } from './DataMappingTable.vue'
import type { MappingRow } from './DataMappingTable.vue'

/**
 * The dialog for a collection read through a connection: its list endpoint
 * (GET and a path), a Test that calls `endpoint_test` and proposes fields, the
 * mapping with a preview, then Save in the footer. Without `collection` it
 * creates one in `connection`; with it, it saves that collection's list
 * endpoint and mapping. A paging the Test proposes (or the saved one) is
 * saved with it unless switched off. Each opening starts from the saved state.
 */
const props = defineProps<{ connection: Connection, collection?: Collection, title: string, description?: string }>()
const open = defineModel<boolean>('open', { default: false })
const editor = useEditor()
const toast = useToast()

interface ListTest {
  status: number
  itemsPath?: string
  fields: ApiField[]
  items?: unknown[]
  total?: number
  paging?: Paging | null
  pageTwo?: PageTwo
  pagingTotal?: number
}

const source = computed(() => (props.collection?.source.type === 'connection' ? props.collection.source : undefined))
const name = ref('')
const path = ref('/')
const itemsPath = ref('')
const rows = ref<MappingRow[]>([])
const items = shallowRef<unknown[]>([])
const status = ref<number | null>(null)
const total = ref<number | null>(null)
const testing = ref(false)
const saving = ref(false)
const error = ref('')
const paging = ref<Paging | null>(null)
const pageTwo = ref<PageTwo | null>(null)
/** The API's own total (at the paging's `totalPath`), when it has one. */
const pagingTotal = ref<number | null>(null)
const usePaging = ref(true)
/** Whether `paging` was saved or edited, so a Test keeps it instead of proposing one. */
const pagingChosen = ref(false)
/** The path and items path the current mapping is for; testing another proposes new fields. */
let mappedFor = ''

function reset() {
  const list = source.value?.endpoints.list
  paging.value = list?.paging ?? null
  pagingChosen.value = !!list?.paging
  pageTwo.value = null
  pagingTotal.value = null
  usePaging.value = true
  name.value = ''
  path.value = list?.path ?? '/'
  itemsPath.value = list?.itemsPath ?? ''
  rows.value = props.collection?.fields.map(mappingRow) ?? []
  items.value = []
  status.value = null
  total.value = null
  error.value = ''
  mappedFor = list ? JSON.stringify([list.path, list.itemsPath ?? '']) : ''
}

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
    if (pagingChosen.value && paging.value) input.paging = paging.value
    const result = await callAction<ListTest>('endpoint_test', input)
    status.value = result.status
    if (!result.items) {
      error.value = 'The response has no list of items; set the items path to point at one.'
      return
    }
    itemsPath.value = result.itemsPath ?? ''
    items.value = result.items
    total.value = result.total ?? result.items.length
    if (!pagingChosen.value) paging.value = result.paging ?? null
    pageTwo.value = result.pageTwo ?? null
    pagingTotal.value = result.pagingTotal ?? null
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
  if (props.collection) return
  status.value = null
  pagingChosen.value = false
}

const problems = computed(() => mappingProblems(rows.value))
const fields = computed(() => mappingFields(rows.value))
const valid = computed(() => !pathProblem.value && problems.value.every(p => !p) && fields.value.length > 0)
const preview = computed(() => (valid.value ? mapItems(items.value, fields.value) : []))
const canSave = computed(() => valid.value && (!!props.collection || !!name.value.trim()))

async function save() {
  if (!canSave.value) return
  saving.value = true
  const list = {
    method: source.value?.endpoints.list?.method ?? 'GET',
    path: path.value.trim(),
    ...(itemsPath.value.trim() ? { itemsPath: itemsPath.value.trim() } : {}),
    ...(usePaging.value && paging.value ? { paging: paging.value } : {})
  }
  const next: ConnectionSource = source.value
    ? { ...source.value, endpoints: { ...source.value.endpoints, list } }
    : { type: 'connection', connectionId: props.connection.id, endpoints: { list } }
  const body = { source: next, fields: fields.value }
  const result = props.collection
    ? await editor.run('collection_update', { collection: props.collection.id, ...body })
    : await editor.run<{ collectionId: string }>('collection_create', { name: name.value.trim(), ...body })
  saving.value = false
  if (!result) return
  if (!props.collection) editor.collectionId = (result as { collectionId: string }).collectionId
  toast.add({ title: props.collection ? 'Mapping saved' : 'Collection created', icon: 'i-lucide-check', color: 'success' })
  open.value = false
}

watch(open, (isOpen) => {
  if (!isOpen) return
  reset()
  if (props.collection && source.value?.endpoints.list) void test()
}, { immediate: true })
</script>

<template>
  <EditorModal
    v-model:open="open"
    :title="title"
    :description="description"
    width="xl"
  >
    <div
      class="space-y-6"
      data-connection-source
    >
      <div class="max-w-3xl space-y-3">
        <EditorFormRow
          v-if="!collection"
          label="Name"
          help="Proposed from the path when left empty"
        >
          <EditorInput
            v-model="name"
            placeholder="Posts"
            autofocus
            data-api-name
          />
        </EditorFormRow>
        <form @submit.prevent="test()">
          <EditorFormRow
            label="List endpoint"
            :help="`Relative to ${connection.baseUrl}`"
            :error="path.trim() && pathProblem ? pathProblem : undefined"
          >
            <span class="flex h-[30px] shrink-0 items-center rounded-lg bg-elevated px-2.5 font-mono text-[11px] font-semibold text-toned">GET</span>
            <EditorInput
              v-model="path"
              mono
              placeholder="/posts"
              :invalid="!!path.trim() && !!pathProblem"
              aria-label="List endpoint path"
              data-endpoint-path="list"
              @update:model-value="onPathChange"
            />
            <EditorButton
              type="submit"
              variant="primary"
              label="Test"
              icon="i-lucide-play"
              :loading="testing"
              :disabled="!!pathProblem"
              class="shrink-0"
              data-endpoint-test="list"
            />
          </EditorFormRow>
        </form>
        <EditorFormRow
          v-if="status !== null"
          label="Response"
        >
          <p
            class="flex items-center gap-2 text-[13px] text-muted"
            data-endpoint-status
          >
            <span
              class="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold"
              :class="status < 300 ? 'bg-success/12 text-success' : 'bg-error/12 text-error'"
            >{{ status }}</span>
            <template v-if="total !== null">
              {{ total }} items in the response
            </template>
          </p>
        </EditorFormRow>
        <p
          v-if="error"
          class="ms-[132px] flex items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
          role="alert"
          data-api-error
        >
          <UIcon
            name="i-lucide-circle-alert"
            class="size-4 shrink-0"
          />
          {{ error }}
        </p>
        <EditorFormRow
          v-if="total !== null || collection"
          label="Items path"
          help="Where the list is in the response; empty for a root array"
        >
          <EditorInput
            v-model="itemsPath"
            mono
            placeholder="data"
            aria-label="Items path"
            data-api-items-path
            @keydown.enter.prevent="test()"
          />
        </EditorFormRow>
        <DataPagingDetected
          v-model:paging="paging"
          v-model:use="usePaging"
          :page-two="pageTwo"
          :total="pagingTotal"
          :detected="!pagingChosen"
          @update:paging="pagingChosen = true; pageTwo = null; pagingTotal = null"
        />
      </div>

      <template v-if="total !== null || collection">
        <DataMappingTable
          v-model="rows"
          :problems="problems"
        />
        <DataMappingPreview
          :fields="fields"
          :rows="preview"
          :valid="valid"
        />
      </template>
    </div>

    <template #footer>
      <EditorButton
        label="Cancel"
        @click="open = false"
      />
      <EditorButton
        variant="primary"
        :label="collection ? 'Save mapping' : 'Save collection'"
        icon="i-lucide-check"
        :loading="saving"
        :disabled="!canSave"
        data-api-save
        @click="save"
      />
    </template>
  </EditorModal>
</template>
