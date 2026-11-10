<script setup lang="ts">
import type { SectionMenuItem } from '../../editor/EditorStyleSection.vue'
import { fieldKey } from '#shared/document/collections'
import { FIELD_TYPES } from '#shared/document/schema'
import type { Collection, FieldType } from '#shared/document/schema'

/**
 * The Fields section: each field's label and type edit in place, the grip
 * drags it to another position (`field_move`) and the row "−" removes it.
 * The header "+" picks a type and opens the add form. API collections show
 * their mapping read-only (Edit mapping changes it).
 */
const props = defineProps<{ collection: Collection }>()
const editor = useEditor()
const live = computed(() => props.collection.source.type === 'api')

const TYPE_ICONS: Record<FieldType, string> = {
  text: 'i-lucide-type',
  number: 'i-lucide-hash',
  boolean: 'i-lucide-toggle-left',
  date: 'i-lucide-calendar',
  image: 'i-lucide-image'
}
const TYPE_LABELS: Record<FieldType, string> = { text: 'Text', number: 'Number', boolean: 'Toggle', date: 'Date', image: 'Image' }
const typeItems = FIELD_TYPES.map(type => ({ label: TYPE_LABELS[type], value: type, icon: TYPE_ICONS[type] }))
const menu = computed<SectionMenuItem[]>(() => (live.value ? [] : FIELD_TYPES.map(type => ({ id: type, label: TYPE_LABELS[type] }))))
const SELECT_UI = { base: 'h-[30px] rounded-lg bg-elevated text-[13px]', trailingIcon: 'size-3.5 text-dimmed', content: 'min-w-32' }

function updateField(key: string, patch: { label?: string, type?: FieldType }) {
  return editor.run('field_update', { collection: props.collection.id, key, ...patch })
}

function removeField(key: string) {
  if (editor.records.length && !confirm(`Remove the field "${key}"? Its values stay hidden in the records, and undo brings them back.`)) return
  editor.run('field_remove', { collection: props.collection.id, key })
}

const adding = ref(false)
const newLabel = ref('')
const newKey = ref('')
const keyEdited = ref(false)
const newType = ref<FieldType>('text')
const labelInput = useTemplateRef<{ inputRef: HTMLInputElement }>('labelInput')

async function openAdd(type: string) {
  newType.value = type as FieldType
  newLabel.value = ''
  newKey.value = ''
  keyEdited.value = false
  adding.value = true
  await nextTick()
  labelInput.value?.inputRef.focus()
}

watch(newLabel, (label) => {
  if (!keyEdited.value) newKey.value = fieldKey(label)
})

async function addField() {
  const label = newLabel.value.trim()
  const key = newKey.value.trim() || fieldKey(label)
  if (!key) return
  const input = { collection: props.collection.id, key, type: newType.value, ...(label ? { label } : {}) }
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
  if (row) event.dataTransfer.setDragImage(row, 12, 15)
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
  if (!key || slot === null) return
  const from = props.collection.fields.findIndex(f => f.key === key)
  const index = slot > from ? slot - 1 : slot
  if (from >= 0 && index !== from) editor.run('field_move', { collection: props.collection.id, key, index })
}

function onDragEnd() {
  dragKey.value = null
  dropSlot.value = null
}
</script>

<template>
  <EditorStyleSection
    label="Fields"
    :menu="menu"
    @add="openAdd"
  >
    <template v-if="live">
      <EditorRow
        v-for="field in collection.fields"
        :key="field.key"
        :label="field.key"
        :title="`${field.key} ← ${field.path ?? field.key}`"
        :data-field="field.key"
      >
        <span class="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-toned">
          <UIcon
            :name="TYPE_ICONS[field.type]"
            class="size-3.5 shrink-0 text-dimmed"
          />
          <span class="truncate">{{ field.label }}</span>
          <code class="ms-auto truncate text-[11px] text-dimmed">{{ field.path ?? field.key }}</code>
        </span>
      </EditorRow>
    </template>

    <template v-else>
      <div
        v-for="(field, index) in collection.fields"
        :key="field.key"
        class="group/field relative"
        :class="{ 'opacity-40': dragKey === field.key }"
        :data-field="field.key"
        @dragover="onDragOver($event, index)"
        @drop.prevent="onDrop"
      >
        <div
          v-if="dropSlot === index"
          class="pointer-events-none absolute inset-x-0 -top-1 h-0.5 rounded-full bg-(--editor-selection)"
        />
        <div
          v-if="dropSlot === index + 1 && index === collection.fields.length - 1"
          class="pointer-events-none absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-(--editor-selection)"
        />
        <span
          draggable="true"
          class="absolute top-[7px] -left-3.5 grid h-4 w-3 cursor-grab place-items-center text-dimmed opacity-0 group-hover/field:opacity-100 hover:text-highlighted active:cursor-grabbing"
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
        <EditorRow
          :label="field.key"
          :title="`Key: ${field.key}`"
          :name="field.key"
          removable
          @remove="removeField(field.key)"
        >
          <EditorCommitInput
            :model-value="field.label"
            :aria-label="`Label of ${field.key}`"
            size="xs"
            variant="soft"
            data-field-label-input
            @commit="updateField(field.key, { label: $event })"
          />
          <USelect
            :model-value="field.type"
            :items="typeItems"
            :icon="TYPE_ICONS[field.type]"
            :aria-label="`Type of ${field.key}`"
            size="xs"
            variant="soft"
            :ui="SELECT_UI"
            :content="{ align: 'end' }"
            class="w-[52px] shrink-0"
            data-field-type
            @update:model-value="updateField(field.key, { type: $event as FieldType })"
          >
            <template #default>
              <span class="sr-only">{{ TYPE_LABELS[field.type] }}</span>
            </template>
          </USelect>
        </EditorRow>
      </div>

      <p
        v-if="!collection.fields.length && !adding"
        class="text-xs text-dimmed"
      >
        No fields yet. Add one with +.
      </p>

      <form
        v-if="adding"
        class="space-y-2 rounded-lg bg-elevated/50 p-2"
        data-add-field
        @submit.prevent="addField"
        @keydown.esc="adding = false"
      >
        <EditorRow label="Label">
          <UInput
            ref="labelInput"
            v-model="newLabel"
            placeholder="e.g. Served from"
            size="xs"
            variant="soft"
            :ui="{ base: 'h-[30px] rounded-lg bg-elevated text-[13px]' }"
            class="w-full"
            data-new-field-label
          />
        </EditorRow>
        <EditorRow label="Key">
          <UInput
            v-model="newKey"
            placeholder="servedFrom"
            size="xs"
            variant="soft"
            :ui="{ base: 'h-[30px] rounded-lg bg-elevated font-mono text-[12px]' }"
            class="w-full"
            data-new-field-key
            @update:model-value="keyEdited = true"
          />
        </EditorRow>
        <EditorRow label="Type">
          <USelect
            v-model="newType"
            :items="typeItems"
            :icon="TYPE_ICONS[newType]"
            size="xs"
            variant="soft"
            :ui="SELECT_UI"
            class="w-full"
            data-new-field-type
          />
        </EditorRow>
        <div class="flex justify-end gap-1.5">
          <UButton
            label="Cancel"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="adding = false"
          />
          <UButton
            type="submit"
            label="Add field"
            size="xs"
            color="neutral"
            :disabled="!newKey.trim() && !fieldKey(newLabel)"
          />
        </div>
      </form>
    </template>
  </EditorStyleSection>
</template>
