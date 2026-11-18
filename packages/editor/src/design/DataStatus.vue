<script setup lang="ts">
import { computed } from 'vue'
import { useDesign } from './store.ts'

/**
 * Where the canvas's data comes from (Q12), in the Data workspace's words: "Live" when the rows are the
 * app's, "Sample data" when the app could not answer (or lists nothing) and the
 * collection's sample rows stand in, "Live + Sample data" when it is a mix; a Refresh button
 * reads the app again. On a detail page, the record picker chooses which record
 * the page shows (its route parameter).
 */

const design = useDesign()
const state = computed(() => design.rowsOf.state.value)
const LABELS = { live: 'Live', fixtures: 'Sample data', partial: 'Live + Sample data' } as const
const names = (ids: string[]) => ids.map(id => Object.values(design.model.value?.modules ?? {}).flatMap(entry => entry.entities).find(entity => entity.id === id)?.plural ?? id)
const title = computed(() => {
  if (state.value === 'live') return 'The canvas shows the rows of the running app'
  const why = design.rowsOf.fixtureEntities.value.map(id => `${names([id])[0]} ${design.rowsOf.reasons.value[id] ?? 'has no rows from the app'}`)
  return `The canvas shows the Sample data where the app's rows could not be read: ${why.join('; ')}. Start the app (nuxt dev) and refresh.`
})
const label = (key: string): string => {
  const detail = design.detail.value
  const row = design.records.value.find(entry => String(entry[detail!.field]) === key)
  const text = row?.[detail!.label]
  return typeof text === 'string' && text && text !== key ? `${text} (${key})` : key
}
const pick = (event: Event) => design.pickRecord((event.target as HTMLSelectElement).value)
</script>

<template>
  <div class="flex items-center gap-2 text-xs">
    <template v-if="design.detail.value">
      <label class="flex items-center gap-1 text-muted">
        Record
        <select
          data-testid="record-picker"
          class="max-w-48 rounded-md border border-default bg-default px-1 py-0.5 text-xs text-default"
          :value="design.record.value ? String(design.record.value[design.detail.value.field]) : ''"
          @change="pick"
        >
          <option
            v-for="row in design.records.value"
            :key="String(row[design.detail.value.field])"
            :value="String(row[design.detail.value.field])"
          >
            {{ label(String(row[design.detail.value.field])) }}
          </option>
        </select>
      </label>
    </template>
    <template v-if="state">
      <span
        data-testid="data-badge"
        :data-state="state"
        :title="title"
        class="rounded-full px-2 py-0.5 font-medium"
        :class="state === 'live' ? 'bg-success/10 text-success' : state === 'partial' ? 'bg-warning/10 text-warning' : 'bg-elevated text-muted'"
      >{{ LABELS[state] }}</span>
      <UButton
        data-testid="data-refresh"
        icon="i-lucide-refresh-cw"
        aria-label="Refresh the data"
        size="xs"
        color="neutral"
        variant="ghost"
        :loading="design.rowsOf.loading.value"
        @click="design.rowsOf.refresh()"
      />
    </template>
  </div>
</template>
