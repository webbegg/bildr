<script setup lang="ts">
import { computed } from 'vue'
import { ARTIFACT_KINDS } from '../../../shared/dataArtifacts.ts'
import type { ArtifactKind } from '../../../shared/dataArtifacts.ts'
import { FILTER_FROM, filterArtifacts } from '../../../editor/dataTree.ts'
import type { DataArtifact } from '../../../shared/dataModel.ts'

/**
 * The Data tree's Queries, Actions or State section (S10, B2): a header that folds the section (`folded` is the tree's, which remembers it;
 * the header emits `toggle`) with a `+` that asks for the create dialog (`create`), a filter box when the section has more than
 * `FILTER_FROM` items (its text is the tree's: the keys that move along the tree list only what it lets through), and a row for
 * each item. What a row asks for (`rename`, `delete`) the tree answers with its dialogs. A folded section shows only its header.
 */
const { kind, items, folded } = defineProps<{ kind: ArtifactKind, items: DataArtifact[], folded: boolean }>()
const filter = defineModel<string>('filter', { required: true })
defineEmits<{ create: [], toggle: [], rename: [id: string], delete: [id: string] }>()

const words = computed(() => ARTIFACT_KINDS[kind])
const lower = computed(() => words.value.plural.toLowerCase())
const shown = computed(() => filterArtifacts(items, filter.value))
const EMPTY: Record<ArtifactKind, string> = {
  query: 'No queries yet. Queries read a collection for your pages.',
  action: 'No actions yet. Actions change a collection when a form or a button runs them.',
  state: 'No state yet. Values the app remembers while it runs, like a filter or a toggle.'
}
</script>

<template>
  <section
    class="mt-2"
    :data-artifacts="kind"
  >
    <div class="flex items-center pe-3 pt-1 pb-0.5 ps-2">
      <button
        type="button"
        class="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-lg ps-1.5 text-left text-xs font-medium text-dimmed hover:text-toned"
        :aria-expanded="!folded"
        :data-artifact-toggle="kind"
        @click="$emit('toggle')"
      >
        <UIcon
          :name="folded ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
          class="size-3.5 shrink-0"
        />
        {{ words.plural }}
      </button>
      <EditorButton
        icon="i-lucide-plus"
        variant="ghost"
        size="xs"
        :aria-label="`New ${words.label.toLowerCase()}`"
        :data-artifact-add="kind"
        @click="$emit('create')"
      />
    </div>
    <template v-if="!folded">
      <div
        v-if="items.length > FILTER_FROM"
        class="px-2 pb-1"
      >
        <EditorInput
          v-model="filter"
          :placeholder="`Filter ${lower}`"
          icon="i-lucide-search"
          :aria-label="`Filter ${lower}`"
          :data-artifact-filter="kind"
          @keydown.esc="filter = ''"
        />
      </div>
      <p
        v-if="!items.length"
        class="ps-3.5 pe-3 py-1.5 text-xs text-dimmed"
        :data-artifacts-empty="kind"
      >
        {{ EMPTY[kind] }}
      </p>
      <p
        v-else-if="!shown.length"
        class="ps-3.5 pe-3 py-1.5 text-xs text-dimmed"
        :data-artifacts-empty="kind"
      >
        No {{ lower }} match “{{ filter.trim() }}”.
      </p>
      <DataArtifactRow
        v-for="item in shown"
        :key="item.id"
        :kind="kind"
        :item="item"
        @rename="$emit('rename', item.id)"
        @delete="$emit('delete', item.id)"
      />
    </template>
  </section>
</template>
