<script setup lang="ts">
import { fieldKey } from '#shared/document/collections'
import { FIELD_TYPES } from '#shared/document/schema'
import type { FieldType } from '#shared/document/schema'

/**
 * The Data sidebar's Fields tab, Framer CMS's: the shown collection's fields,
 * one row each. The label and type edit in place, the grip drags a field to
 * another position (`field_move`), the row "−" removes it and `+ Add…` opens
 * the add form. API and connection collections list their mapping
 * read-only (Edit mapping changes it).
 */
const editor = useEditor()
const collection = computed(() => editor.collection)
const live = computed(() => collection.value?.source.type === 'api')
const mapped = computed(() => collection.value?.source.type !== 'internal')
const connection = computed(() => {
  const source = collection.value?.source
  return source?.type === 'connection' ? editor.project?.connections.find(c => c.id === source.connectionId) : undefined
})

const TYPE_ICONS: Record<FieldType, string> = {
  text: 'i-lucide-type',
  number: 'i-lucide-hash',
  boolean: 'i-lucide-toggle-left',
  date: 'i-lucide-calendar',
  image: 'i-lucide-image'
}
const TYPE_LABELS: Record<FieldType, string> = { text: 'Text', number: 'Number', boolean: 'Toggle', date: 'Date', image: 'Image' }
const typeItems = FIELD_TYPES.map(type => ({ label: TYPE_LABELS[type], value: type, icon: TYPE_ICONS[type] }))
const ROW = 'flex h-9 items-center gap-1.5 rounded-lg ps-1 pe-1.5'

function updateField(key: string, patch: { label?: string, type?: FieldType }) {
  if (collection.value) return editor.run('field_update', { collection: collection.value.id, key, ...patch })
}

// Bumped to remount a label field whose edit was refused, so it shows the label again.
const labelResets = ref(0)
// The inline label: transparent in the row until hovered or focused, then the kit's field.
const LABEL_UI = { base: 'bg-transparent px-1.5 text-toned hover:bg-white/4 focus-visible:bg-elevated focus-visible:text-highlighted' }

function commitLabel(key: string, value: string) {
  const field = collection.value?.fields.find(f => f.key === key)
  const label = value.trim()
  if (!field || !label || label === field.label) labelResets.value++
  else updateField(key, { label })
}

function removeField(key: string) {
  if (!collection.value) return
  if (editor.records.length && !confirm(`Remove the field "${key}"? Its values stay hidden in the records, and undo brings them back.`)) return
  editor.run('field_remove', { collection: collection.value.id, key })
}

const adding = ref(false)
const newLabel = ref('')
const newKey = ref('')
const keyEdited = ref(false)
const newType = ref<FieldType>('text')
const labelInput = useTemplateRef<{ focus: () => void }>('labelInput')

async function openAdd() {
  newType.value = 'text'
  newLabel.value = ''
  newKey.value = ''
  keyEdited.value = false
  adding.value = true
  await nextTick()
  labelInput.value?.focus()
}

watch(newLabel, (label) => {
  if (!keyEdited.value) newKey.value = fieldKey(label)
})

watch(() => collection.value?.id, () => {
  adding.value = false
})

async function addField() {
  if (!collection.value) return
  const label = newLabel.value.trim()
  const key = newKey.value.trim() || fieldKey(label)
  if (!key) return
  const input = { collection: collection.value.id, key, type: newType.value, ...(label ? { label } : {}) }
  if (await editor.run('field_add', input)) adding.value = false
}

const dragKey = ref<string | null>(null)
/** Where the dragged field would land: the insertion slot (0 … field count) in the current order. */
const dropSlot = ref<number | null>(null)

function onDragStart(event: DragEvent, key: string) {
  dragKey.value = key
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', key)
  const row = (event.currentTarget as HTMLElement).closest('[data-field]')
  if (row) event.dataTransfer.setDragImage(row, 12, 18)
}

function onDragOver(event: DragEvent, index: number) {
  if (!dragKey.value) return
  event.preventDefault()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropSlot.value = event.clientY < box.top + box.height / 2 ? index : index + 1
}

function onDrop() {
  const key = dragKey.value
  const slot = dropSlot.value
  onDragEnd()
  if (!key || slot === null || !collection.value) return
  const from = collection.value.fields.findIndex(f => f.key === key)
  const index = slot > from ? slot - 1 : slot
  if (from >= 0 && index !== from) editor.run('field_move', { collection: collection.value.id, key, index })
}

function onDragEnd() {
  dragKey.value = null
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
      <div class="flex h-11 items-center gap-2 ps-3.5 pe-2">
        <UIcon
          :name="live ? 'i-lucide-globe' : 'i-lucide-database'"
          class="size-4 shrink-0 text-dimmed"
        />
        <p
          class="min-w-0 flex-1 truncate text-[12px] font-[550] text-highlighted"
          data-fields-title
        >
          {{ collection.name }}
        </p>
      </div>

      <div
        v-if="mapped"
        class="px-2"
      >
        <div
          v-for="field in collection.fields"
          :key="field.key"
          :class="ROW"
          class="ps-2.5 text-[12px] text-toned"
          :title="`${field.key} ← ${field.path ?? field.key}`"
          :data-field="field.key"
        >
          <UIcon
            :name="TYPE_ICONS[field.type]"
            class="size-4 shrink-0 text-dimmed"
          />
          <span class="truncate">{{ field.label }}</span>
          <code class="ms-auto truncate ps-2 text-[11px] text-dimmed">{{ field.path ?? field.key }}</code>
        </div>
        <EditorButton
          icon="i-lucide-pencil"
          label="Edit mapping"
          block
          class="mt-2"
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
        <DataApiSource
          v-else-if="live"
          v-model:open="editingMapping"
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
          :key="field.key"
          class="group/field relative"
          :class="[ROW, { 'opacity-40': dragKey === field.key }]"
          :data-field="field.key"
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
            :aria-label="`Drag to reorder ${field.label}`"
            title="Drag to reorder"
            data-field-handle
            @dragstart="onDragStart($event, field.key)"
            @dragend="onDragEnd"
          >
            <UIcon
              name="i-lucide-grip-vertical"
              class="size-3.5"
            />
          </span>
          <EditorSelect
            :model-value="field.type"
            :items="typeItems"
            compact
            :aria-label="`Type of ${field.key}`"
            :ui="{ content: 'min-w-32' }"
            :title="TYPE_LABELS[field.type]"
            data-field-type
            @update:model-value="updateField(field.key, { type: $event as FieldType })"
          />
          <EditorInput
            :key="`${field.label}:${labelResets}`"
            :model-value="field.label"
            commit="change"
            :aria-label="`Label of ${field.key}`"
            :title="`Key: ${field.key}`"
            :ui="LABEL_UI"
            class="min-w-0 flex-1"
            data-field-label-input
            @commit="commitLabel(field.key, $event)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @keydown.esc="($event.target as HTMLInputElement).blur()"
          />
          <button
            type="button"
            class="grid size-6 shrink-0 place-items-center rounded-lg text-dimmed opacity-0 group-hover/field:opacity-100 group-focus-within/field:opacity-100 hover:bg-white/8 hover:text-highlighted focus-visible:opacity-100"
            :aria-label="`Remove ${field.key}`"
            :title="`Remove ${field.label}`"
            data-row-remove
            @click="removeField(field.key)"
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
            ref="labelInput"
            v-model="newLabel"
            placeholder="Label, e.g. Served from"
            aria-label="New field label"
            data-new-field-label
          />
          <EditorInput
            v-model="newKey"
            mono
            placeholder="Key, e.g. servedFrom"
            aria-label="New field key"
            data-new-field-key
            @update:model-value="keyEdited = true"
          />
          <EditorSelect
            :model-value="newType"
            :items="typeItems"
            :icon="TYPE_ICONS[newType]"
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
              :disabled="!newKey.trim() && !fieldKey(newLabel)"
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
