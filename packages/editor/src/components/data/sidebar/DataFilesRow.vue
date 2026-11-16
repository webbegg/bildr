<script setup lang="ts">
import { inject, ref } from 'vue'
import { FILES_KEY, TREE_STOP } from '../../../editor/dataTree.ts'
import { useEditor } from '../../../editor/useEditor.ts'
import { FOCUS_RING, SELECTED_ITEM } from '../../../editorUi.ts'

/**
 * The Data tree's last row, All model files (S3): every `.bildr/` file as JSON, which is where the artifacts with no
 * collection or connection (pages, queries, actions…) are reached. Choosing it shows All model files in the workspace.
 * It is a tree item (`DataTree.vue`): the tab stop when it is the one the tree names.
 */
const editor = useEditor()
const stop = inject(TREE_STOP, ref(''))
</script>

<template>
  <div class="mt-3 px-2">
    <button
      type="button"
      class="flex h-9 w-full items-center gap-2.5 rounded-lg ps-3 pe-3 text-left text-[12px]"
      :class="[FOCUS_RING, editor.dataFiles ? SELECTED_ITEM : 'text-dimmed hover:bg-white/4 hover:text-toned']"
      title="Every model file as JSON: the pages, queries, actions and the rest"
      role="treeitem"
      aria-level="1"
      :aria-selected="editor.dataFiles"
      :tabindex="stop === FILES_KEY ? 0 : -1"
      :data-tree-item="FILES_KEY"
      data-raw-model
      @click="editor.dataFiles = true"
    >
      <UIcon
        name="i-lucide-file-json"
        class="size-4 shrink-0"
      />
      All model files
    </button>
  </div>
</template>
