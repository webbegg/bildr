<script setup lang="ts">
import { computed, ref } from 'vue'
import { fieldTypeItems } from '../../shared/dataModel.ts'
import type { FieldType } from '../../shared/dataModel.ts'
import type { MappingRow } from '../../shared/dataMapping.ts'

/**
 * The mapping of a remote response to fields: include, name, type and key per row, then a row to
 * add a field by hand. The hosted table also had a label and read a dot path; the model's field
 * has a name only, and the generated adapter reads one top-level key of each item. `notes` are
 * remarks that don't stop saving (e.g. a key the response does not have). A saved `id` field is
 * the entity's key: it cannot be left out or renamed.
 */
defineProps<{ problems: string[], notes?: string[] }>()
const rows = defineModel<MappingRow[]>({ required: true })

const newName = ref('')
const newRemote = ref('')
const included = computed(() => rows.value.filter(row => row.include).length)
const fixed = (row: MappingRow) => !!row.id && row.name === 'id'

function addField() {
  const name = newName.value.trim()
  if (!name) return
  rows.value = [...rows.value, { include: true, name, type: 'text', remote: newRemote.value.trim() || name }]
  newName.value = ''
  newRemote.value = ''
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
        <col class="w-[30%]">
        <col class="w-36">
        <col>
      </colgroup>
      <thead>
        <tr class="text-left text-[12px] text-muted">
          <th class="font-normal">
            <span class="sr-only">Include</span>
          </th>
          <th class="ps-1 font-normal">
            Name
          </th>
          <th class="ps-1 font-normal">
            Type
          </th>
          <th class="ps-1 font-normal">
            Key in each item
          </th>
        </tr>
      </thead>
      <tbody>
        <template
          v-for="(row, i) in rows"
          :key="i"
        >
          <tr :data-mapping-row="row.remote">
            <td>
              <EditorSwitch
                v-model="row.include"
                :disabled="fixed(row)"
                :aria-label="`Include ${row.remote}`"
                data-include
              />
            </td>
            <td
              class="pe-2 transition-opacity"
              :class="{ 'opacity-40': !row.include }"
            >
              <EditorInput
                v-model="row.name"
                mono
                :readonly="fixed(row)"
                :invalid="!!problems[i]"
                :aria-label="`Name of ${row.remote}`"
                data-key
              />
            </td>
            <td
              class="pe-2 transition-opacity"
              :class="{ 'opacity-40': !row.include }"
            >
              <EditorSelect
                :model-value="row.type"
                :items="fieldTypeItems"
                :aria-label="`Type of ${row.remote}`"
                data-type
                @update:model-value="row.type = $event as FieldType"
              />
            </td>
            <td
              class="transition-opacity"
              :class="{ 'opacity-40': !row.include }"
            >
              <EditorInput
                v-model="row.remote"
                mono
                :aria-label="`Key of ${row.name || row.remote}`"
                data-path
              />
            </td>
          </tr>
          <tr v-if="problems[i]">
            <td />
            <td
              colspan="3"
              class="pb-1 text-[12px] leading-4 text-error"
            >
              {{ problems[i] }}
            </td>
          </tr>
          <tr v-else-if="notes?.[i]">
            <td />
            <td
              colspan="3"
              class="pb-1 text-[12px] leading-4 text-warning"
              data-mapping-note
            >
              {{ notes[i] }}
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
        v-model="newName"
        mono
        placeholder="New field name, e.g. locationName"
        aria-label="New field name"
        class="flex-1"
      />
      <EditorInput
        v-model="newRemote"
        mono
        placeholder="Key, e.g. location_name"
        aria-label="New field key"
        class="flex-1"
      />
      <EditorButton
        type="submit"
        icon="i-lucide-plus"
        label="Add field"
        :disabled="!newName.trim()"
        class="shrink-0"
      />
    </form>
  </section>
</template>
