<script setup lang="ts">
import { collectionCaps } from '#shared/data/collections'
import { createLatestGuard, openRecordView } from '#shared/data/openRecord'
import type { DataRecord, RecordValue } from '#shared/data/records'
import type { Collection } from '#shared/document/schema'

/**
 * The record panel: one row per field, each commit one `record_update`; delete and close in the head. Editable and deletable as the collection's capabilities allow.
 * Connection collections fetch the open record with `record_get` (their Get endpoint); the list row shows until it arrives, and stays if the fetch fails.
 */
const props = defineProps<{ collection: Collection, record: DataRecord }>()
const editor = useEditor()
const caps = computed(() => collectionCaps(props.collection))

const fetched = shallowRef<DataRecord | null>(null)
const loading = ref(false)
const error = ref('')
const guard = createLatestGuard()
const shown = computed(() => openRecordView(props.record, fetched.value))

async function load() {
  if (props.collection.source.type !== 'connection') return
  const token = guard.start()
  loading.value = true
  try {
    const result = await callAction<DataRecord>('record_get', { projectId: editor.projectId, collection: props.collection.id, recordId: props.record.id })
    if (!guard.isLatest(token)) return
    fetched.value = result
    error.value = ''
  } catch (failure) {
    if (!guard.isLatest(token)) return
    fetched.value = null
    error.value = actionErrorMessage(failure)
  } finally {
    if (guard.isLatest(token)) loading.value = false
  }
}

// Another record, or the row reloaded after an edit (here, in the table or by an agent).
watch(() => [props.record.id, JSON.stringify(props.record)] as const, ([id], previous) => {
  if (id !== previous?.[0]) {
    fetched.value = null
    error.value = ''
  }
  void load()
}, { immediate: true })

async function commit(key: string, value: RecordValue) {
  const id = props.record.id
  const result = await editor.runData<DataRecord>('record_update', { recordId: id, values: { [key]: value } })
  if (!result || props.record.id !== id) return
  fetched.value = result
  void load()
}

async function remove() {
  if (!confirm('Delete this record? This cannot be undone.')) return
  if (await editor.runData('record_delete', { recordId: props.record.id })) editor.recordId = null
}
</script>

<template>
  <div
    data-record-panel
    :data-record-id="record.id"
    :data-record-loading="loading || undefined"
  >
    <DataPanelHead
      icon="i-lucide-file-text"
      title="Record"
      :detail="record.id"
    >
      <UIcon
        v-if="loading"
        name="i-lucide-loader-circle"
        class="me-1 size-3.5 shrink-0 animate-spin text-dimmed"
        aria-label="Loading record"
        data-record-spinner
      />
      <UTooltip
        v-if="caps.delete"
        text="Delete record"
      >
        <EditorButton
          icon="i-lucide-trash-2"
          variant="ghost"
          size="xs"
          aria-label="Delete record"
          data-record-delete
          @click="remove"
        />
      </UTooltip>
      <UTooltip text="Close">
        <EditorButton
          icon="i-lucide-x"
          variant="ghost"
          size="xs"
          aria-label="Close record"
          data-record-close
          @click="editor.recordId = null"
        />
      </UTooltip>
    </DataPanelHead>

    <p
      v-if="error"
      class="mx-4 mt-3 text-xs text-dimmed"
      data-record-error
    >
      Could not load the latest record: {{ error }}
    </p>

    <EditorStyleSection label="Fields">
      <EditorRow
        v-for="field in collection.fields"
        :key="field.key"
        :label="field.label"
        :title="`${field.label} (${field.key})`"
        :name="field.key"
        :data-record-field="field.key"
      >
        <DataPanelValue
          :field="field"
          :model-value="shown.values[field.key] ?? null"
          :readonly="!caps.update"
          @commit="commit(field.key, $event)"
        />
      </EditorRow>
      <p
        v-if="!collection.fields.length"
        class="text-xs text-dimmed"
      >
        This collection has no fields yet.
      </p>
    </EditorStyleSection>
  </div>
</template>
