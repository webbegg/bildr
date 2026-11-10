<script setup lang="ts">
import { defaultEndpoint } from '#shared/data/collections'
import type { PageTwo } from '#shared/data/paging'
import { pageTwoText, pagingSummary } from '#shared/data/table'
import { DEFAULT_ID_PATH, ENDPOINT_METHODS, ENDPOINT_OPERATIONS, endpointPathProblem, OPERATION_LABELS } from '#shared/data/remote'
import type { EndpointMethod, EndpointOperation } from '#shared/data/remote'
import type { Collection, Connection, ConnectionEndpoints, ConnectionSource, Paging } from '#shared/document/schema'

/**
 * A connection collection's Endpoints section: one row per operation with a
 * path (checked as typed) holding its verb chip, and Test; the row's `−` removes it and the
 * header `+` adds a missing one with its REST default next to the list path.
 * Then the id path and Edit mapping. Every change is one `collection_update`
 * of the source. Test runs `endpoint_test`; any verb but GET asks first,
 * naming the record it uses. List and Get always use GET. Under List, the
 * Paging rows: Test reads page two with the saved paging, Detect saves the
 * paging `endpoint_test` proposes.
 */
const props = defineProps<{ collection: Collection, source: ConnectionSource }>()
const editor = useEditor()

const connection = computed<Connection | undefined>(() => editor.project?.connections.find(c => c.id === props.source.connectionId))
const operations = computed(() => ENDPOINT_OPERATIONS.filter(op => props.source.endpoints[op]))
const menu = computed(() => ENDPOINT_OPERATIONS.filter(op => !props.source.endpoints[op]).map(op => ({ id: op, label: OPERATION_LABELS[op] })))

/** Paths being typed, by operation; each is checked live and saved on change. */
const drafts = ref<Partial<Record<EndpointOperation, string>>>({})
const results = ref<Partial<Record<EndpointOperation, { ok: boolean, text: string }>>>({})
const testing = ref<EndpointOperation | null>(null)
const editingMapping = ref(false)
const pagingResult = ref<{ ok: boolean, text: string } | null>(null)
const pagingBusy = ref<'test' | 'detect' | null>(null)

watch(() => props.collection.id, () => {
  drafts.value = {}
  results.value = {}
  pagingResult.value = null
})

/** The verb is a compact chip inside the path field, so the path gets the rest of the row. */
const PATH_UI = { ...VARIABLE_FIELD_UI, base: 'ps-[50px] pe-8', leading: 'ps-[3px]' }
const VERB_UI = { base: 'h-6 justify-center rounded-md bg-white/6 px-0.5 text-[10.5px] font-semibold text-toned', trailing: 'hidden', content: 'min-w-24' }

const isRead = (op: EndpointOperation) => op === 'list' || op === 'get'
const methodOf = (op: EndpointOperation): EndpointMethod => (isRead(op) ? 'GET' : props.source.endpoints[op]?.method ?? 'GET')
const pathOf = (op: EndpointOperation) => drafts.value[op] ?? props.source.endpoints[op]?.path ?? ''
const problemOf = (op: EndpointOperation) => {
  const path = pathOf(op).trim()
  return path ? endpointPathProblem(path) : 'Add a path, e.g. /posts'
}

function save(patch: Partial<ConnectionSource>) {
  return editor.run('collection_update', { collection: props.collection.id, source: { ...props.source, ...patch } })
}

function saveEndpoints(endpoints: ConnectionEndpoints) {
  return save({ endpoints })
}

function setMethod(op: EndpointOperation, method: EndpointMethod) {
  const endpoint = props.source.endpoints[op]
  if (endpoint && endpoint.method !== method) void saveEndpoints({ ...props.source.endpoints, [op]: { ...endpoint, method } })
}

async function commitPath(op: EndpointOperation) {
  const endpoint = props.source.endpoints[op]
  const path = pathOf(op).trim()
  if (!endpoint || problemOf(op) || path === endpoint.path) return
  if (await saveEndpoints({ ...props.source.endpoints, [op]: { ...endpoint, path } })) resetDraft(op)
}

function resetDraft(op: EndpointOperation) {
  drafts.value = { ...drafts.value, [op]: undefined }
}

function add(op: string) {
  const operation = op as EndpointOperation
  void saveEndpoints({ ...props.source.endpoints, [operation]: defaultEndpoint(operation, props.source.endpoints.list?.path) })
}

function remove(op: EndpointOperation) {
  const { [op]: _removed, ...endpoints } = props.source.endpoints
  resetDraft(op)
  results.value = { ...results.value, [op]: undefined }
  void saveEndpoints(endpoints)
}

function setIdPath(value: string) {
  const { idPath: _idPath, ...rest } = props.source
  const idPath = value.trim()
  void editor.run('collection_update', { collection: props.collection.id, source: idPath && idPath !== DEFAULT_ID_PATH ? { ...rest, idPath } : rest })
}

interface TestResult { status: number, total?: number, items?: unknown[], item?: unknown, paging?: Paging | null, pageTwo?: PageTwo }

function savePaging(paging: Paging | null) {
  const list = props.source.endpoints.list
  if (!list) return
  const { paging: _paging, ...rest } = list
  pagingResult.value = null
  return saveEndpoints({ ...props.source.endpoints, list: paging ? { ...rest, paging } : rest })
}

/** Test reads page two with the saved paging; Detect asks without one and saves the proposal. */
async function testPaging(detect: boolean) {
  const list = props.source.endpoints.list
  if (!list || problemOf('list')) return
  const input: Record<string, unknown> = { projectId: editor.projectId, connectionId: props.source.connectionId, method: 'GET', path: list.path }
  if (list.itemsPath !== undefined) input.itemsPath = list.itemsPath
  if (!detect && list.paging) input.paging = list.paging
  pagingBusy.value = detect ? 'detect' : 'test'
  pagingResult.value = null
  try {
    const result = await callAction<TestResult>('endpoint_test', input)
    if (detect && !result.paging) {
      pagingResult.value = { ok: false, text: 'No paging detected' }
      return
    }
    if (detect && result.paging) await savePaging(result.paging)
    const page = result.pageTwo ? pageTwoText(result.pageTwo) : { ok: false, text: 'Choose a paging type to read page 2' }
    pagingResult.value = detect && result.paging ? { ok: page.ok, text: `${pagingSummary(result.paging)} · ${page.text}` } : page
  } catch (error) {
    pagingResult.value = { ok: false, text: actionErrorMessage(error) }
  } finally {
    pagingBusy.value = null
  }
}

async function test(op: EndpointOperation) {
  const endpoint = props.source.endpoints[op]
  if (!endpoint || problemOf(op)) return
  const path = pathOf(op).trim()
  const id = editor.records[0]?.id
  if (path.includes('{id}') && !id) {
    results.value = { ...results.value, [op]: { ok: false, text: 'The path needs a record id: load the list first' } }
    return
  }
  const record = path.includes('{id}') ? ` for record ${id}` : ''
  const method = methodOf(op)
  if (method !== 'GET' && !confirm(`This sends a real ${method} request${record} to ${connection.value?.baseUrl ?? 'the API'}. It can change data there, and it cannot be undone.`)) return
  const input: Record<string, unknown> = { projectId: editor.projectId, connectionId: props.source.connectionId, method, path }
  if (path.includes('{id}')) input.id = id
  if (method !== 'GET') input.confirm = true
  if (op === 'list' && 'itemsPath' in endpoint && endpoint.itemsPath !== undefined) input.itemsPath = endpoint.itemsPath
  if (op !== 'list' && 'itemPath' in endpoint && endpoint.itemPath !== undefined) input.itemPath = endpoint.itemPath
  testing.value = op
  try {
    const result = await callAction<TestResult>('endpoint_test', input)
    const detail = result.total !== undefined ? `${result.total} ${result.total === 1 ? 'item' : 'items'}` : id && path.includes('{id}') ? `record ${id}` : 'one item'
    results.value = { ...results.value, [op]: { ok: result.status < 300, text: `${result.status} · ${detail}` } }
  } catch (error) {
    results.value = { ...results.value, [op]: { ok: false, text: actionErrorMessage(error) } }
  } finally {
    testing.value = null
  }
}
</script>

<template>
  <EditorStyleSection
    label="Endpoints"
    :menu="menu"
    @add="add"
  >
    <template
      v-for="op in operations"
      :key="op"
    >
      <EditorRow
        :label="OPERATION_LABELS[op]"
        :title="`${OPERATION_LABELS[op]} endpoint`"
        :name="`endpoint-${op}`"
        removable
        :data-endpoint="op"
        @remove="remove(op)"
      >
        <EditorInput
          :model-value="pathOf(op)"
          mono
          :invalid="!!problemOf(op)"
          :aria-label="`${OPERATION_LABELS[op]} path`"
          placeholder="/posts"
          :ui="PATH_UI"
          class="min-w-0 flex-1"
          :data-endpoint-path="op"
          @update:model-value="drafts[op] = $event"
          @change="commitPath(op)"
          @keydown.esc="resetDraft(op)"
        >
          <template #leading>
            <EditorSelect
              :model-value="methodOf(op)"
              :items="ENDPOINT_METHODS"
              mono
              :disabled="isRead(op)"
              :title="isRead(op) ? 'List and Get endpoints use GET' : undefined"
              :aria-label="`${OPERATION_LABELS[op]} method`"
              :ui="VERB_UI"
              :content="{ align: 'start' }"
              class="w-11 shrink-0"
              data-endpoint-method
              @update:model-value="setMethod(op, $event as EndpointMethod)"
            />
          </template>
          <template #trailing>
            <EditorVariablePicker
              secrets
              @insert="drafts[op] = $event; commitPath(op)"
            />
          </template>
        </EditorInput>
        <UTooltip :text="methodOf(op) === 'GET' ? 'Test' : `Test (sends a real ${methodOf(op)})`">
          <EditorButton
            icon="i-lucide-play"
            variant="ghost"
            size="xs"
            :aria-label="`Test ${OPERATION_LABELS[op]}`"
            :loading="testing === op"
            :disabled="!!problemOf(op)"
            :data-endpoint-test="op"
            @click="test(op)"
          />
        </UTooltip>
        <template
          v-if="problemOf(op) || results[op]"
          #below
        >
          <p
            v-if="problemOf(op)"
            class="text-[11px] leading-4 text-error"
            data-endpoint-problem
          >
            {{ problemOf(op) }}
          </p>
          <p
            v-else-if="results[op]"
            class="truncate text-[11px] leading-4"
            :class="results[op]!.ok ? 'text-success' : 'text-error'"
            :title="results[op]!.text"
            data-endpoint-result
          >
            {{ results[op]!.text }}
          </p>
        </template>
      </EditorRow>
      <DataPagingFields
        v-if="op === 'list'"
        :paging="source.endpoints.list?.paging"
        @change="savePaging"
      >
        <template #actions>
          <UTooltip text="Detect the paging">
            <EditorButton
              icon="i-lucide-wand-sparkles"
              variant="ghost"
              size="xs"
              aria-label="Detect the paging"
              :loading="pagingBusy === 'detect'"
              :disabled="!!problemOf('list') || pagingBusy !== null"
              data-paging-detect
              @click="testPaging(true)"
            />
          </UTooltip>
          <UTooltip text="Test page 2">
            <EditorButton
              icon="i-lucide-play"
              variant="ghost"
              size="xs"
              aria-label="Test page 2"
              :loading="pagingBusy === 'test'"
              :disabled="!!problemOf('list') || !source.endpoints.list?.paging || pagingBusy !== null"
              data-paging-test
              @click="testPaging(false)"
            />
          </UTooltip>
        </template>
        <p
          v-if="pagingResult"
          class="ms-24 truncate text-[11px] leading-4"
          :class="pagingResult.ok ? 'text-success' : 'text-error'"
          :title="pagingResult.text"
          data-paging-result
        >
          {{ pagingResult.text }}
        </p>
      </DataPagingFields>
    </template>
    <p
      v-if="!operations.length"
      class="text-xs text-dimmed"
    >
      No endpoints. Add one with +.
    </p>
    <EditorRow
      label="Id path"
      title="Where the record id is in each item"
      name="idPath"
    >
      <EditorCommitInput
        :model-value="source.idPath ?? ''"
        :placeholder="DEFAULT_ID_PATH"
        aria-label="Id path"
        size="xs"
        variant="soft"
        data-id-path
        @commit="setIdPath"
      />
    </EditorRow>
    <EditorButton
      icon="i-lucide-pencil"
      label="Edit mapping"
      block
      :disabled="!connection"
      data-edit-mapping
      @click="editingMapping = true"
    />
    <DataConnectionSource
      v-if="connection"
      v-model:open="editingMapping"
      :connection="connection"
      :collection="collection"
      title="Edit the mapping"
      :description="collection.name"
    />
  </EditorStyleSection>
</template>
