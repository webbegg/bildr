<script setup lang="ts">
import { computed } from 'vue'
import { UPDATED_AUTOMATICALLY, usesOfArtifact } from '../../shared/dataArtifacts.ts'
import type { ArtifactKind } from '../../shared/dataArtifacts.ts'
import { blockingUses, collectionUses, usedInWords } from '../../shared/dataUsage.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * A collection's, a query's, an action's or a state's Used in tab: the pages, components, layouts and actions that use it, from the
 * module's usage index (`usesOf`, `entityUsesOf`: the list a delete is refused with). Each place is one entry with how it uses it;
 * opening it shows it on the Canvas (a page, a component or a layout) or in the workspace (an action), as the collection's "Open
 * detail page" does. What the module changes along with a collection (its own actions) is listed apart as "Updated automatically",
 * and not counted.
 *
 * The `data-used-in-outside` and `data-used-in-follows` hooks name the two lists as the e2e and the tests know them: the places
 * that count (the ones outside the collection's own) and the automatic ones.
 */
const { kind, id } = defineProps<{ kind: ArtifactKind | 'collection', id: string }>()
const editor = useEditor()
const all = computed(() => kind === 'collection' ? collectionUses(editor.model, id) : usesOfArtifact(editor.model, id, kind))
const uses = computed(() => blockingUses(all.value))
const follows = computed(() => all.value.filter(use => use.follows))
const EMPTY = {
  query: 'Not used yet. No page reads this query.',
  action: 'Not used yet. No page or form runs this action.',
  state: 'Not used yet. No page reads or sets this state.',
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
          {{ UPDATED_AUTOMATICALLY }}
        </p>
        <p class="px-3.5 pb-1 text-[11px] text-dimmed">
          Not counted above: changing {{ kind === 'collection' ? 'the collection' : 'it' }} changes these for you.
        </p>
        <div class="px-2">
          <DataUsageList
            :uses="follows"
            :tag-follows="false"
          />
        </div>
      </div>
    </div>
  </div>
</template>
