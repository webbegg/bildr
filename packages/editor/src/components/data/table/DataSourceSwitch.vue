<script setup lang="ts">
import type { RowsSource } from '../../../editor/dataView.ts'

/**
 * The Live / Sample data switch of a table of rows: it shows the user's choice, `source`, and chooses (choosing Live
 * again is a retry). When Live is chosen but the app does not answer (`fallback`) the switch stays on Live and a note says
 * the rows shown are sample data; `shown` is where the rows really come from. A collection read through a connection
 * has no sample data (`switchable` off), so it only says Live. The Rows tab's toolbar and a query's Results have it.
 */
defineProps<{ source: RowsSource, shown: RowsSource, fallback: boolean, switchable: boolean }>()
const emit = defineEmits<{ source: [source: RowsSource] }>()
const SOURCES: Array<{ value: RowsSource, label: string }> = [{ value: 'live', label: 'Live' }, { value: 'sample', label: 'Sample data' }]
</script>

<template>
  <div
    class="flex items-center gap-2"
    :data-source="switchable ? shown : 'live'"
    data-live-badge
  >
    <span
      v-if="switchable && fallback"
      class="text-xs text-muted"
      data-source-note
    >App not answering — showing sample data</span>
    <div
      v-if="switchable"
      class="w-48"
    >
      <EditorSegmented
        :items="SOURCES"
        :model-value="source"
        @update:model-value="emit('source', $event as RowsSource)"
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
</template>
