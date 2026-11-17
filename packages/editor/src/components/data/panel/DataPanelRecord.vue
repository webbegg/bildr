<script setup lang="ts">
import type { Row } from '@bildr/codegen/query'
import { useEditor } from '../../../editor/useEditor.ts'
import { saveSampleValue } from '../../../editor/sampleRows.ts'
import type { CellValue } from '../../../editor/sampleRows.ts'
import type { DataCollection, DataField } from '../../../shared/dataModel.ts'

/**
 * The row panel: one row per field. The app's rows are read-only (they are app data reached through the generated
 * API, E2, so there is no write here); the Sample data's fields are inputs (D4, S4), each saved as one `fixture_row_update`
 * (`DataPanelValue`). Close in the head. The hosted panel also fetched the open record through the connection's Get endpoint;
 * the list row is what shows here.
 */
const props = defineProps<{ collection: DataCollection, row: Row, rowId: string }>()
const editor = useEditor()
const saver = (field: DataField) => editor.rowsEditable ? async (value: CellValue) => (await saveSampleValue(editor, props.collection.id, props.rowId, field.name, value, { ...props.row }))?.message : undefined
</script>

<template>
  <div
    data-record-panel
    :data-record-id="rowId"
  >
    <DataPanelHead
      icon="i-lucide-file-text"
      title="Record"
      :detail="rowId"
    >
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

    <EditorStyleSection label="Fields">
      <EditorRow
        v-for="field in collection.fields"
        :key="field.id"
        :label="field.label"
        :title="`${field.label} (${field.name})`"
        :name="field.name"
        :data-record-field="field.name"
      >
        <DataPanelValue
          :field="field"
          :model-value="row[field.name] ?? null"
          :save="saver(field)"
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
