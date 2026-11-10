<script setup lang="ts">
import { mapItems } from '#shared/data/apiSource'
import type { ApiField } from '#shared/data/apiSource'
import type { PageTwo } from '#shared/data/paging'
import { fieldLabel } from '#shared/document/factory'
import type { Collection, Paging } from '#shared/document/schema'
import { mappingFields, mappingProblems, mappingRow } from './DataMappingTable.vue'
import type { MappingRow } from './DataMappingTable.vue'

/**
 * The "From API" dialog: fetch a JSON endpoint, review and edit the proposed
 * mapping with a live preview, then save it (in the footer) as a new
 * collection or, given `collection`, as that API collection's new mapping.
 * The preview maps the fetched items in the browser with the same `mapItems`
 * the server uses. A paging the fetch proposes (or the saved one) is saved
 * with it unless switched off. Each opening starts from the saved state.
 */
const props = defineProps<{ collection?: Collection, title: string, description?: string }>()
const open = defineModel<boolean>('open', { default: false })
const editor = useEditor()
const toast = useToast()

interface Preview {
  itemsPath: string
  fields: ApiField[]
  items: unknown[]
  total: number
  paging: Paging | null
  pageTwo?: PageTwo
}

const source = computed(() => (props.collection?.source.type === 'api' ? props.collection.source : undefined))
const url = ref('')
const itemsPath = ref('')
const rows = ref<MappingRow[]>([])
const items = shallowRef<unknown[]>([])
const total = ref<number | null>(null)
const name = ref('')
const fetching = ref(false)
const saving = ref(false)
const error = ref('')
const paging = ref<Paging | null>(null)
const pageTwo = ref<PageTwo | null>(null)
const usePaging = ref(true)
/** Whether `paging` was saved or edited, so a fetch keeps it instead of proposing one. */
const pagingChosen = ref(false)
/** The URL and items path the current mapping is for; fetching another proposes new fields. */
let mappedFor = ''

function reset() {
  paging.value = source.value?.paging ?? null
  pagingChosen.value = !!source.value?.paging
  pageTwo.value = null
  usePaging.value = true
  url.value = source.value?.url ?? ''
  itemsPath.value = source.value?.itemsPath ?? ''
  rows.value = props.collection?.fields.map(mappingRow) ?? []
  items.value = []
  total.value = null
  name.value = ''
  error.value = ''
  mappedFor = source.value ? JSON.stringify([source.value.url, source.value.itemsPath]) : ''
}

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
  if (!url.value.trim()) return
  error.value = ''
  fetching.value = true
  try {
    const input: Record<string, unknown> = { projectId: editor.projectId, url: url.value.trim() }
    if (source.value?.headers) input.headers = source.value.headers
    if (total.value !== null || props.collection) input.itemsPath = itemsPath.value.trim()
    if (pagingChosen.value && paging.value) input.paging = paging.value
    const preview = await callAction<Preview>('api_source_preview', input)
    if (!pagingChosen.value) paging.value = preview.paging
    pageTwo.value = preview.pageTwo ?? null
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
  if (props.collection) return
  total.value = null
  pagingChosen.value = false
}

const problems = computed(() => mappingProblems(rows.value))
const fields = computed(() => mappingFields(rows.value))
const valid = computed(() => problems.value.every(p => !p) && fields.value.length > 0)
const preview = computed(() => (valid.value ? mapItems(items.value, fields.value) : []))
const canSave = computed(() => valid.value && (total.value !== null || !!props.collection) && (!!props.collection || !!name.value.trim()))

async function save() {
  if (!canSave.value) return
  saving.value = true
  // Headers set by an agent (api_source_preview, collection_update) stay.
  const headers = source.value?.headers
  const saved = usePaging.value && paging.value ? { paging: paging.value } : {}
  const body = { source: { type: 'api', url: url.value.trim(), itemsPath: itemsPath.value.trim(), ...(headers ? { headers } : {}), ...saved }, fields: fields.value }
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
  if (props.collection) void fetchPreview()
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
          v-if="!collection"
          label="Name"
          help="Proposed from the URL when left empty"
        >
          <EditorInput
            v-model="name"
            placeholder="Characters"
            data-api-name
          />
        </EditorFormRow>
        <form @submit.prevent="fetchPreview()">
          <EditorFormRow
            label="API URL"
            help="A public JSON endpoint (GET, no auth)"
          >
            <span class="flex h-[30px] shrink-0 items-center rounded-lg bg-elevated px-2.5 font-mono text-[11px] font-semibold text-toned">GET</span>
            <EditorInput
              v-model="url"
              mono
              placeholder="https://rickandmortyapi.com/api/character"
              aria-label="API URL"
              autofocus
              data-api-url
              @update:model-value="onUrlChange"
            />
            <EditorButton
              type="submit"
              variant="primary"
              :label="collection || total !== null ? 'Refetch' : 'Fetch'"
              icon="i-lucide-download"
              :loading="fetching"
              :disabled="!url.trim()"
              class="shrink-0"
              data-api-fetch
            />
          </EditorFormRow>
        </form>
        <EditorFormRow
          v-if="total !== null"
          label="Response"
        >
          <p class="text-[13px] text-muted">
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
          v-if="total !== null || collection"
          label="Items path"
          help="Where the list is in the response; empty for a root array"
        >
          <EditorInput
            v-model="itemsPath"
            mono
            placeholder="results"
            aria-label="Items path"
            data-api-items-path
            @keydown.enter.prevent="fetchPreview()"
          />
        </EditorFormRow>
        <DataPagingDetected
          v-model:paging="paging"
          v-model:use="usePaging"
          :page-two="pageTwo"
          :detected="!pagingChosen"
          @update:paging="pagingChosen = true; pageTwo = null"
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
