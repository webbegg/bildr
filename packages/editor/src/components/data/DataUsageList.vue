<script setup lang="ts">
import { openUse } from '../../editor/dataArtifactActions.ts'
import { usageKey, usageKindLabel } from '../../shared/dataArtifacts.ts'
import type { UseEntry } from '../../shared/dataArtifacts.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * The places that use a collection, a field, a query or an action (S5, S10): one row for each, with its name, its kind and how it
 * uses it, and a button that opens it: a page, a component or a layout on the Canvas, an action or a query in the workspace
 * (`openUse`). The Used in tabs, a field's list and the warning before a delete or a rename all show it. A place the module changes
 * along with what is deleted or renamed (`follows`) says so with `followsLabel`, when it is given. `open` tells the parent a place
 * was opened (a dialog closes).
 */
const { uses, followsLabel = '' } = defineProps<{ uses: UseEntry[], followsLabel?: string }>()
const emit = defineEmits<{ open: [use: UseEntry] }>()
const editor = useEditor()
const ICONS = { page: 'i-lucide-file-text', component: 'i-lucide-component', layout: 'i-lucide-layout-template', action: 'i-lucide-zap', query: 'i-lucide-list-filter' } as const
const label = (use: UseEntry) => use.kind === 'action' || use.kind === 'query' ? `Show ${use.name}` : `Open ${use.name} on the Canvas`

function go(use: UseEntry) {
  emit('open', use)
  openUse(editor, use)
}
</script>

<template>
  <div
    v-for="use in uses"
    :key="usageKey(use)"
    class="flex items-start gap-2.5 rounded-lg ps-3 pe-2 py-2 text-[12px] hover:bg-white/4"
    :data-use="usageKey(use)"
  >
    <UIcon
      :name="ICONS[use.kind]"
      class="mt-0.5 size-4 shrink-0 text-dimmed"
    />
    <div class="min-w-0 flex-1">
      <p class="truncate text-toned">
        {{ use.name }} <span class="ms-1 text-[11px] text-dimmed">{{ usageKindLabel(use.kind) }}</span>
        <span
          v-if="use.follows && followsLabel"
          class="ms-1 text-[11px] text-dimmed"
          data-use-follows
        >· {{ followsLabel }}</span>
      </p>
      <p
        v-for="what in use.what"
        :key="what"
        class="truncate text-[11px] text-dimmed"
        data-use-what
      >
        {{ what }}
      </p>
    </div>
    <UTooltip :text="label(use)">
      <EditorButton
        icon="i-lucide-arrow-up-right"
        variant="ghost"
        size="xs"
        :aria-label="label(use)"
        :data-use-open="usageKey(use)"
        @click="go(use)"
      />
    </UTooltip>
  </div>
</template>
