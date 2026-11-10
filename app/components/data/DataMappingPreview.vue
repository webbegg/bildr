<script setup lang="ts">
import type { ApiField, ApiRow } from '#shared/data/apiSource'
import type { RecordValue } from '#shared/data/records'

/** The first items of a remote response mapped with the fields being edited. */
defineProps<{ fields: ApiField[], rows: ApiRow[], valid: boolean }>()

function display(value: RecordValue): string {
  return value === null || value === '' ? '—' : String(value)
}
</script>

<template>
  <div>
    <p class="mb-1 text-sm font-semibold">
      Preview
      <span class="font-normal text-xs text-muted">first {{ rows.length }} mapped rows</span>
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
            v-for="row in rows"
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
        v-if="!rows.length"
        class="p-3 text-xs text-dimmed"
      >
        {{ valid ? 'No items to preview.' : 'Fix the mapping to see the preview.' }}
      </p>
    </div>
  </div>
</template>
