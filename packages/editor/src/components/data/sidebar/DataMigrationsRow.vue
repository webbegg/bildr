<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { MIGRATIONS_KEY, TREE_STOP } from '../../../editor/dataTree.ts'
import { migrationTargets } from '../../../editor/migrationTargets.ts'
import { useEditor } from '../../../editor/useEditor.ts'
import { FOCUS_RING, SELECTED_ITEM } from '../../../editorUi.ts'
import { useStatus } from '../../../status.ts'

/**
 * The Data tree's Migrations entry (S6): listed only while a migration plan is pending and the project has a database, with the number
 * of changes the plan makes (each collection once, and each statement no collection owns). Choosing it shows the plan in the workspace
 * (`?item=migrations`). It is a tree item (`DataTree.vue`): the tab stop when it is the one the tree names.
 */
const editor = useEditor()
const status = useStatus()
const stop = inject(TREE_STOP, ref(''))
const count = computed(() => status.plan.value ? migrationTargets(editor.model, status.plan.value).count : 0)
</script>

<template>
  <div
    v-if="status.plan.value"
    class="mt-3 px-2"
  >
    <button
      type="button"
      class="flex h-9 w-full items-center gap-2.5 rounded-lg ps-3 pe-3 text-left text-[12px]"
      :class="[FOCUS_RING, editor.dataMigrations ? SELECTED_ITEM : 'text-toned hover:bg-white/4']"
      title="A change to the database waits for confirmation"
      role="treeitem"
      aria-level="1"
      :aria-selected="editor.dataMigrations"
      :tabindex="stop === MIGRATIONS_KEY ? 0 : -1"
      :data-tree-item="MIGRATIONS_KEY"
      data-migrations-entry
      @click="editor.dataMigrations = true"
    >
      <UIcon
        name="i-lucide-database-zap"
        class="size-4 shrink-0 text-warning"
      />
      <span class="min-w-0 flex-1 truncate">Migrations</span>
      <span
        class="shrink-0 rounded-full bg-warning/15 px-1.5 text-[11px] font-[550] text-warning"
        :title="`${count} pending ${count === 1 ? 'change' : 'changes'}`"
        data-migrations-count
      >{{ count }}</span>
    </button>
  </div>
</template>
