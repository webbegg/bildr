<script setup lang="ts">
import { keyFieldItems } from '#shared/editor/detailPages'
import { bindingItem } from '#shared/runtime/bindings'
import { detailKeyField, detailPath, detailTitle, RECORD_ID_KEY } from '#shared/runtime/detail'

/**
 * The page settings' detail page rows (S34.7): the Collection the page is a
 * template of (None, or a collection), and on a detail page its URL key (a
 * text field, or the record id where that is the default; the path pattern
 * below it) and the record the canvas previews (the first by default), with
 * a warning when visitors can't open it because the collection isn't public.
 */
const editor = useEditor()

const NONE = '__none'
const page = computed(() => editor.currentPage)
const collection = computed(() => editor.detailCollection)
const collectionItems = computed(() => [
  { label: 'None', value: NONE, description: 'A plain page' },
  ...(editor.project?.collections.map(c => ({ label: c.name, value: c.slug, description: `One page per record, at /${page.value?.slug ?? ''}/:${detailKeyField(c)}` })) ?? [])
])
const keyField = computed(() => (collection.value ? detailKeyField(collection.value, page.value?.collection?.field) : RECORD_ID_KEY))
const keyItems = computed(() => keyFieldItems(collection.value ?? undefined))
const path = computed(() => (page.value && editor.project ? detailPath(page.value, editor.project.collections) : ''))

/** A record's name in the picker: its title or name, else its URL key. */
function recordLabel(record: { id: string, values: Record<string, unknown> }): string {
  const key = keyField.value === RECORD_ID_KEY ? record.id : String(record.values[keyField.value] ?? record.id)
  return detailTitle(bindingItem({ id: record.id, createdAt: '', updatedAt: '', values: record.values as never }), key)
}
const recordItems = computed(() => editor.detailRecords.map(r => ({ label: recordLabel(r), value: r.id })))

function setCollection(value: string) {
  void editor.setPageCollection(value === NONE ? null : value)
}

// The record id is the default key, so it is set as no field.
function setKey(value: string) {
  if (collection.value) void editor.setPageCollection(collection.value.slug, value === RECORD_ID_KEY ? undefined : value)
}
</script>

<template>
  <template v-if="page">
    <EditorRow
      label="Collection"
      title="Collection: the page is a template, rendered once per record"
      data-page-collection
    >
      <EditorSelect
        :model-value="page.collection?.slug ?? NONE"
        :items="collectionItems"
        aria-label="Page collection"
        @update:model-value="setCollection"
      />
    </EditorRow>
    <template v-if="page.collection && collection">
      <EditorRow
        label="URL key"
        title="URL key: the field whose value is the record's URL segment"
        data-page-key-field
      >
        <EditorSelect
          :model-value="keyField"
          :items="keyItems"
          aria-label="URL key"
          @update:model-value="setKey"
        />
      </EditorRow>
      <p
        class="-mt-1 ps-24 text-[11px] text-dimmed"
        data-page-path
      >
        {{ path }}
      </p>
      <EditorRow
        label="Preview"
        title="Preview record: the record the canvas shows the page with"
        data-page-preview-record
      >
        <EditorSelect
          :model-value="editor.previewRecord?.id"
          :items="recordItems"
          :placeholder="recordItems.length ? 'Choose a record' : 'No records yet'"
          :disabled="!recordItems.length"
          aria-label="Preview record"
          @update:model-value="editor.setPreviewRecord($event)"
        />
      </EditorRow>
      <div
        v-if="!collection.publicRead"
        class="flex items-start gap-1.5 rounded-lg bg-warning/10 px-2 py-1.5 text-[11px] text-warning"
        role="status"
        data-page-not-public
      >
        <UIcon
          name="i-lucide-triangle-alert"
          class="mt-px size-3.5 shrink-0"
        />
        <span>Visitors can't open this page until the collection is public</span>
      </div>
    </template>
    <p
      v-else-if="page.collection"
      class="text-[11px] text-error"
    >
      Unknown collection “{{ page.collection.slug }}”
    </p>
  </template>
</template>
