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

const typeItems = [...FIELD_TYPES]
</script>

<script setup lang="ts">
/** The mapping of a remote response to fields: include, key, label, type and path per row, then a row to add a field by hand. */
defineProps<{ problems: string[] }>()
const rows = defineModel<MappingRow[]>({ required: true })

const newKey = ref('')
const newPath = ref('')
const included = computed(() => rows.value.filter(r => r.include).length)

function addField() {
  const key = newKey.value.trim()
  if (!key) return
  rows.value = [...rows.value, { include: true, key, label: fieldLabel(key), type: 'text', path: newPath.value.trim() || key }]
  newKey.value = ''
  newPath.value = ''
}
</script>

<template>
  <section>
    <h3 class="mb-2 flex items-baseline gap-2 text-[12px] font-[550] text-highlighted">
      Mapping
      <span class="text-[12px] font-normal text-dimmed">{{ included }} of {{ rows.length }} fields included</span>
    </h3>
    <table
      class="w-full table-fixed border-separate border-spacing-y-1 text-[12px]"
      data-api-mapping
    >
      <colgroup>
        <col class="w-12">
        <col class="w-[26%]">
        <col class="w-[26%]">
        <col class="w-32">
        <col>
      </colgroup>
      <thead>
        <tr class="text-left text-[12px] text-muted">
          <th class="font-normal">
            <span class="sr-only">Include</span>
          </th>
          <th class="ps-1 font-normal">
            Key
          </th>
          <th class="ps-1 font-normal">
            Label
          </th>
          <th class="ps-1 font-normal">
            Type
          </th>
          <th class="ps-1 font-normal">
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
          >
            <td>
              <EditorSwitch
                v-model="row.include"
                :aria-label="`Include ${row.path}`"
                data-include
              />
            </td>
            <td
              class="pe-2 transition-opacity"
              :class="{ 'opacity-40': !row.include }"
            >
              <EditorInput
                v-model="row.key"
                mono
                :invalid="!!problems[i]"
                :aria-label="`Key of ${row.path}`"
                data-key
              />
            </td>
            <td
              class="pe-2 transition-opacity"
              :class="{ 'opacity-40': !row.include }"
            >
              <EditorInput
                v-model="row.label"
                :aria-label="`Label of ${row.path}`"
                data-label
              />
            </td>
            <td
              class="pe-2 transition-opacity"
              :class="{ 'opacity-40': !row.include }"
            >
              <EditorSelect
                :model-value="row.type"
                :items="typeItems"
                :aria-label="`Type of ${row.path}`"
                data-type
                @update:model-value="row.type = $event as FieldType"
              />
            </td>
            <td
              class="transition-opacity"
              :class="{ 'opacity-40': !row.include }"
            >
              <EditorInput
                v-model="row.path"
                mono
                :aria-label="`Path of ${row.label || row.key}`"
                data-path
              />
            </td>
          </tr>
          <tr v-if="problems[i]">
            <td />
            <td
              colspan="4"
              class="pb-1 text-[12px] leading-4 text-error"
            >
              {{ problems[i] }}
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <form
      class="mt-1 flex items-center gap-2 ps-12"
      data-api-add-field
      @submit.prevent="addField"
    >
      <EditorInput
        v-model="newKey"
        mono
        placeholder="New field key, e.g. locationName"
        aria-label="New field key"
        class="flex-1"
      />
      <EditorInput
        v-model="newPath"
        mono
        placeholder="Path, e.g. location.name"
        aria-label="New field path"
        class="flex-1"
      />
      <EditorButton
        type="submit"
        icon="i-lucide-plus"
        label="Add field"
        :disabled="!newKey.trim()"
        class="shrink-0"
      />
    </form>
  </section>
</template>
