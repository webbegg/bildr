<script setup lang="ts">
import type { DocNode } from '#shared/document/schema'
import type { OverrideEntry } from '~/composables/componentVariants'
import { overrideEntries, resetOverrides } from '~/composables/componentVariants'

/**
 * In the component view with a variant shown: what that variant overrides
 * on the selected node, props and design tokens, each in the override blue
 * with Reset override (Alt-click resets), and "−" to reset them all. A reset
 * removes the override, so the node shows the primary's value again and the
 * variant stores only what differs.
 */
const { node } = defineProps<{ node: DocNode }>()
const editor = useEditor()

const entries = computed(() => overrideEntries(editor.variant, node.id))

function reset(list: OverrideEntry[]) {
  if (list.length) editor.setOverride(node.id, resetOverrides(list))
}
</script>

<template>
  <EditorStyleSection
    v-if="editor.variant"
    :label="`${editor.variant.name} overrides`"
    :remove-label="entries.length ? 'Reset all overrides' : undefined"
    data-variant-overrides
    @remove="reset(entries)"
  >
    <EditorRow
      v-for="entry in entries"
      :key="`${entry.kind}:${entry.key}`"
      :label="entry.key"
      :title="entry.removed ? `${entry.key} is removed in ${editor.variant.name}` : `${entry.key} differs from the primary in ${editor.variant.name}`"
      :provenance="{ state: 'set', key: entry.key, value: entry.removed ? 'removed' : String(entry.value) }"
      :data-override="`${entry.kind}:${entry.key}`"
      :data-override-removed="entry.removed ? '' : undefined"
      @reset="reset([entry])"
    >
      <p
        class="flex h-[30px] items-center truncate text-[12px]"
        :class="entry.removed ? 'text-dimmed italic' : 'text-toned'"
      >
        {{ entry.removed ? 'Removed' : String(entry.value) }}
      </p>
    </EditorRow>
    <p
      v-if="!entries.length"
      class="text-[11px] text-dimmed"
    >
      Same as the primary. Edits to this element override {{ editor.variant.name }} only.
    </p>
  </EditorStyleSection>
</template>
