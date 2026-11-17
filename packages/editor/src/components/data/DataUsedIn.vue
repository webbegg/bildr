<script setup lang="ts">
import { computed } from 'vue'
import { usesOfArtifact } from '../../shared/dataArtifacts.ts'
import type { ArtifactKind } from '../../shared/dataArtifacts.ts'
import { collectionUses, outsideOf, usedInWords } from '../../shared/dataUsage.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * A collection's, a query's or an action's Used in tab (S5, S10): the pages, components, layouts and actions that use it, from the
 * module's usage index (`usesOf`, `entityUsesOf`: the list a delete is refused with). Each place is one entry with how it uses it;
 * opening it shows it on the Canvas (a page, a component or a layout) or in the workspace (an action), as the collection's "Open
 * detail page" does. What a collection takes along when it is deleted (its own actions) is listed apart, and not counted.
 */
const { kind, id } = defineProps<{ kind: ArtifactKind | 'collection', id: string }>()
const editor = useEditor()
const all = computed(() => kind === 'collection' ? collectionUses(editor.model, id) : usesOfArtifact(editor.model, id, kind))
const uses = computed(() => outsideOf(all.value))
const follows = computed(() => all.value.filter(use => use.follows))
const EMPTY = {
  query: 'Not used yet. No page reads this query.',
  action: 'Not used yet. No page or form runs this action.',
  collection: 'Not used yet. No page or component reads this collection.'
} as const
</script>

<template>
  <div
    class="size-full overflow-y-auto"
    data-used-in
  >
    <div class="w-full max-w-2xl px-0.5 py-4">
      <p
        v-if="!uses.length"
        class="px-3.5 text-xs text-dimmed"
        data-used-in-empty
      >
        {{ EMPTY[kind] }}
      </p>
      <template v-else>
        <p class="flex h-11 items-center ps-3.5 pe-2 text-[12px] font-[550] text-highlighted">
          {{ usedInWords(uses.length) }}
        </p>
        <div
          class="px-2"
          data-used-in-outside
        >
          <DataUsageList :uses="uses" />
        </div>
      </template>
      <div
        v-if="follows.length"
        data-used-in-follows
      >
        <p class="flex h-11 items-center ps-3.5 pe-2 text-[12px] font-[550] text-highlighted">
          Goes with it
        </p>
        <div class="px-2">
          <DataUsageList :uses="follows" />
        </div>
      </div>
    </div>
  </div>
</template>
