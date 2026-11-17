<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { MIGRATIONS_KEY, TREE_STOP } from '../../../editor/dataTree.ts'
import { useEditor } from '../../../editor/useEditor.ts'
import { FOCUS_RING, SELECTED_ITEM } from '../../../editorUi.ts'

/**
 * The Data tree's Migrations entry (S6): listed only while a migration plan is pending and the project has a database (`editor.dataPlan`
 * is null otherwise), with the number of collections the plan changes. What it changes that no collection owns is not in that number:
 * the Migrations view says it in words. Choosing it shows the plan in the workspace (`?item=migrations`). It is a tree item
 * (`DataTree.vue`): the tab stop when it is the one the tree names.
 */
const editor = useEditor()
const stop = inject(TREE_STOP, ref(''))
const count = computed(() => Object.keys(editor.dataPlan?.collections ?? {}).length)
</script>

<template>
  <div
    v-if="editor.dataPlan"
    class="mt-3 px-2"
  >
    <button
      type="button"
      class="flex h-9 w-full items-center gap-2.5 rounded-lg ps-3 pe-3 text-left text-[12px]"
      :class="[FOCUS_RING, editor.dataSpecial === 'migrations' ? SELECTED_ITEM : 'text-toned hover:bg-white/4']"
      title="Changes to the database wait to be applied"
      role="treeitem"
      aria-level="1"
      :aria-selected="editor.dataSpecial === 'migrations'"
      :tabindex="stop === MIGRATIONS_KEY ? 0 : -1"
      :data-tree-item="MIGRATIONS_KEY"
      @click="editor.dataMigrations = true"
    >
      <UIcon
        name="i-lucide-database-zap"
        class="size-4 shrink-0 text-warning"
      />
      <span class="min-w-0 flex-1 truncate">Migrations</span>
      <span
        v-if="count"
        class="shrink-0 rounded-full bg-warning/15 px-1.5 text-[11px] font-[550] text-warning"
        :title="`Changes to ${count} ${count === 1 ? 'collection' : 'collections'}`"
        data-migrations-count
      >{{ count }}</span>
    </button>
  </div>
</template>
