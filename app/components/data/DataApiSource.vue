<script setup lang="ts">
import { mapItems } from '#shared/data/apiSource'
import type { ApiField } from '#shared/data/apiSource'
import type { RecordValue } from '#shared/data/records'
import { fieldLabel } from '#shared/document/factory'
import { ApiPathSchema, FIELD_TYPES, FieldKeySchema } from '#shared/document/schema'
import type { Collection, FieldType } from '#shared/document/schema'

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

interface Row {
  include: boolean
  key: string
  label: string
  type: FieldType
  path: string
}

interface Preview {
  itemsPath: string
  fields: ApiField[]
  items: unknown[]
  total: number
}

const source = props.collection?.source.type === 'api' ? props.collection.source : undefined
const url = ref(source?.url ?? '')
const itemsPath = ref(source?.itemsPath ?? '')
const rows = ref<Row[]>(props.collection?.fields.map(f => toRow(f)) ?? [])
const items = shallowRef<unknown[]>([])
const total = ref<number | null>(null)
const name = ref('')
const fetching = ref(false)
const saving = ref(false)
const error = ref('')
const newKey = ref('')
const newPath = ref('')
/** The URL and items path the current mapping is for; fetching another proposes new fields. */
let mappedFor = source ? JSON.stringify([source.url, source.itemsPath]) : ''

const typeItems = FIELD_TYPES.map(type => ({ label: type, value: type }))

function toRow(field: ApiField): Row {
  return { include: true, key: field.key, label: field.label, type: field.type, path: field.path ?? field.key }
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
  error.value = ''
  fetching.value = true
  try {
    const input: Record<string, unknown> = { projectId: editor.projectId, url: url.value.trim() }
    if (total.value !== null || props.collection) input.itemsPath = itemsPath.value.trim()
    const preview = await callAction<Preview>('api_source_preview', input)
    itemsPath.value = preview.itemsPath
    items.value = preview.items
    total.value = preview.total
    const fetched = JSON.stringify([url.value.trim(), preview.itemsPath])
    if (fetched !== mappedFor || !rows.value.length) rows.value = preview.fields.map(toRow)
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

const included = computed(() => rows.value.filter(r => r.include))

const problems = computed(() => {
  const seen = new Set<string>()
  return rows.value.map((row) => {
    if (!row.include) return ''
    const key = FieldKeySchema.safeParse(row.key)
    if (!key.success) return key.error.issues[0]!.message
    if (seen.has(row.key)) return `"${row.key}" is used twice`
    seen.add(row.key)
    if (!ApiPathSchema.safeParse(row.path).success) return 'Use a dot path such as origin.name'
    return row.label.trim() ? '' : 'Add a label'
  })
})

const fields = computed<ApiField[]>(() => included.value.map(r => ({ key: r.key, label: r.label.trim() || r.key, type: r.type, path: r.path })))
const valid = computed(() => problems.value.every(p => !p) && included.value.length > 0)
const preview = computed(() => (valid.value ? mapItems(items.value, fields.value) : []))

function addField() {
  const key = newKey.value.trim()
  if (!key) return
  rows.value = [...rows.value, { include: true, key, label: fieldLabel(key), type: 'text', path: newPath.value.trim() || key }]
  newKey.value = ''
  newPath.value = ''
}

function display(value: RecordValue): string {
  return value === null || value === '' ? '—' : String(value)
}

async function save() {
  saving.value = true
  const body = { source: { type: 'api', url: url.value.trim(), itemsPath: itemsPath.value.trim() }, fields: fields.value }
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

      <div>
        <p class="mb-1 text-sm font-semibold">
          Mapping
        </p>
        <table
          class="w-full text-sm"
          data-api-mapping
        >
          <thead>
            <tr class="text-left text-xs text-muted">
              <th class="w-8 pb-1" />
              <th class="pb-1 font-medium">
                Key
              </th>
              <th class="pb-1 font-medium">
                Label
              </th>
              <th class="w-32 pb-1 font-medium">
                Type
              </th>
              <th class="pb-1 font-medium">
                Path
              </th>
            </tr>
          </thead>
          <tbody>
            <template
              v-for="(row, i) in rows"
              :key="i"
            >
              <tr
                :data-mapping-row="row.path"
                :class="{ 'opacity-50': !row.include }"
              >
                <td class="py-1">
                  <UCheckbox
                    v-model="row.include"
                    :aria-label="`Include ${row.path}`"
                    data-include
                  />
                </td>
                <td class="py-1 pe-2">
                  <UInput
                    v-model="row.key"
                    size="sm"
                    class="w-full font-mono"
                    data-key
                  />
                </td>
                <td class="py-1 pe-2">
                  <UInput
                    v-model="row.label"
                    size="sm"
                    class="w-full"
                    data-label
                  />
                </td>
                <td class="py-1 pe-2">
                  <USelect
                    v-model="row.type"
                    :items="typeItems"
                    size="sm"
                    class="w-full"
                    data-type
                  />
                </td>
                <td class="py-1">
                  <UInput
                    v-model="row.path"
                    size="sm"
                    class="w-full font-mono"
                    data-path
                  />
                </td>
              </tr>
              <tr v-if="problems[i]">
                <td />
                <td
                  colspan="4"
                  class="pb-1 text-xs text-error"
                >
                  {{ problems[i] }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <form
          class="mt-2 flex items-center gap-2"
          data-api-add-field
          @submit.prevent="addField"
        >
          <UInput
            v-model="newKey"
            size="sm"
            placeholder="New field key, e.g. locationName"
            class="flex-1"
          />
          <UInput
            v-model="newPath"
            size="sm"
            placeholder="Path, e.g. location.name"
            class="flex-1 font-mono"
          />
          <UButton
            type="submit"
            icon="i-lucide-plus"
            label="Add field"
            size="sm"
            color="neutral"
            variant="outline"
          />
        </form>
      </div>

      <div>
        <p class="mb-1 text-sm font-semibold">
          Preview
          <span class="font-normal text-xs text-muted">first {{ preview.length }} mapped rows</span>
        </p>
        <div class="max-h-72 overflow-auto rounded-md ring ring-default">
          <table
            class="w-full text-xs"
            data-api-preview
          >
            <thead class="sticky top-0 bg-elevated">
              <tr class="text-left">
                <th
                  v-for="field in fields"
                  :key="field.key"
                  class="px-2 py-1 font-medium whitespace-nowrap"
                  :data-preview-column="field.key"
                >
                  {{ field.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in preview"
                :key="row.id"
                class="border-t border-default"
              >
                <td
                  v-for="field in fields"
                  :key="field.key"
                  class="max-w-48 truncate px-2 py-1"
                >
                  <img
                    v-if="field.type === 'image' && row.values[field.key]"
                    :src="String(row.values[field.key])"
                    alt=""
                    class="size-8 rounded object-cover ring ring-default"
                  >
                  <span
                    v-else
                    :class="{ 'text-dimmed': row.values[field.key] === null }"
                  >{{ display(row.values[field.key] ?? null) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p
            v-if="!preview.length"
            class="p-3 text-xs text-dimmed"
          >
            {{ valid ? 'No items to preview.' : 'Fix the mapping to see the preview.' }}
          </p>
        </div>
      </div>

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
