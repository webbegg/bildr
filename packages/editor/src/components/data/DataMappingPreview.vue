<script setup lang="ts">
import type { Row } from '@bildr/codegen/query'
import type { MappingRow } from '../../shared/dataMapping.ts'
import { fieldLabel } from '../../shared/dataModel.ts'

/** The first items of a remote response mapped with the fields being edited. */
defineProps<{ fields: MappingRow[], rows: Row[], valid: boolean }>()

function display(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
}
</script>

<template>
  <section>
    <h3 class="mb-2 flex items-baseline gap-2 text-[12px] font-[550] text-highlighted">
      Preview
      <span class="text-[12px] font-normal text-dimmed">first {{ rows.length }} mapped rows</span>
    </h3>
    <div class="max-h-72 overflow-auto rounded-lg ring-1 ring-white/8">
      <table
        class="w-full text-[12px]"
        data-api-preview
      >
        <thead class="sticky top-0 bg-elevated">
          <tr class="text-left text-muted">
            <th
              v-for="field in fields"
              :key="field.name"
              class="h-[30px] px-2.5 font-normal whitespace-nowrap"
              :data-preview-column="field.name"
            >
              {{ fieldLabel(field.name) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="index"
            class="border-t border-white/6"
          >
            <td
              v-for="field in fields"
              :key="field.name"
              class="h-9 max-w-48 truncate px-2.5 text-toned"
            >
              <img
                v-if="field.type === 'image' && row[field.name]"
                :src="String(row[field.name])"
                alt=""
                class="size-7 rounded-md object-cover ring-1 ring-white/10"
              >
              <span
                v-else
                :class="{ 'text-dimmed': row[field.name] === null }"
              >{{ display(row[field.name] ?? null) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p
        v-if="!rows.length"
        class="p-3 text-[12px] text-dimmed"
      >
        {{ valid ? 'No items to preview.' : 'Fix the mapping to see the preview.' }}
      </p>
    </div>
  </section>
</template>
