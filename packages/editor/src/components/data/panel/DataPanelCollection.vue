<script setup lang="ts">
import { computed, ref } from 'vue'
import { confirmRenameCollection } from '../../../editor/usageWarnings.ts'
import { useEditor } from '../../../editor/useEditor.ts'
import { detailPagesOf } from '../../../shared/dataModel.ts'
import type { DataCollection } from '../../../shared/dataModel.ts'

/**
 * The collection's settings, beside its Fields tab: its name, plural and whether the app serves its
 * list, where it is stored, and its detail pages ("Detail page: <name>", which opens it on the Canvas).
 * A connection collection's endpoints are its Endpoints tab. Every edit is `entity_update`; a rename of a used
 * collection asks first.
 *
 * Not in the module: the slug and the public create flag (the generated names stay the plural's
 * and the create action's), the legacy one-URL API source, and "Create detail page" (a detail
 * page is a page with a route parameter and a query use: made on the Canvas, Pages).
 */
const props = defineProps<{ collection: DataCollection }>()
const editor = useEditor()
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

// Bumped to remount a name or plural field whose rename was not confirmed, so it shows the saved text again.
const resets = ref(0)

/** A rename of a collection that is used says what it does first; declining puts the text back. */
async function rename(change: 'name' | 'plural', value: string) {
  if (!await confirmRenameCollection(editor, props.collection, change, value)) {
    resets.value++
    return
  }
  await update({ [change]: value })
}
</script>

<template>
  <div data-collection-panel>
    <EditorStyleSection label="Collection">
      <EditorRow
        label="Name"
        name="name"
      >
        <EditorCommitInput
          :key="`name:${resets}`"
          :model-value="collection.name"
          aria-label="Collection name"
          size="xs"
          variant="soft"
          @commit="rename('name', $event)"
        />
      </EditorRow>
      <EditorRow
        label="Plural"
        title="Plural, names the generated code and the list route"
        name="plural"
      >
        <EditorCommitInput
          :key="`plural:${resets}`"
          :model-value="collection.plural"
          aria-label="Collection plural"
          size="xs"
          variant="soft"
          @commit="rename('plural', $event)"
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
        title="Where its rows are stored"
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
  </div>
</template>
