<script setup lang="ts">
import { FIELD_TYPES } from '#shared/document/schema'
import type { Collection, FieldType } from '#shared/document/schema'

/** The schema of the shown collection: name, slug, public flags and fields. Every edit is one undo step. */
const editor = useEditor()
const collection = computed(() => editor.collection as Collection)

const TYPE_ICONS: Record<FieldType, string> = {
  text: 'i-lucide-type',
  number: 'i-lucide-hash',
  boolean: 'i-lucide-toggle-left',
  date: 'i-lucide-calendar',
  image: 'i-lucide-image'
}
const typeItems = FIELD_TYPES.map(type => ({ label: type, value: type, icon: TYPE_ICONS[type] }))

const newKey = ref('')
const newType = ref<FieldType>('text')

function update(patch: Record<string, unknown>) {
  return editor.run('collection_update', { collection: collection.value.id, ...patch })
}

function updateField(key: string, patch: { label?: string, type?: FieldType }) {
  return editor.run('field_update', { collection: collection.value.id, key, ...patch })
}

async function addField() {
  const key = newKey.value.trim()
  if (!key) return
  if (await editor.run('field_add', { collection: collection.value.id, key, type: newType.value })) {
    newKey.value = ''
    newType.value = 'text'
  }
}
</script>

<template>
  <section
    class="space-y-4 rounded-lg bg-default p-4 shadow-sm ring ring-default"
    data-schema
  >
    <div class="grid grid-cols-2 gap-3">
      <UFormField
        label="Name"
        size="xs"
      >
        <EditorCommitInput
          :model-value="collection.name"
          @commit="update({ name: $event })"
        />
      </UFormField>
      <UFormField
        label="Slug"
        size="xs"
        help="Used by agents and published apps"
      >
        <EditorCommitInput
          :model-value="collection.slug"
          @commit="update({ slug: $event })"
        />
      </UFormField>
    </div>

    <div class="flex flex-wrap gap-6">
      <USwitch
        :model-value="collection.publicRead"
        label="Public read"
        description="Published apps can list the records"
        data-flag="publicRead"
        @update:model-value="update({ publicRead: $event })"
      />
      <USwitch
        :model-value="collection.publicCreate"
        label="Public create"
        description="Published apps can add records (forms)"
        data-flag="publicCreate"
        @update:model-value="update({ publicCreate: $event })"
      />
    </div>

    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-xs text-muted">
          <th class="w-1/3 pb-1 font-medium">
            Key
          </th>
          <th class="pb-1 font-medium">
            Label
          </th>
          <th class="w-36 pb-1 font-medium">
            Type
          </th>
          <th class="w-8" />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="field in collection.fields"
          :key="field.key"
          :data-field="field.key"
        >
          <td class="py-1 pe-2 font-mono text-xs">
            {{ field.key }}
          </td>
          <td class="py-1 pe-2">
            <EditorCommitInput
              :model-value="field.label"
              @commit="updateField(field.key, { label: $event })"
            />
          </td>
          <td class="py-1 pe-2">
            <USelect
              :model-value="field.type"
              :items="typeItems"
              size="sm"
              class="w-full"
              @update:model-value="updateField(field.key, { type: $event as FieldType })"
            />
          </td>
          <td class="py-1">
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="neutral"
              variant="ghost"
              :aria-label="`Remove field ${field.key}`"
              @click="editor.run('field_remove', { collection: collection.id, key: field.key })"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p
      v-if="!collection.fields.length"
      class="text-xs text-dimmed"
    >
      No fields yet.
    </p>

    <form
      class="flex items-center gap-2"
      data-add-field
      @submit.prevent="addField"
    >
      <UInput
        v-model="newKey"
        size="sm"
        placeholder="New field key, e.g. price"
        class="flex-1"
      />
      <USelect
        v-model="newType"
        :items="typeItems"
        size="sm"
        class="w-36"
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
    <p class="text-xs text-dimmed">
      Changing a type or removing a field keeps the stored values: ones that no longer fit read as empty, and undo brings them back.
    </p>
  </section>
</template>
