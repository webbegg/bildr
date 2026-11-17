<script setup lang="ts">
import { useEditor } from '../../../editor/useEditor.ts'
import type { RowsSource } from '../../../editor/dataView.ts'

/**
 * The source controls of a table of rows, the same wherever rows are shown (a collection's Rows tab, a query's Results): the
 * Live / Sample data switch and Refresh, wired to the editor. The switch shows the user's choice (`rowsPreference`) and chooses
 * it (choosing Live again is a retry: it reads the app's rows again). When Live is chosen but the app does not answer
 * (`rowsFallback`) the switch stays on Live and a note says the rows shown are sample data; `rowsSource` is where the rows
 * really come from. A collection read through a connection has no sample data (`switchable` off), so it only says Live.
 * `DataRowsFailure` says why the app did not answer.
 */
defineProps<{ switchable: boolean }>()
const editor = useEditor()
const SOURCES: Array<{ value: RowsSource, label: string }> = [{ value: 'live', label: 'Live' }, { value: 'sample', label: 'Sample data' }]

function choose(source: RowsSource) {
  editor.rowsPreference = source
  if (source === 'live') void editor.reloadRecords()
}
</script>

<template>
  <div class="flex items-center gap-2">
    <div
      class="flex items-center gap-2"
      :data-source="switchable ? editor.rowsSource : 'live'"
      data-live-badge
    >
      <span
        v-if="switchable && editor.rowsFallback"
        class="text-xs text-muted"
        data-source-note
      >App not answering — showing sample data</span>
      <div
        v-if="switchable"
        class="w-48"
      >
        <EditorSegmented
          :items="SOURCES"
          :model-value="editor.rowsPreference"
          @update:model-value="choose($event as RowsSource)"
        />
      </div>
      <UBadge
        v-else
        label="Live"
        icon="i-lucide-radio"
        color="info"
        variant="subtle"
        size="sm"
      />
    </div>
    <UTooltip text="Refresh">
      <EditorButton
        icon="i-lucide-refresh-cw"
        variant="ghost"
        size="xs"
        aria-label="Refresh"
        :loading="editor.recordsLoading"
        data-records-refresh
        @click="editor.reloadRecords()"
      />
    </UTooltip>
  </div>
</template>
