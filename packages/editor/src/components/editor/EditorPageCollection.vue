<script setup lang="ts">
import { computed } from 'vue'
import PageUsesPanel from '../../design/PageUsesPanel.vue'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * The page settings' detail page rows (S34.7): the Collection the page is a
 * template of, and on a detail page its path pattern. The module has no detail pages
 * yet (`setPageCollection` and `createDetailPage` are the adapter's stubs: no action
 * sets a page's `params` or makes a detail page), so the Collection select is shown
 * disabled with a "coming soon" hint; a path with a parameter (`/posts/:slug`) and a
 * query use make one by hand, which the rows below it and the P5 "Data this page
 * uses" panel (`PageUsesPanel`) show.
 */
const editor = useEditor()

const NONE = '__none'
const page = computed(() => editor.currentPage)
const items = [{ label: 'None', value: NONE, description: 'A plain page' }]
</script>

<template>
  <template v-if="page">
    <EditorRow
      label="Collection"
      title="Collection: the page is a template, rendered once per record"
      data-page-collection
    >
      <EditorSelect
        :model-value="NONE"
        :items="items"
        disabled
        aria-label="Page collection"
      />
    </EditorRow>
    <p
      class="-mt-1 ps-24 text-[11px] text-dimmed"
      data-page-collection-soon
    >
      Detail pages from a collection are coming soon. For now, give the page a path with a parameter (/posts/:slug) and the query it reads.
    </p>
    <p
      v-if="page.params?.length"
      class="-mt-1 ps-24 text-[11px] text-dimmed"
      data-page-path
    >
      {{ page.path }}
    </p>
    <PageUsesPanel :page="page" />
  </template>
</template>
