<script setup lang="ts">
import { collectionCaps } from '#shared/data/collections'
import type { DataRecord, RecordValue } from '#shared/data/records'
import type { Collection } from '#shared/document/schema'

/** The record panel: one row per field, each commit one `record_update`; delete and close in the head. Editable and deletable as the collection's capabilities allow. */
const props = defineProps<{ collection: Collection, record: DataRecord }>()
const editor = useEditor()
const caps = computed(() => collectionCaps(props.collection))

function commit(key: string, value: RecordValue) {
  editor.runData('record_update', { recordId: props.record.id, values: { [key]: value } })
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
  >
    <DataPanelHead
      icon="i-lucide-file-text"
      title="Record"
      :detail="record.id"
    >
      <UTooltip
        v-if="caps.delete"
        text="Delete record"
      >
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Delete record"
          data-record-delete
          @click="remove"
        />
      </UTooltip>
      <UTooltip text="Close">
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Close record"
          data-record-close
          @click="editor.recordId = null"
        />
      </UTooltip>
    </DataPanelHead>

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
          :model-value="record.values[field.key] ?? null"
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
