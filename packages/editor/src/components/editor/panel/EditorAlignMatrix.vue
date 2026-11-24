<script setup lang="ts">
import { computed } from 'vue'
import type { AlignState, MatrixCell } from '../../../shared/alignMatrix.ts'
import { cellWrite, matrixCells } from '../../../shared/alignMatrix.ts'

/**
 * Figma's alignment pad (layout-containers L2): a 3×3 grid of cells over a
 * stack's justify and items (see `alignMatrix.ts`). A click places the
 * children in the cell, Alt+click stretches them across, a double-click
 * spreads them along the main axis. Active cells show a bar along the main
 * axis; the others a dot that turns into a preview bar on hover. Each cell
 * is a button named by its place, pressed where the children are.
 */
const props = defineProps<{ state: AlignState, mixed?: boolean }>()
const emit = defineEmits<{ write: [patch: Record<string, string>] }>()

const cells = computed(() => matrixCells(props.state))

function place(cell: MatrixCell, event: MouseEvent) {
  emit('write', cellWrite(props.state, cell, event.altKey ? 'stretch' : 'place'))
}
</script>

<template>
  <div
    class="grid h-[54px] w-[78px] shrink-0 grid-cols-3 grid-rows-3 rounded-lg bg-elevated p-0.5"
    role="group"
    aria-label="Alignment"
    data-align-matrix
    :data-main="state.main"
    :data-cross="state.cross"
    :data-mixed="mixed || undefined"
  >
    <button
      v-for="cell in cells"
      :key="`${cell.x},${cell.y}`"
      type="button"
      class="group grid place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="cell.label"
      :aria-pressed="!mixed && cell.active"
      :title="`${cell.label} (Alt: stretch, double-click: space between)`"
      :data-align-cell="`${cell.x},${cell.y}`"
      @click="place(cell, $event)"
      @dblclick="emit('write', cellWrite(state, cell, 'between'))"
    >
      <span
        v-if="!mixed && cell.active"
        class="block rounded-full bg-primary"
        :class="state.row ? 'h-2.5 w-1' : 'h-1 w-2.5'"
      />
      <span
        v-else
        class="block size-1 rounded-full bg-white/25 group-hover:bg-white/60"
      />
    </button>
  </div>
</template>
