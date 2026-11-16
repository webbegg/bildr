<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useEditor } from '../../../editor/useEditor.ts'
import { FIELD_TYPE_ICONS, FIELD_TYPE_LABELS, fieldTypeItems } from '../../../shared/dataModel.ts'
import type { FieldType } from '../../../shared/dataModel.ts'

/**
 * The Data workspace's Fields tab, Framer CMS's: the shown collection's fields, one row each.
 * The name and type edit in place (`entity_field_update`), the grip drags a field to another
 * position (`entity_field_move`), the row "−" removes it (`entity_field_remove`) and `+ Add…`
 * opens the add form (`entity_field_add`). A collection read through a connection lists its
 * mapping read-only (Edit mapping changes it). A field has a name, no separate label: the
 * model's actions camelCase what is typed, and refuse a name or type the model still uses.
 */
const editor = useEditor()
const collection = computed(() => editor.collection)
const mapped = computed(() => collection.value?.kind === 'rest')
const connection = computed(() => editor.connections.find(entry => entry.id === collection.value?.datasource))
const ROW = 'flex h-9 items-center gap-1.5 rounded-lg ps-1 pe-1.5'

function updateField(id: string, patch: { name?: string, type?: FieldType }) {
  if (collection.value) return editor.run('entity_field_update', { entity: collection.value.id, field: id, ...patch })
}

// Bumped to remount a name field whose edit was refused, so it shows the saved name again.
const nameResets = ref(0)
// The inline name: transparent in the row until hovered or focused, then the kit's field.
const NAME_UI = { base: 'bg-transparent px-1.5 text-toned hover:bg-white/4 focus-visible:bg-elevated focus-visible:text-highlighted' }

async function commitName(id: string, value: string) {
  const field = collection.value?.fields.find(entry => entry.id === id)
  const name = value.trim()
  if (!field || !name || name === field.name || !await updateField(id, { name })) nameResets.value++
}

async function removeField(id: string) {
  const field = collection.value?.fields.find(entry => entry.id === id)
  if (!collection.value || !field) return
  if (editor.collectionRows.length && !await editor.confirm({ title: `Remove the field "${field.name}"?`, description: 'Its values stay in the rows already stored. Undo brings the field back.', confirmLabel: 'Remove field', danger: true })) return
  await editor.run('entity_field_remove', { entity: collection.value.id, field: id })
}

const adding = ref(false)
const newName = ref('')
const newType = ref<FieldType>('text')
const nameInput = useTemplateRef<{ focus: () => void }>('nameInput')

async function openAdd() {
  newType.value = 'text'
  newName.value = ''
  adding.value = true
  await nextTick()
  nameInput.value?.focus()
}

watch(() => collection.value?.id, () => {
  adding.value = false
})

async function addField() {
  if (!collection.value) return
  const name = newName.value.trim()
  if (!name) return
  if (await editor.run('entity_field_add', { entity: collection.value.id, name, type: newType.value })) adding.value = false
}

const dragId = ref<string | null>(null)
/** Where the dragged field would land: the insertion slot (0 … field count) in the current order. */
const dropSlot = ref<number | null>(null)

function onDragStart(event: DragEvent, id: string) {
  dragId.value = id
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', id)
  const row = (event.currentTarget as HTMLElement).closest('[data-field]')
  if (row) event.dataTransfer.setDragImage(row, 12, 18)
}

function onDragOver(event: DragEvent, index: number) {
  if (!dragId.value) return
  event.preventDefault()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropSlot.value = event.clientY < box.top + box.height / 2 ? index : index + 1
}

function onDrop() {
  const id = dragId.value
  const slot = dropSlot.value
  onDragEnd()
  if (!id || slot === null || !collection.value) return
  const from = collection.value.fields.findIndex(entry => entry.id === id)
  const index = slot > from ? slot - 1 : slot
  if (from >= 0 && index !== from) editor.run('entity_field_move', { entity: collection.value.id, field: id, index })
}

function onDragEnd() {
  dragId.value = null
  dropSlot.value = null
}

const editingMapping = ref(false)
</script>

<template>
  <div
    class="overflow-y-auto pb-2"
    data-fields-tab
  >
    <p
      v-if="!collection"
      class="px-3.5 pt-3 text-[12px] text-dimmed"
    >
      No collection yet.
    </p>

    <template v-else>
      <p
        class="flex h-11 items-center ps-3.5 pe-2 text-[12px] font-[550] text-highlighted"
        data-fields-title
      >
        {{ collection.fields.length }} {{ collection.fields.length === 1 ? 'field' : 'fields' }}
      </p>
      <p
        v-if="!collection.fields.length"
        class="px-3.5 pb-2 text-xs text-dimmed"
        data-fields-empty
      >
        {{ mapped ? 'No fields yet. Edit the mapping to add them.' : 'No fields yet. Add the first one below.' }}
      </p>

      <div
        v-if="mapped"
        class="px-2"
      >
        <div
          v-for="field in collection.fields"
          :key="field.id"
          :class="ROW"
          class="ps-2.5 text-[12px] text-toned"
          :title="`${field.name} ← ${field.remote ?? field.name}`"
          :data-field="field.name"
        >
          <UIcon
            :name="FIELD_TYPE_ICONS[field.type]"
            class="size-4 shrink-0 text-dimmed"
          />
          <span class="truncate">{{ field.name }}</span>
          <code class="ms-auto truncate ps-2 text-[11px] text-dimmed">{{ field.remote ?? field.name }}</code>
        </div>
        <EditorButton
          icon="i-lucide-pencil"
          label="Edit mapping"
          block
          class="mt-2"
          :disabled="!connection"
          data-edit-mapping
          @click="editingMapping = true"
        />
        <DataConnectionSource
          v-if="connection"
          v-model:open="editingMapping"
          :connection="connection"
          :collection="collection"
          title="Edit the API mapping"
          :description="collection.name"
        />
      </div>

      <div
        v-else
        class="px-2"
      >
        <div
          v-for="(field, index) in collection.fields"
          :key="field.id"
          class="group/field relative"
          :class="[ROW, { 'opacity-40': dragId === field.id }]"
          :data-field="field.name"
          @dragover="onDragOver($event, index)"
          @drop.prevent="onDrop"
        >
          <div
            v-if="dropSlot === index"
            class="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-(--editor-selection)"
          />
          <div
            v-if="dropSlot === index + 1 && index === collection.fields.length - 1"
            class="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-(--editor-selection)"
          />
          <span
            draggable="true"
            class="grid h-6 w-3.5 shrink-0 cursor-grab place-items-center text-dimmed opacity-0 group-hover/field:opacity-100 hover:text-highlighted active:cursor-grabbing"
            :aria-label="`Drag to reorder ${field.name}`"
            title="Drag to reorder"
            data-field-handle
            @dragstart="onDragStart($event, field.id)"
            @dragend="onDragEnd"
          >
            <UIcon
              name="i-lucide-grip-vertical"
              class="size-3.5"
            />
          </span>
          <EditorSelect
            :model-value="field.type"
            :items="fieldTypeItems"
            compact
            :aria-label="`Type of ${field.name}`"
            :ui="{ content: 'min-w-32' }"
            :title="FIELD_TYPE_LABELS[field.type]"
            data-field-type
            @update:model-value="updateField(field.id, { type: $event as FieldType })"
          />
          <EditorInput
            :key="`${field.name}:${nameResets}`"
            :model-value="field.name"
            commit="change"
            :aria-label="`Name of ${field.name}`"
            :title="`${field.label} (${field.name})`"
            :ui="NAME_UI"
            class="min-w-0 flex-1"
            data-field-label-input
            @commit="commitName(field.id, $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @keydown.esc="($event.target as HTMLInputElement).blur()"
          />
          <button
            type="button"
            class="grid size-6 shrink-0 place-items-center rounded-lg text-dimmed opacity-0 group-hover/field:opacity-100 group-focus-within/field:opacity-100 hover:bg-white/8 hover:text-highlighted focus-visible:opacity-100"
            :aria-label="`Remove ${field.name}`"
            :title="`Remove ${field.name}`"
            data-row-remove
            @click="removeField(field.id)"
          >
            <UIcon
              name="i-lucide-minus"
              class="size-3.5"
            />
          </button>
        </div>

        <form
          v-if="adding"
          class="mt-1 space-y-2 rounded-lg bg-white/4 p-2"
          data-add-field
          @submit.prevent="addField"
          @keydown.esc="adding = false"
        >
          <EditorInput
            ref="nameInput"
            v-model="newName"
            placeholder="Name, e.g. Served from"
            aria-label="New field name"
            data-new-field-label
          />
          <EditorSelect
            :model-value="newType"
            :items="fieldTypeItems"
            :icon="FIELD_TYPE_ICONS[newType]"
            aria-label="New field type"
            :ui="{ content: 'min-w-32' }"
            data-new-field-type
            @update:model-value="newType = $event as FieldType"
          />
          <div class="flex justify-end gap-1.5">
            <EditorButton
              label="Cancel"
              variant="ghost"
              size="xs"
              @click="adding = false"
            />
            <EditorButton
              type="submit"
              label="Add field"
              variant="primary"
              size="xs"
              :disabled="!newName.trim()"
            />
          </div>
        </form>
        <button
          v-else
          type="button"
          class="flex h-9 w-full items-center gap-1.5 rounded-lg ps-6 text-left text-[12px] text-muted hover:bg-white/4 hover:text-toned"
          aria-label="Add field"
          @click="openAdd"
        >
          <span class="grid size-7 shrink-0 place-items-center">
            <UIcon
              name="i-lucide-plus"
              class="size-4"
            />
          </span>
          <span class="px-1.5">Add…</span>
        </button>
      </div>
    </template>
  </div>
</template>
