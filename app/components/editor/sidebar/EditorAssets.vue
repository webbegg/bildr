<script setup lang="ts">
import { filterByName } from '#shared/editor/sidebar'

/**
 * The Assets panel: Styles (the project theme, previewed live on the canvas,
 * with an expandable token preview sheet) and Collections, each opening the
 * Data view on it. The sidebar search filters both by name.
 */
const { query = '' } = defineProps<{ query?: string }>()
const editor = useEditor()
const tokensOpen = ref(false)
const collections = computed(() => filterByName(editor.project?.collections ?? [], query))

function openCollection(id?: string) {
  if (id) editor.collectionId = id
  editor.mode = 'data'
}
</script>

<template>
  <div
    class="space-y-5 overflow-y-auto px-3 pt-2 pb-4"
    data-assets
  >
    <section data-assets-styles>
      <p class="mb-2 text-xs font-semibold text-muted uppercase">
        Styles
      </p>
      <EditorDesignPanel :query="query" />
      <button
        type="button"
        class="mt-3 flex w-full items-center gap-1.5 text-xs text-muted hover:text-highlighted"
        :aria-expanded="tokensOpen"
        data-preview-tokens
        @click="tokensOpen = !tokensOpen"
      >
        <UIcon
          name="i-lucide-chevron-right"
          class="size-3 transition-transform"
          :class="{ 'rotate-90': tokensOpen }"
        />
        Preview tokens
      </button>
      <EditorCanvas
        v-if="tokensOpen"
        view="tokens"
        class="mt-2"
        style="height: 420px"
      />
    </section>

    <section data-assets-collections>
      <div class="mb-1 flex items-center justify-between">
        <p class="text-xs font-semibold text-muted uppercase">
          Collections
        </p>
        <UButton
          icon="i-lucide-arrow-up-right"
          label="Data"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="openCollection()"
        />
      </div>
      <p
        v-if="!collections.length"
        class="py-1 text-xs text-dimmed"
      >
        {{ query ? `No collections match “${query}”.` : 'No collections yet. Add one in the Data view.' }}
      </p>
      <button
        v-for="collection in collections"
        :key="collection.id"
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-toned hover:bg-elevated"
        :data-asset-collection="collection.slug"
        @click="openCollection(collection.id)"
      >
        <UIcon
          :name="collection.source.type === 'api' ? 'i-lucide-globe' : 'i-lucide-database'"
          class="size-3.5 shrink-0"
        />
        <span class="truncate">{{ collection.name }}</span>
        <span class="ms-auto text-xs text-dimmed">{{ collection.fields.length }} {{ collection.fields.length === 1 ? 'field' : 'fields' }}</span>
      </button>
    </section>
  </div>
</template>
