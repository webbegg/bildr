<script setup lang="ts">
import type { Collection } from '#shared/document/schema'
import { useDataSidebarTab } from '../DataCollections.vue'

/**
 * The collection panel: its name, slug and public flags, its detail page
 * ("Detail page: <name>", which opens it on the Canvas, or "Create detail
 * page"), then the API source of a synced collection or a connection
 * collection's endpoints. Fields opens the sidebar's Fields tab.
 */
const props = defineProps<{ collection: Collection }>()
const editor = useEditor()
const sidebarTab = useDataSidebarTab()
const apiSource = computed(() => (props.collection.source.type === 'api' ? props.collection.source : null))
const connectionSource = computed(() => (props.collection.source.type === 'connection' ? props.collection.source : null))
const editingMapping = ref(false)
const detailPages = computed(() => editor.project?.pages.filter(p => p.collection?.slug === props.collection.slug) ?? [])
const creating = ref(false)

function openPage(pageId: string) {
  editor.mode = 'build'
  editor.sidebarPanel = 'pages'
  editor.selectPage(pageId)
}

async function createDetailPage() {
  creating.value = true
  try {
    await editor.createDetailPage(props.collection.slug)
  } finally {
    creating.value = false
  }
}

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
        <EditorSwitch
          :model-value="collection.publicRead"
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
        <EditorSwitch
          :model-value="collection.publicCreate"
          aria-label="Public create"
          data-flag="publicCreate"
          @update:model-value="update({ publicCreate: $event })"
        />
      </EditorRow>
      <EditorRow
        label="Fields"
        name="fields"
      >
        <button
          type="button"
          class="flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted hover:bg-white/4 hover:text-highlighted"
          title="Edit the fields in the sidebar"
          data-show-fields
          @click="sidebarTab = 'fields'"
        >
          <span class="truncate">{{ collection.fields.length }} {{ collection.fields.length === 1 ? 'field' : 'fields' }}</span>
          <UIcon
            name="i-lucide-arrow-left"
            class="ms-auto size-3.5 shrink-0"
          />
        </button>
      </EditorRow>
      <EditorRow
        v-if="connectionSource"
        label="Connection"
        name="connection"
      >
        <button
          type="button"
          class="flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted hover:bg-white/4 hover:text-highlighted"
          title="Show the connection"
          data-show-connection
          @click="editor.connectionId = connectionSource.connectionId"
        >
          <UIcon
            name="i-lucide-server"
            class="size-3.5 shrink-0"
          />
          <span class="truncate">{{ editor.project?.connections.find(c => c.id === connectionSource!.connectionId)?.name }}</span>
        </button>
      </EditorRow>
    </EditorStyleSection>

    <EditorStyleSection
      label="Detail page"
      data-detail-page-section
    >
      <EditorRow
        v-for="page in detailPages"
        :key="page.id"
        label="Detail page"
        :title="`Detail page: ${page.name}`"
        name="detailPage"
      >
        <button
          type="button"
          class="flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted hover:bg-white/4 hover:text-highlighted"
          :title="`Open ${page.name} on the Canvas`"
          :aria-label="`Detail page: ${page.name}`"
          :data-open-detail-page="page.id"
          @click="openPage(page.id)"
        >
          <UIcon
            name="i-lucide-file-text"
            class="size-3.5 shrink-0"
          />
          <span class="truncate">{{ page.name }}</span>
          <UIcon
            name="i-lucide-arrow-up-right"
            class="ms-auto size-3.5 shrink-0"
          />
        </button>
      </EditorRow>
      <template v-if="!detailPages.length">
        <EditorButton
          icon="i-lucide-file-plus"
          label="Create detail page"
          block
          :loading="creating"
          data-create-detail-page
          @click="createDetailPage"
        />
        <p class="pt-1.5 text-[11px] text-dimmed">
          A page rendered once per record, with a title and body bound to its fields.
        </p>
      </template>
    </EditorStyleSection>

    <DataPanelEndpoints
      v-if="connectionSource"
      :collection="collection"
      :source="connectionSource"
    />

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
      <EditorButton
        icon="i-lucide-pencil"
        label="Edit mapping"
        block
        data-edit-mapping
        @click="editingMapping = true"
      />
      <DataApiSource
        v-model:open="editingMapping"
        :collection="collection"
        title="Edit the API mapping"
        :description="collection.name"
      />
    </EditorStyleSection>
  </div>
</template>
