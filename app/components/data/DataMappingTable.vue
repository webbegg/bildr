<script lang="ts">
import type { ApiField } from '#shared/data/apiSource'
import { fieldLabel } from '#shared/document/factory'
import { ApiPathSchema, FieldKeySchema, FIELD_TYPES } from '#shared/document/schema'
import type { FieldType } from '#shared/document/schema'

/** One proposed field of a remote mapping: whether it is kept, and its key, label, type and path in each item. */
export interface MappingRow {
  include: boolean
  key: string
  label: string
  type: FieldType
  path: string
}

export function mappingRow(field: ApiField): MappingRow {
  return { include: true, key: field.key, label: field.label, type: field.type, path: field.path ?? field.key }
}

/** Why each row cannot be saved, `''` when it can (or is left out). */
export function mappingProblems(rows: MappingRow[]): string[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    if (!row.include) return ''
    const key = FieldKeySchema.safeParse(row.key)
    if (!key.success) return key.error.issues[0]!.message
    if (seen.has(row.key)) return `"${row.key}" is used twice`
    seen.add(row.key)
    if (!ApiPathSchema.safeParse(row.path).success) return 'Use a dot path such as origin.name'
    return row.label.trim() ? '' : 'Add a label'
  })
}

/** The included rows as collection fields. */
export function mappingFields(rows: MappingRow[]): ApiField[] {
  return rows.filter(r => r.include).map(r => ({ key: r.key, label: r.label.trim() || r.key, type: r.type, path: r.path }))
}

const typeItems = FIELD_TYPES.map(type => ({ label: type, value: type }))
</script>

<script setup lang="ts">
/** The mapping of a remote response to fields: include, key, label, type and path per row, then a row to add a field by hand. */
defineProps<{ problems: string[] }>()
const rows = defineModel<MappingRow[]>({ required: true })

const newKey = ref('')
const newPath = ref('')

function addField() {
  const key = newKey.value.trim()
  if (!key) return
  rows.value = [...rows.value, { include: true, key, label: fieldLabel(key), type: 'text', path: newPath.value.trim() || key }]
  newKey.value = ''
  newPath.value = ''
}
</script>

<template>
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
</template>
