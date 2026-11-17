<script setup lang="ts">
import { computed } from 'vue'
import { FOCUS_RING } from '../../editorUi.ts'
import type { UseEntry } from '../../shared/dataArtifacts.ts'
import { blockingUses, usedInWords } from '../../shared/dataUsage.ts'
import DataUsageList from './DataUsageList.vue'

/**
 * What a field of the Fields tab shows of where it is used, in the two places a row has for it: the `badge` at the end of the row
 * (how many places use it, which opens the list) and, under the row, the `list` of the places, each a link that opens it. The
 * places the module updates itself are listed, tagged, but not counted. One component for both, so the editable rows and the
 * read-only ones of a connection collection show the same thing.
 */
const { part, name, uses, open = false } = defineProps<{ part: 'badge' | 'list', name: string, uses: UseEntry[], open?: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const count = computed(() => blockingUses(uses).length)
</script>

<template>
  <button
    v-if="part === 'badge' && count"
    type="button"
    class="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-white/8 px-1.5 text-[11px] text-muted tabular-nums hover:text-highlighted"
    :class="FOCUS_RING"
    :aria-label="`${usedInWords(count)}: show them`"
    :aria-expanded="open"
    :title="usedInWords(count)"
    data-field-uses
    @click="emit('toggle')"
  >
    {{ count }}
  </button>
  <div
    v-else-if="part === 'list' && open"
    class="mb-1 ms-6 rounded-lg bg-white/4 py-1"
    :data-field-uses-list="name"
  >
    <DataUsageList :uses="uses" />
  </div>
</template>
