<script setup lang="ts">
import { getStyleToken } from '#shared/design/tokens'
import { colorSwapPlan, selectionColors } from '#shared/editor/selectionColors'

/**
 * Framer's "Selection colours": every colour the selected subtrees use (a
 * token, a theme colour or a hex, on bg, text and border colour keys), with
 * a swatch and how many times it is used. Picking another colour for one
 * swaps it everywhere in the subtrees (see `colorSwapPlan`) as one
 * `node_update_style` with per-node `updates`: one undo step, all or nothing
 * (`updateStyles`). In the variant view the edit goes to the variant's
 * overrides, one node at a time.
 */
const editor = useEditor()

const colors = computed(() => selectionColors(editor.selectedNodes))
const customNames = computed(() => Object.keys(editor.theme?.custom ?? {}))

async function swap(from: string, to: string) {
  await editor.updateStyles(colorSwapPlan(editor.selectedNodes, from, to, customNames.value))
}
</script>

<template>
  <EditorStyleSection
    v-if="colors.length && editor.theme"
    label="Selection colours"
    data-selection-colors
  >
    <EditorRow
      v-for="(color, i) in colors"
      :key="color.value"
      :label="i === 0 ? 'Colours' : ''"
      :title="`${color.value}: used ${color.count} time${color.count === 1 ? '' : 's'} (${color.keys.join(', ')})`"
      :data-selection-color="color.value"
    >
      <EditorSwatchPicker
        class="min-w-0 flex-1"
        :token="getStyleToken(color.keys[0]!)!"
        :value="color.value"
        :theme="editor.theme"
        :clearable="false"
        @update="swap(color.value, $event)"
      />
      <span
        class="w-6 shrink-0 text-end text-[11px] text-dimmed tabular-nums"
        :aria-label="`Used ${color.count} times`"
        data-selection-color-count
      >{{ color.count }}</span>
    </EditorRow>
  </EditorStyleSection>
</template>
