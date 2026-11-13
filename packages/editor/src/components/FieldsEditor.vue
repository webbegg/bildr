<script setup lang="ts">
import { ref } from 'vue'
import { FIELD_TYPES } from '../model.ts'
import type { Json, JsonObject } from '../types.ts'

/**
 * The entity `fields` array (`FieldSchema`): one row per field with its id,
 * name, type and flags; constraints behind "More". Keys the row doesn't show
 * stay as they are.
 */
const fields = defineModel<JsonObject[]>({ required: true })

const FLAGS = ['required', 'unique', 'nullable', 'readonly'] as const
const FIELD_TYPE_ITEMS: string[] = [...FIELD_TYPES]
const expanded = ref<Set<number>>(new Set())

const text = (field: JsonObject, key: string) => typeof field[key] === 'string' ? field[key] as string : ''
const numberText = (field: JsonObject, key: string) => typeof field[key] === 'number' ? String(field[key]) : ''
const defaultText = (field: JsonObject) => field.default === undefined ? '' : JSON.stringify(field.default)

const setText = (field: JsonObject, key: string, value: string | number, optional = false) => {
  const next = String(value)
  if (optional && next === '') Reflect.deleteProperty(field, key)
  else field[key] = next
}
const setNumber = (field: JsonObject, key: string, value: string | number) => {
  const next = String(value).trim()
  if (next === '' || Number.isNaN(Number(next))) Reflect.deleteProperty(field, key)
  else field[key] = Number(next)
}
/** Flags stay absent when off, as in hand-written files. */
const setFlag = (field: JsonObject, key: string, on: boolean | 'indeterminate') => {
  if (on === true) field[key] = true
  else Reflect.deleteProperty(field, key)
}
const setDefault = (field: JsonObject, value: string | number) => {
  const next = String(value).trim()
  if (next === '') {
    delete field.default
    return
  }
  try {
    field.default = JSON.parse(next) as Json
  } catch {
    field.default = next
  }
}

const toggle = (index: number) => {
  const next = new Set(expanded.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  expanded.value = next
}
const add = () => {
  fields.value = [...fields.value, { id: '', name: '', type: 'text' }]
}
const remove = (index: number) => {
  fields.value = fields.value.filter((_, at) => at !== index)
  expanded.value = new Set()
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="(field, index) in fields"
      :key="index"
      class="rounded-md border border-default p-2"
    >
      <div class="flex flex-wrap items-center gap-2">
        <UInput
          :data-testid="`field-${index}-id`"
          :model-value="text(field, 'id')"
          placeholder="fld_title"
          size="sm"
          class="w-36"
          @update:model-value="setText(field, 'id', $event)"
        />
        <UInput
          :data-testid="`field-${index}-name`"
          :model-value="text(field, 'name')"
          placeholder="title"
          size="sm"
          class="w-36"
          @update:model-value="setText(field, 'name', $event)"
        />
        <USelect
          :model-value="text(field, 'type')"
          :items="FIELD_TYPE_ITEMS"
          size="sm"
          class="w-32"
          @update:model-value="setText(field, 'type', String($event))"
        />
        <UCheckbox
          v-for="flag in FLAGS"
          :key="flag"
          :label="flag"
          :model-value="field[flag] === true"
          size="sm"
          @update:model-value="setFlag(field, flag, $event)"
        />
        <div class="ml-auto flex gap-1">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :icon="expanded.has(index) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            :label="expanded.has(index) ? 'Less' : 'More'"
            @click="toggle(index)"
          />
          <UButton
            size="xs"
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            aria-label="Remove field"
            @click="remove(index)"
          />
        </div>
      </div>
      <div
        v-if="expanded.has(index)"
        class="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5"
      >
        <UFormField label="Default (JSON)">
          <UInput
            :model-value="defaultText(field)"
            size="sm"
            @update:model-value="setDefault(field, $event)"
          />
        </UFormField>
        <UFormField label="Min">
          <UInput
            :model-value="numberText(field, 'min')"
            type="number"
            size="sm"
            @update:model-value="setNumber(field, 'min', $event)"
          />
        </UFormField>
        <UFormField label="Max">
          <UInput
            :model-value="numberText(field, 'max')"
            type="number"
            size="sm"
            @update:model-value="setNumber(field, 'max', $event)"
          />
        </UFormField>
        <UFormField label="Pattern">
          <UInput
            :model-value="text(field, 'pattern')"
            size="sm"
            @update:model-value="setText(field, 'pattern', $event, true)"
          />
        </UFormField>
        <UFormField label="Pattern message">
          <UInput
            :model-value="text(field, 'patternMessage')"
            size="sm"
            @update:model-value="setText(field, 'patternMessage', $event, true)"
          />
        </UFormField>
      </div>
    </div>
    <UButton
      size="sm"
      color="neutral"
      variant="outline"
      icon="i-lucide-plus"
      label="Add field"
      @click="add"
    />
  </div>
</template>
