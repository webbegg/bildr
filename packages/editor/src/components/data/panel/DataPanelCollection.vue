<script setup lang="ts">
import { computed } from 'vue'
import { useDataSidebarTab } from '../../../editor/dataSidebar.ts'
import { useEditor } from '../../../editor/useEditor.ts'
import { detailPagesOf } from '../../../shared/dataModel.ts'
import type { DataCollection } from '../../../shared/dataModel.ts'

/**
 * The collection panel: its name, plural and whether the app serves its list, where it is stored,
 * its detail pages ("Detail page: <name>", which opens it on the Canvas), then a connection
 * collection's endpoints. Fields opens the sidebar's Fields tab. Every edit is `entity_update`.
 *
 * Not in the module: the slug and the public create flag (the generated names stay the plural's
 * and the create action's), the legacy one-URL API source, and "Create detail page" (a detail
 * page is a page with a route parameter and a query use: made on the Canvas, Pages).
 */
const props = defineProps<{ collection: DataCollection }>()
const editor = useEditor()
const sidebarTab = useDataSidebarTab()
const rest = computed(() => props.collection.kind === 'rest')
const detailPages = computed(() => editor.model ? detailPagesOf(editor.model, props.collection.id) : [])

function openPage(pageId: string) {
  editor.mode = 'build'
  editor.sidebarPanel = 'pages'
  editor.selectPage(pageId)
}

function update(patch: Record<string, unknown>) {
  return editor.run('entity_update', { entity: props.collection.id, ...patch })
}
</script>

<template>
  <div data-collection-panel>
    <DataPanelHead
      :icon="rest ? 'i-lucide-globe' : 'i-lucide-database'"
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
        label="Plural"
        title="Plural, names the generated code and the list route"
        name="plural"
      >
        <EditorCommitInput
          :model-value="collection.plural"
          aria-label="Collection plural"
          size="xs"
          variant="soft"
          @commit="update({ plural: $event })"
        />
      </EditorRow>
      <EditorRow
        label="App list"
        title="The app serves its rows at a list route, and queries read them"
        name="expose"
      >
        <EditorSwitch
          :model-value="collection.exposed"
          aria-label="App list"
          data-flag="expose"
          @update:model-value="update({ expose: $event })"
        />
      </EditorRow>
      <EditorRow
        label="Create"
        title="The action that adds a row (forms use it)"
        name="create"
      >
        <span
          class="flex h-[30px] min-w-0 flex-1 items-center truncate text-[12px] text-toned"
          :title="collection.createAction"
          data-create-action
        >{{ collection.createAction ?? 'No create action' }}</span>
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
        v-if="rest"
        label="Connection"
        name="connection"
      >
        <button
          type="button"
          class="flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted hover:bg-white/4 hover:text-highlighted"
          title="Show the connection"
          data-show-connection
          @click="editor.connectionId = collection.datasource"
        >
          <UIcon
            name="i-lucide-server"
            class="size-3.5 shrink-0"
          />
          <span class="truncate">{{ collection.datasourceName }}</span>
        </button>
      </EditorRow>
      <EditorRow
        v-else
        label="Stored in"
        title="The data source its repository uses"
        name="datasource"
      >
        <span
          class="flex h-[30px] min-w-0 flex-1 items-center gap-1.5 px-2 text-[12px] text-toned"
          data-stored-in
        >
          <UIcon
            name="i-lucide-database"
            class="size-3.5 shrink-0"
          />
          <span class="truncate">{{ collection.datasourceName }} ({{ collection.kind }})</span>
        </span>
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
      <p
        v-if="!detailPages.length"
        class="text-[11px] text-dimmed"
        data-no-detail-page
      >
        A page rendered once per row has a route parameter and reads {{ collection.name }} with a query. Make one on the Canvas, in Pages.
      </p>
    </EditorStyleSection>

    <DataPanelEndpoints
      v-if="rest"
      :collection="collection"
    />
  </div>
</template>
