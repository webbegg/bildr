<script setup lang="ts">
import { computed } from 'vue'
import { useEditor } from '../../../editor/useEditor.ts'
import type { DataCollection } from '../../../shared/dataModel.ts'
import { rowsFailure } from '../../../shared/dataTable.ts'

/**
 * Why the app's rows could not be read, above a table of rows (a collection's Rows tab, a query's Results): the one owner of the
 * message. A collection read through a connection has only the app's rows, so it is an error; any other falls back to its
 * sample data, which the banner says, with how to get the app's rows. Nothing is shown when the rows were read.
 */
const { collection } = defineProps<{ collection: DataCollection }>()
const editor = useEditor()
const rest = computed(() => collection.kind === 'rest')
const failure = computed(() => editor.recordsError ? rowsFailure(collection.plural, editor.recordsError) : '')
</script>

<template>
  <p
    v-if="failure"
    class="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-2 text-xs"
    :class="rest ? 'bg-error/10 text-error' : 'bg-white/4 text-muted'"
    data-records-error
  >
    <UIcon
      :name="rest ? 'i-lucide-circle-alert' : 'i-lucide-info'"
      class="size-4 shrink-0"
    />
    <span>{{ rest ? failure : `Showing the sample data. ${failure} Start the app (nuxt dev) and refresh.` }}</span>
  </p>
</template>
