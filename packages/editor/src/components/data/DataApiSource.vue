<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { callAction, errorMessage } from '../../api.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { mapPreview, mappingFields, mappingProblems, mappingRow } from '../../shared/dataMapping.ts'
import type { InferredField, MappingRow } from '../../shared/dataMapping.ts'
import { endpointPathProblem, entityProposal, sourceNameOf } from '../../shared/dataModel.ts'

/**
 * The "Import from API" dialog: fetch a JSON endpoint by its URL, review the proposed mapping with
 * a live preview, then save it (in the footer) as a new collection. In the module a collection
 * lives in a data source, so Fetch finds the REST data source of the URL's origin or makes one
 * (`datasource_create`, named after the host; one made here and not used is deleted again when the
 * dialog closes), previews through it (`datasource_preview`), and Save is one `entity_create`.
 * Each opening starts clean.
 *
 * Not in the module: editing a saved one-URL source (a collection reads through its data source:
 * Edit mapping is in its panel), paging, a root-array response and a query string in a saved path.
 */
const open = defineModel<boolean>('open', { default: false })
defineProps<{ title: string, description?: string }>()
const editor = useEditor()
const toast = useToast()

interface Preview {
  itemsPath?: string
  fields: InferredField[]
  items?: unknown[]
  count?: number
}

const url = ref('')
const itemsPath = ref('')
const rows = ref<MappingRow[]>([])
const items = shallowRef<unknown[]>([])
const total = ref<number | null>(null)
const name = ref('')
const nameEdited = ref(false)
const fetching = ref(false)
const saving = ref(false)
const error = ref('')
/** The data source the URL's origin reads through, and whether this dialog made it. */
const source = ref<{ id: string, created: boolean } | null>(null)
/** The URL and items path the current mapping is for; fetching another proposes new fields. */
let mappedFor = ''
let saved = false

const parsed = computed(() => {
  try {
    const value = new URL(url.value.trim())
    return value.protocol === 'http:' || value.protocol === 'https:' ? value : null
  } catch {
    return null
  }
})
/** Where the endpoint is under the origin; its query is for the preview only (a saved path has none). */
const path = computed(() => parsed.value ? parsed.value.pathname : '')
const origin = computed(() => parsed.value?.origin ?? '')
const proposal = computed(() => entityProposal(path.value))
const pathProblem = computed(() => url.value.trim() && parsed.value ? endpointPathProblem(path.value) : undefined)
const urlProblem = computed(() => url.value.trim() && !parsed.value ? 'Use a full http or https URL, like https://api.example.com/posts' : '')

function reset() {
  url.value = ''
  itemsPath.value = ''
  rows.value = []
  items.value = []
  total.value = null
  name.value = ''
  nameEdited.value = false
  error.value = ''
  source.value = null
  mappedFor = ''
  saved = false
}

/** The data source for the URL's origin: the project's, or a new one named after the host. */
async function ensureSource(): Promise<string | undefined> {
  if (source.value) {
    const current = editor.connections.find(entry => entry.id === source.value!.id)
    if (current?.baseUrl.replace(/\/+$/, '') === origin.value) return source.value.id
    await dropSource()
  }
  const found = editor.connections.find(entry => entry.baseUrl.replace(/\/+$/, '') === origin.value)
  if (found) {
    source.value = { id: found.id, created: false }
    return found.id
  }
  const made = await editor.run('datasource_create', { name: sourceNameOf(parsed.value!.hostname, editor.model?.datasources.map(entry => entry.name) ?? []), kind: 'rest', defaults: { baseUrl: origin.value } }) as { datasourceId: string } | undefined
  if (!made) {
    error.value = editor.error ?? 'Could not make a data source for this URL'
    return undefined
  }
  source.value = { id: made.datasourceId, created: true }
  return made.datasourceId
}

/** Deletes the data source this dialog made, unless something uses it now (the action refuses then). */
async function dropSource() {
  const made = source.value
  source.value = null
  if (made?.created) await editor.run('datasource_delete', { datasource: made.id })
}

/** Fetches the URL; the proposed fields replace the mapping only for a new URL or items path. */
async function fetchPreview() {
  if (!parsed.value || pathProblem.value) return
  error.value = ''
  fetching.value = true
  try {
    const datasource = await ensureSource()
    if (!datasource) return
    const result = await callAction<Preview>('datasource_preview', { datasource, path: parsed.value.pathname + parsed.value.search, ...(total.value !== null ? { itemsPath: itemsPath.value.trim() } : {}) })
    if (!result.items) {
      error.value = 'The response has no list of items; set the items path to point at one.'
      return
    }
    itemsPath.value = result.itemsPath ?? ''
    items.value = result.items
    total.value = result.count ?? result.items.length
    const fetched = JSON.stringify([url.value.trim(), itemsPath.value])
    if (fetched !== mappedFor || !rows.value.length) rows.value = result.fields.map(mappingRow)
    mappedFor = fetched
    if (!nameEdited.value) name.value = proposal.value.name
  } catch (failure) {
    error.value = errorMessage(failure)
  } finally {
    fetching.value = false
  }
}

/** A fresh fetch of a new URL detects the items path again. */
function onUrlChange() {
  total.value = null
}

const problems = computed(() => mappingProblems(rows.value))
const fields = computed(() => mappingFields(rows.value))
const included = computed(() => rows.value.filter(row => row.include))
const preview = computed(() => problems.value.every(problem => !problem) ? mapPreview(items.value, rows.value) : [])
const listProblem = computed(() => total.value !== null && !itemsPath.value.trim() ? 'The generated adapter reads the items from a top-level key of the response (like "items"): a response that is a bare array cannot be mapped yet.' : '')
const valid = computed(() => !pathProblem.value && problems.value.every(problem => !problem) && fields.value.length > 0 && !listProblem.value)
const canSave = computed(() => valid.value && total.value !== null && !!source.value && !!name.value.trim())

async function save() {
  if (!canSave.value || !source.value) return
  saving.value = true
  const typed = name.value.trim()
  const plural = typed === proposal.value.name ? proposal.value.plural : undefined
  const created = await editor.run('entity_create', {
    name: typed,
    ...(plural ? { plural } : {}),
    source: source.value.id,
    fields: fields.value,
    endpoints: { list: { path: path.value, itemsPath: itemsPath.value.trim() } }
  }) as { entityId: string } | undefined
  saving.value = false
  if (!created) {
    error.value = editor.error ?? 'Could not save the collection'
    return
  }
  saved = true
  editor.collectionId = created.entityId
  editor.connectionId = null
  toast.add({ title: 'Collection created', icon: 'i-lucide-check', color: 'success' })
  open.value = false
}

watch(open, (isOpen) => {
  if (isOpen) reset()
  else if (!saved) void dropSource()
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
      data-api-source
    >
      <div class="max-w-3xl space-y-3">
        <EditorFormRow
          label="Name"
          help="Proposed from the URL when left empty"
        >
          <EditorInput
            v-model="name"
            :placeholder="proposal.name"
            data-api-name
            @update:model-value="nameEdited = true"
          />
        </EditorFormRow>
        <form @submit.prevent="fetchPreview()">
          <EditorFormRow
            label="API URL"
            :help="`A JSON endpoint (GET). Its origin becomes a data source${parsed ? `, ${origin}` : ''}`"
            :error="urlProblem || pathProblem || undefined"
          >
            <span class="flex h-[30px] shrink-0 items-center rounded-lg bg-elevated px-2.5 font-mono text-[11px] font-[550] text-toned">GET</span>
            <EditorInput
              v-model="url"
              mono
              placeholder="https://dummyjson.com/quotes"
              aria-label="API URL"
              autofocus
              data-api-url
              @update:model-value="onUrlChange"
            />
            <EditorButton
              type="submit"
              variant="primary"
              :label="total !== null ? 'Refetch' : 'Fetch'"
              icon="i-lucide-download"
              :loading="fetching"
              :disabled="!parsed || !!pathProblem"
              class="shrink-0"
              data-api-fetch
            />
          </EditorFormRow>
        </form>
        <EditorFormRow
          v-if="total !== null"
          label="Response"
        >
          <p class="text-[12px] text-muted">
            {{ total }} items in the response. Changing the items path and fetching proposes new fields.
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
          v-if="total !== null"
          label="Items path"
          help="The top-level key of the response that holds the items"
          :error="listProblem || undefined"
        >
          <EditorInput
            v-model="itemsPath"
            mono
            placeholder="quotes"
            aria-label="Items path"
            data-api-items-path
            @keydown.enter.prevent="fetchPreview()"
          />
        </EditorFormRow>
      </div>

      <template v-if="total !== null">
        <DataMappingTable
          v-model="rows"
          :problems="problems"
        />
        <DataMappingPreview
          :fields="included"
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
        label="Save collection"
        icon="i-lucide-check"
        :loading="saving"
        :disabled="!canSave"
        data-api-save
        @click="save"
      />
    </template>
  </EditorModal>
</template>
