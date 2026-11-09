<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { DataRecord, RecordValue } from '#shared/data/records'
import type { Collection } from '#shared/document/schema'

/** The records of the shown collection, with add, edit (in a modal) and delete. Records are not undoable. */
const editor = useEditor()
const collection = computed(() => editor.collection as Collection)

const columns = computed<TableColumn<DataRecord>[]>(() => [
  ...collection.value.fields.map(field => ({ id: field.key, header: field.label, accessorFn: (r: DataRecord) => r.values[field.key] })),
  { id: 'actions', header: '' }
])

const open = ref(false)
const editingId = ref<string | null>(null)
const draft = ref<Record<string, RecordValue>>({})
const saving = ref(false)

function edit(record?: DataRecord) {
  editingId.value = record?.id ?? null
  draft.value = Object.fromEntries(collection.value.fields.map(f => [f.key, record?.values[f.key] ?? (f.type === 'boolean' ? false : null)]))
  open.value = true
}

async function save() {
  saving.value = true
  const result = editingId.value
    ? await editor.runData('record_update', { recordId: editingId.value, values: draft.value })
    : await editor.runData('record_create', { values: draft.value })
  saving.value = false
  if (result) open.value = false
}

function remove(record: DataRecord) {
  if (confirm('Delete this record? This cannot be undone.')) editor.runData('record_delete', { recordId: record.id })
}

function display(value: RecordValue): string {
  return value === null || value === '' ? '—' : String(value)
}
</script>

<template>
  <section
    class="space-y-3 rounded-lg bg-default p-4 shadow-sm ring ring-default"
    data-records
  >
    <div class="flex items-center gap-2">
      <p class="text-sm font-semibold">
        Records
      </p>
      <UBadge
        :label="String(editor.recordsTotal)"
        color="neutral"
        variant="soft"
        size="sm"
      />
      <span
        v-if="editor.recordsTotal > editor.records.length"
        class="text-xs text-dimmed"
      >showing the first {{ editor.records.length }}</span>
      <UButton
        icon="i-lucide-plus"
        label="Add record"
        size="sm"
        class="ms-auto"
        :disabled="!collection.fields.length"
        @click="edit()"
      />
    </div>

    <UTable
      :data="editor.records"
      :columns="columns"
      :empty="collection.fields.length ? 'No records yet.' : 'Add a field first.'"
      class="max-h-[60vh]"
      sticky
    >
      <template
        v-for="field in collection.fields"
        :key="field.key"
        #[`${field.key}-cell`]="{ row }"
      >
        <UIcon
          v-if="field.type === 'boolean' && row.original.values[field.key] !== null"
          :name="row.original.values[field.key] ? 'i-lucide-check' : 'i-lucide-x'"
          :class="row.original.values[field.key] ? 'text-success' : 'text-dimmed'"
        />
        <img
          v-else-if="field.type === 'image' && row.original.values[field.key]"
          :src="String(row.original.values[field.key])"
          alt=""
          class="size-8 rounded object-cover ring ring-default"
        >
        <span
          v-else
          :class="{ 'text-dimmed': row.original.values[field.key] === null }"
        >{{ display(row.original.values[field.key] ?? null) }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end gap-1">
          <UButton
            icon="i-lucide-pencil"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Edit record"
            @click="edit(row.original)"
          />
          <UButton
            icon="i-lucide-trash-2"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Delete record"
            @click="remove(row.original)"
          />
        </div>
      </template>
    </UTable>

    <UModal
      v-model:open="open"
      :title="editingId ? 'Edit record' : 'Add record'"
      :description="collection.name"
    >
      <template #body>
        <form
          id="record-form"
          class="space-y-3"
          @submit.prevent="save"
        >
          <UFormField
            v-for="field in collection.fields"
            :key="field.key"
            :label="field.label"
            :hint="field.type"
            :name="field.key"
          >
            <DataValueInput
              v-model="draft[field.key]!"
              :field="field"
            />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="open = false"
          />
          <UButton
            type="submit"
            form="record-form"
            :label="editingId ? 'Save' : 'Add'"
            :loading="saving"
          />
        </div>
      </template>
    </UModal>
  </section>
</template>
