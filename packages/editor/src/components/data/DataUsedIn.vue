<script setup lang="ts">
import { computed } from 'vue'
import { openUse, useKey, useKindLabel, usesOfArtifact } from '../../editor/dataArtifacts.ts'
import type { ArtifactKind } from '../../editor/dataArtifacts.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * A query's or an action's Used in tab (S10): the pages, components, layouts and actions that use it, from the module's usage
 * index (`usesOf`, the list a delete is refused with). Each place is one entry with how it uses it; opening it shows it on the
 * Canvas (a page, a component or a layout) or in the workspace (an action), as the collection's "Open detail page" does.
 */
const { kind, id } = defineProps<{ kind: ArtifactKind, id: string }>()
const editor = useEditor()
const uses = computed(() => usesOfArtifact(editor.model, id, kind))
const ICONS = { page: 'i-lucide-file-text', component: 'i-lucide-component', layout: 'i-lucide-layout-template', action: 'i-lucide-zap' } as const
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
        {{ kind === 'query' ? 'Not used yet. No page reads this query.' : 'Not used yet. No page or form runs this action.' }}
      </p>
      <template v-else>
        <p class="flex h-11 items-center ps-3.5 pe-2 text-[12px] font-[550] text-highlighted">
          Used in {{ uses.length }} {{ uses.length === 1 ? 'place' : 'places' }}
        </p>
        <div class="px-2">
          <div
            v-for="use in uses"
            :key="useKey(use)"
            class="flex items-start gap-2.5 rounded-lg ps-3 pe-2 py-2 text-[12px] hover:bg-white/4"
            :data-use="useKey(use)"
          >
            <UIcon
              :name="ICONS[use.kind]"
              class="mt-0.5 size-4 shrink-0 text-dimmed"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-toned">
                {{ use.name }} <span class="ms-1 text-[11px] text-dimmed">{{ useKindLabel(use.kind) }}</span>
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
            <UTooltip :text="use.kind === 'action' ? `Show ${use.name}` : `Open ${use.name} on the Canvas`">
              <EditorButton
                icon="i-lucide-arrow-up-right"
                variant="ghost"
                size="xs"
                :aria-label="use.kind === 'action' ? `Show ${use.name}` : `Open ${use.name} on the Canvas`"
                :data-use-open="useKey(use)"
                @click="openUse(editor, use)"
              />
            </UTooltip>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
