<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { callAction, errorMessage } from '../../../api.ts'
import { useEditor } from '../../../editor/useEditor.ts'
import { VARIABLE_FIELD_UI } from '../../../editorUi.ts'
import { OPERATION_LABELS } from '../../../shared/dataModel.ts'
import type { DataCollection, EndpointOperation } from '../../../shared/dataModel.ts'
import { rowId } from '../../../shared/dataTable.ts'

/**
 * A connection collection's Endpoints section: one row per operation its repository has, with its
 * verb chip, its path and Test, then the paging and Edit mapping. Test is `repository_endpoint_test`,
 * which only sends GET (a POST, PUT or DELETE could change the API's data, so those are not tested).
 *
 * Read-only: no action adds, removes or changes an endpoint of an existing repository (the
 * endpoints are given to `entity_create`), nor the paging (the generated adapter pages by
 * offset), so the hosted `+`, `−`, verb select, path inputs, id path and Detect paging are not
 * ported. Edit mapping changes the fields' keys (`entity_field_*`).
 */
const props = defineProps<{ collection: DataCollection }>()
const editor = useEditor()

const connection = computed(() => editor.connections.find(entry => entry.id === props.collection.datasource))
const list = computed(() => props.collection.endpoints.find(endpoint => endpoint.op === 'list'))
const paging = computed(() => props.collection.paging)

const results = ref<Partial<Record<EndpointOperation, { ok: boolean, text: string }>>>({})
const testing = ref<EndpointOperation | null>(null)
const editingMapping = ref(false)

watch(() => props.collection.id, () => {
  results.value = {}
})

/** The verb is a compact chip inside the path field, so the path gets the rest of the row. */
const PATH_UI = { ...VARIABLE_FIELD_UI, base: 'ps-[50px]', leading: 'ps-[3px]', trailing: 'hidden' }

interface TestResult {
  method: string
  path: string
  status: number
  count?: number
  items?: unknown[]
  item?: unknown
  mapping: Array<{ field: string, remote: string, found: boolean }>
}

async function test(op: EndpointOperation) {
  const endpoint = props.collection.endpoints.find(entry => entry.op === op)
  if (!endpoint || !props.collection.repository || endpoint.method !== 'GET') return
  const id = op === 'get' ? editor.collectionRows[0] && rowId(editor.collectionRows[0], 0) : undefined
  if (op === 'get' && !id) {
    results.value = { ...results.value, [op]: { ok: false, text: 'The path needs a row id: load the list first' } }
    return
  }
  testing.value = op
  try {
    const result = await callAction<TestResult>('repository_endpoint_test', { repository: props.collection.repository, op, ...(id ? { id } : {}) })
    const missing = result.mapping.filter(entry => !entry.found).map(entry => entry.field)
    const detail = result.count !== undefined ? `${result.count} ${result.count === 1 ? 'item' : 'items'}` : `row ${id}`
    results.value = { ...results.value, [op]: { ok: result.status < 300 && !missing.length, text: `${result.status} · ${detail}${missing.length ? ` · not in the response: ${missing.join(', ')}` : ''}` } }
  } catch (error) {
    results.value = { ...results.value, [op]: { ok: false, text: errorMessage(error) } }
  } finally {
    testing.value = null
  }
}
</script>

<template>
  <EditorStyleSection label="Endpoints">
    <template
      v-for="endpoint in collection.endpoints"
      :key="endpoint.op"
    >
      <EditorRow
        :label="OPERATION_LABELS[endpoint.op]"
        :title="`${OPERATION_LABELS[endpoint.op]} endpoint`"
        :name="`endpoint-${endpoint.op}`"
        :data-endpoint="endpoint.op"
      >
        <EditorInput
          :model-value="endpoint.path"
          mono
          readonly
          :aria-label="`${OPERATION_LABELS[endpoint.op]} path`"
          :ui="PATH_UI"
          class="min-w-0 flex-1"
          :data-endpoint-path="endpoint.op"
        >
          <template #leading>
            <span
              class="flex h-6 w-11 shrink-0 items-center justify-center rounded-lg bg-white/6 font-mono text-[10.5px] font-[550] text-toned"
              data-endpoint-method
            >{{ endpoint.method }}</span>
          </template>
        </EditorInput>
        <UTooltip :text="endpoint.method === 'GET' ? 'Test' : `Not tested: a ${endpoint.method} could change the API's data`">
          <EditorButton
            icon="i-lucide-play"
            variant="ghost"
            size="xs"
            :aria-label="`Test ${OPERATION_LABELS[endpoint.op]}`"
            :loading="testing === endpoint.op"
            :disabled="endpoint.method !== 'GET' || !collection.repository"
            :data-endpoint-test="endpoint.op"
            @click="test(endpoint.op)"
          />
        </UTooltip>
        <template
          v-if="results[endpoint.op]"
          #below
        >
          <p
            class="truncate text-[11px] leading-4"
            :class="results[endpoint.op]!.ok ? 'text-success' : 'text-error'"
            :title="results[endpoint.op]!.text"
            data-endpoint-result
          >
            {{ results[endpoint.op]!.text }}
          </p>
        </template>
      </EditorRow>
      <template v-if="endpoint.op === 'list'">
        <EditorRow
          label="Items"
          title="The top-level key of the response that holds the items"
          name="itemsPath"
        >
          <code
            class="flex h-[30px] min-w-0 flex-1 items-center truncate px-2 text-xs text-toned"
            data-items-path
          >{{ endpoint.itemsPath }}</code>
        </EditorRow>
        <EditorRow
          label="Paging"
          title="How the generated adapter splits the list over requests"
          name="paging"
          data-paging
        >
          <span
            class="flex h-[30px] min-w-0 flex-1 items-center truncate px-2 text-[12px] text-toned"
            data-paging-summary
          >Offset ({{ paging?.offsetParam ?? 'offset' }}, {{ paging?.limitParam ?? 'limit' }})</span>
        </EditorRow>
        <EditorRow
          v-if="endpoint.totalPath"
          label="Total path"
          title="The top-level key of the response with the total item count"
          name="paging-total-path"
        >
          <code
            class="flex h-[30px] min-w-0 flex-1 items-center truncate px-2 text-xs text-toned"
            data-total-path
          >{{ endpoint.totalPath }}</code>
        </EditorRow>
      </template>
    </template>
    <p
      v-if="!collection.endpoints.length"
      class="text-xs text-dimmed"
    >
      No endpoints.
    </p>
    <p
      v-if="list"
      class="text-[11px] leading-4 text-dimmed"
    >
      Endpoints are set when the collection is created; they can be edited as a raw file on the Model screen.
    </p>
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
