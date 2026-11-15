<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { callAction, errorMessage } from '../../api.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { fieldSteps, mapPreview, mappingFields, mappingProblems, mappingRow, mappingRowOf } from '../../shared/dataMapping.ts'
import type { InferredField, MappingRow } from '../../shared/dataMapping.ts'
import { endpointPathProblem, entityProposal, restDefaults } from '../../shared/dataModel.ts'
import type { DataCollection, DataConnection } from '../../shared/dataModel.ts'

/**
 * The dialog for a collection read through a connection. Without `collection` it creates one in
 * `connection`: the list endpoint (GET and a path), a Test that calls `datasource_preview` and
 * proposes fields, the mapping with a preview and optionally the API's other endpoints, then
 * Save, which is one `entity_create`. With `collection` it edits that collection's mapping: the
 * list endpoint is shown as saved (no action changes an endpoint of an existing repository) and
 * Test is `repository_endpoint_test`; Save applies the field changes as `entity_field_*` steps
 * (each one undoable, and a refused one stops the rest). Each opening starts from the saved state.
 *
 * Not in the module: paging (the generated adapter pages by offset), a root-array response (the
 * adapter reads the items from a top-level key), and an id path (an `id` field is the key).
 */
const props = defineProps<{ connection: DataConnection, collection?: DataCollection, title: string, description?: string }>()
const open = defineModel<boolean>('open', { default: false })
const editor = useEditor()
const toast = useToast()

interface ListTest {
  status: number
  itemsPath?: string
  fields: InferredField[]
  items?: unknown[]
  count?: number
}

type Other = 'get' | 'create' | 'update' | 'delete'
const OTHERS: Other[] = ['get', 'create', 'update', 'delete']
const OTHER_LABELS: Record<Other, string> = { get: 'Get', create: 'Create', update: 'Update', delete: 'Delete' }
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const DEFAULT_METHOD: Record<Other, string> = { get: 'GET', create: 'POST', update: 'PUT', delete: 'DELETE' }
const freshOthers = (): Record<Other, { on: boolean, method: string, path: string }> => Object.fromEntries(OTHERS.map(op => [op, { on: false, method: DEFAULT_METHOD[op], path: '' }])) as Record<Other, { on: boolean, method: string, path: string }>

const listEndpoint = computed(() => props.collection?.endpoints.find(endpoint => endpoint.op === 'list'))
const name = ref('')
const nameEdited = ref(false)
const path = ref('/')
const itemsPath = ref('')
const totalPath = ref('')
const rows = ref<MappingRow[]>([])
const items = shallowRef<unknown[]>([])
const status = ref<number | null>(null)
const total = ref<number | null>(null)
const testing = ref(false)
const saving = ref(false)
const error = ref('')
/** The other operations of the API a new collection takes: on, its method and its path (empty: the REST default under the list path). */
const others = reactive(freshOthers())
/** The path and items path the current mapping is for; testing another proposes new fields. */
let mappedFor = ''

function reset() {
  const list = listEndpoint.value
  name.value = ''
  nameEdited.value = false
  path.value = list?.path ?? '/'
  itemsPath.value = list?.itemsPath ?? ''
  totalPath.value = list?.totalPath ?? ''
  rows.value = props.collection?.fields.map(mappingRowOf) ?? []
  items.value = []
  status.value = null
  total.value = null
  error.value = ''
  Object.assign(others, freshOthers())
  mappedFor = list ? JSON.stringify([list.path, list.itemsPath ?? '']) : ''
}

const pathProblem = computed(() => endpointPathProblem(path.value.trim()))
const proposal = computed(() => entityProposal(path.value))
const otherPath = (op: Other) => others[op].path.trim() || restDefaults(op, path.value.trim() || '/').path

async function test() {
  if (pathProblem.value) return
  error.value = ''
  testing.value = true
  try {
    const result = props.collection?.repository
      ? await callAction<ListTest>('repository_endpoint_test', { repository: props.collection.repository, op: 'list' })
      : await callAction<ListTest>('datasource_preview', { datasource: props.connection.id, path: path.value.trim(), ...(status.value !== null ? { itemsPath: itemsPath.value.trim() } : {}) })
    status.value = result.status
    if (!result.items) {
      error.value = 'The response has no list of items; set the items path to point at one.'
      return
    }
    items.value = result.items
    total.value = result.count ?? result.items.length
    if (!props.collection) {
      itemsPath.value = result.itemsPath ?? ''
      const tested = JSON.stringify([path.value.trim(), itemsPath.value])
      if (tested !== mappedFor || !rows.value.length) rows.value = result.fields.map(mappingRow)
      mappedFor = tested
      if (!nameEdited.value) name.value = proposal.value.name
    }
  } catch (failure) {
    error.value = errorMessage(failure)
  } finally {
    testing.value = false
  }
}

/** Another path detects the items path again. */
function onPathChange() {
  if (props.collection) return
  status.value = null
}

const problems = computed(() => mappingProblems(rows.value))
const fields = computed(() => mappingFields(rows.value))
const included = computed(() => rows.value.filter(row => row.include))
/** A key no item of the response has: it would read nothing. */
const notes = computed(() => rows.value.map(row => row.include && items.value.length && !items.value.some(item => typeof item === 'object' && item !== null && Object.hasOwn(item, row.remote.trim())) ? 'No item of the response has this key' : ''))
const preview = computed(() => problems.value.every(problem => !problem) ? mapPreview(items.value, rows.value) : [])
const listProblem = computed(() => !props.collection && !itemsPath.value.trim() && status.value !== null ? 'The generated adapter reads the items from a top-level key of the response (like "items"): a response that is a bare array cannot be mapped yet.' : '')
const valid = computed(() => !pathProblem.value && problems.value.every(problem => !problem) && fields.value.length > 0 && !listProblem.value)
const canSave = computed(() => valid.value && (!!props.collection || (total.value !== null && !!name.value.trim() && OTHERS.every(op => !others[op].on || !endpointPathProblem(otherPath(op))))))

async function create() {
  const typed = name.value.trim()
  const endpoints: Record<string, { path: string, method?: string, itemsPath?: string, totalPath?: string }> = {
    list: { path: path.value.trim(), itemsPath: itemsPath.value.trim(), ...(totalPath.value.trim() ? { totalPath: totalPath.value.trim() } : {}) }
  }
  for (const op of OTHERS.filter(each => others[each].on)) endpoints[op] = { path: otherPath(op), method: others[op].method }
  const plural = typed === proposal.value.name ? proposal.value.plural : undefined
  return await editor.run('entity_create', { name: typed, ...(plural ? { plural } : {}), source: props.connection.id, fields: fields.value, endpoints }) as { entityId: string } | undefined
}

/** The saved fields become the mapping one step at a time; the first refusal stops it, says why and syncs the rows with what was saved. */
async function applyMapping() {
  for (const step of fieldSteps(props.collection!.id, props.collection!.fields, rows.value)) {
    if (!await editor.run(step.name, step.input)) {
      syncRows()
      return false
    }
  }
  return true
}

/** After a refusal partway: the steps already applied are the model's now. Rows of removed fields go, and a field added by hand takes its saved id, so a retry sends only the steps that remain (the edits not yet saved stay). */
function syncRows() {
  const saved = editor.collections.find(entry => entry.id === props.collection?.id)?.fields
  if (!saved) return
  const kept = rows.value.filter(row => !row.id || saved.some(field => field.id === row.id))
  const claimed = new Set(kept.flatMap(row => row.id ? [row.id] : []))
  rows.value = kept.map((row) => {
    if (row.id) return row
    const match = saved.find(field => !claimed.has(field.id) && field.name === row.name.trim() && (field.remote ?? field.name) === row.remote.trim())
    if (!match) return row
    claimed.add(match.id)
    return { ...row, id: match.id }
  })
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  const created = props.collection ? undefined : await create()
  const done = props.collection ? await applyMapping() : !!created
  saving.value = false
  if (!done) {
    error.value = editor.error ?? 'Could not save the mapping'
    return
  }
  if (created) {
    editor.collectionId = created.entityId
    editor.connectionId = null
  }
  toast.add({ title: props.collection ? 'Mapping saved' : 'Collection created', icon: 'i-lucide-check', color: 'success' })
  open.value = false
}

watch(open, (isOpen) => {
  if (!isOpen) return
  reset()
  if (props.collection && listEndpoint.value) void test()
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
            :placeholder="proposal.name"
            autofocus
            data-api-name
            @update:model-value="nameEdited = true"
          />
        </EditorFormRow>
        <form @submit.prevent="test()">
          <EditorFormRow
            label="List endpoint"
            :help="collection ? 'As saved: it cannot be changed here' : `Relative to ${connection.baseUrl}`"
            :error="path.trim() && pathProblem ? pathProblem : undefined"
          >
            <span class="flex h-[30px] shrink-0 items-center rounded-lg bg-elevated px-2.5 font-mono text-[11px] font-[550] text-toned">GET</span>
            <EditorInput
              v-model="path"
              mono
              placeholder="/posts"
              :readonly="!!collection"
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
            class="flex items-center gap-2 text-[12px] text-muted"
            data-endpoint-status
          >
            <span
              class="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-[550]"
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
          :help="collection ? 'The top-level key of the response that holds the items' : 'The top-level key of the response that holds the items; fetch again to read another'"
          :error="listProblem || undefined"
        >
          <EditorInput
            v-model="itemsPath"
            mono
            placeholder="items"
            :readonly="!!collection"
            aria-label="Items path"
            data-api-items-path
            @keydown.enter.prevent="test()"
          />
        </EditorFormRow>
        <EditorFormRow
          v-if="(total !== null || collection) && (!collection || totalPath)"
          label="Total path"
          help="Optional: the top-level key with the total item count, when the API has one"
        >
          <EditorInput
            v-model="totalPath"
            mono
            placeholder="total"
            :readonly="!!collection"
            aria-label="Total path"
            data-api-total-path
          />
        </EditorFormRow>
      </div>

      <template v-if="total !== null || collection">
        <DataMappingTable
          v-model="rows"
          :problems="problems"
          :notes="notes"
        />
        <DataMappingPreview
          :fields="included"
          :rows="preview"
          :valid="valid"
        />
      </template>

      <section
        v-if="!collection && total !== null"
        class="max-w-3xl space-y-2"
        data-other-endpoints
      >
        <h3 class="text-[12px] font-[550] text-highlighted">
          Other endpoints
          <span class="ms-2 text-[12px] font-normal text-dimmed">Optional: <code>:id</code> stands for the row's key. Only these operations are generated.</span>
        </h3>
        <div
          v-for="op in OTHERS"
          :key="op"
          class="flex items-center gap-2"
          :data-other-endpoint="op"
        >
          <EditorSwitch
            v-model="others[op].on"
            :aria-label="`Use a ${OTHER_LABELS[op]} endpoint`"
            data-other-on
          />
          <span class="w-14 shrink-0 text-[12px] text-muted">{{ OTHER_LABELS[op] }}</span>
          <EditorSelect
            v-model="others[op].method"
            :items="METHODS"
            mono
            :disabled="!others[op].on || op === 'get'"
            :aria-label="`${OTHER_LABELS[op]} method`"
            class="w-28 shrink-0"
            data-other-method
          />
          <EditorInput
            v-model="others[op].path"
            mono
            :placeholder="restDefaults(op, path.trim() || '/').path"
            :disabled="!others[op].on"
            :invalid="others[op].on && !!endpointPathProblem(otherPath(op))"
            :aria-label="`${OTHER_LABELS[op]} path`"
            class="min-w-0 flex-1"
            data-other-path
          />
        </div>
      </section>
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
