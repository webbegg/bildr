<script setup lang="ts">
import type { Collection } from '#shared/document/schema'

/** The collection panel: its name, slug and public flags, the API source of a synced collection, and the fields. */
const props = defineProps<{ collection: Collection }>()
const editor = useEditor()
const apiSource = computed(() => (props.collection.source.type === 'api' ? props.collection.source : null))
const editingMapping = ref(false)

function update(patch: Record<string, unknown>) {
  return editor.run('collection_update', { collection: props.collection.id, ...patch })
}
</script>

<template>
  <div data-collection-panel>
    <DataPanelHead
      :icon="apiSource ? 'i-lucide-globe' : 'i-lucide-database'"
      :title="collection.name"
    />

    <EditorStyleSection label="Collection">
      <EditorRow
        label="Name"
        name="name"
      >
        <EditorCommitInput
          :model-value="collection.name"
          aria-label="Collection name"
          size="xs"
          variant="soft"
          @commit="update({ name: $event })"
        />
      </EditorRow>
      <EditorRow
        label="Slug"
        title="Slug, used by agents and published apps"
        name="slug"
      >
        <EditorCommitInput
          :model-value="collection.slug"
          aria-label="Collection slug"
          size="xs"
          variant="soft"
          @commit="update({ slug: $event })"
        />
      </EditorRow>
      <EditorRow
        label="Public read"
        title="Published apps can list the records"
        name="publicRead"
      >
        <USwitch
          :model-value="collection.publicRead"
          size="sm"
          aria-label="Public read"
          data-flag="publicRead"
          @update:model-value="update({ publicRead: $event })"
        />
      </EditorRow>
      <EditorRow
        v-if="!apiSource"
        label="Public create"
        title="Published apps can add records (forms)"
        name="publicCreate"
      >
        <USwitch
          :model-value="collection.publicCreate"
          size="sm"
          aria-label="Public create"
          data-flag="publicCreate"
          @update:model-value="update({ publicCreate: $event })"
        />
      </EditorRow>
    </EditorStyleSection>

    <EditorStyleSection
      v-if="apiSource"
      label="Source"
    >
      <EditorRow
        label="URL"
        :title="apiSource.url"
        name="url"
      >
        <a
          :href="apiSource.url"
          target="_blank"
          rel="noopener noreferrer"
          class="truncate font-mono text-xs text-toned hover:text-highlighted hover:underline"
          data-api-source-url
        >{{ apiSource.url }}</a>
      </EditorRow>
      <EditorRow
        label="Items"
        title="Items path in the response"
        name="itemsPath"
      >
        <code class="truncate text-xs text-toned">{{ apiSource.itemsPath || '(root)' }}</code>
      </EditorRow>
      <UButton
        icon="i-lucide-pencil"
        label="Edit mapping"
        size="sm"
        color="neutral"
        variant="soft"
        block
        data-edit-mapping
        @click="editingMapping = true"
      />
      <UModal
        v-model:open="editingMapping"
        title="Edit the API mapping"
        :description="collection.name"
        :ui="{ content: 'sm:max-w-5xl' }"
      >
        <template #body>
          <DataApiSource
            :collection="collection"
            @done="editingMapping = false"
          />
        </template>
      </UModal>
    </EditorStyleSection>

    <DataPanelFields :collection="collection" />
  </div>
</template>
