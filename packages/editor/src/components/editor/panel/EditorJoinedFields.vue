<script setup lang="ts">
import type { StyleToken } from '@bildr/codegen/design'

/**
 * Framer's joined side fields: one soft box split into cells (T R B L, or the
 * corners), each a scale field you type in or drag, with a tiny grey letter
 * below. An overridden cell's value is bright; the row label carries the blue.
 */
interface JoinedCell {
  key: string
  letter: string
  token: StyleToken
  value: string | undefined
  inherited?: string
  placeholder?: string
}

defineProps<{ cells: JoinedCell[] }>()
const emit = defineEmits<{ preview: [key: string, value: string | null], commit: [key: string, value: string] }>()
</script>

<template>
  <div>
    <div
      class="grid divide-x divide-default overflow-hidden rounded-lg bg-elevated"
      :style="{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }"
    >
      <EditorScaleField
        v-for="cell in cells"
        :key="cell.key"
        bare
        :token="cell.token"
        :value="cell.value"
        :inherited="cell.inherited"
        :placeholder="cell.placeholder"
        :data-style-row="cell.key"
        @preview="emit('preview', cell.key, $event)"
        @commit="emit('commit', cell.key, $event)"
      />
    </div>
    <div
      class="mt-1 grid text-center text-[10px] leading-3 text-dimmed"
      :style="{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }"
      aria-hidden="true"
    >
      <span
        v-for="cell in cells"
        :key="cell.key"
      >{{ cell.letter }}</span>
    </div>
  </div>
</template>
