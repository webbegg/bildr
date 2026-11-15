<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { themeSummary } from '../../shared/library.ts'
import type { ThemePreset } from '../../shared/library.ts'

/**
 * One library theme: its primary, secondary and neutral swatches, name and
 * font, and a check when the project's theme matches it. A click (or the
 * hover `…` menu's Apply) applies it. The hosted row also renamed, updated,
 * duplicated and deleted its theme; a bundled preset has none of those.
 */
const { entry, current = false } = defineProps<{ entry: ThemePreset, current?: boolean }>()
const emit = defineEmits<{ apply: [] }>()

const summary = computed(() => themeSummary(entry.theme))

const menu = computed<DropdownMenuItem[][]>(() => [
  [
    { label: 'Apply', icon: 'i-lucide-paintbrush', onSelect: () => emit('apply') }
  ]
])
</script>

<template>
  <div
    class="group relative flex items-center px-2"
    :data-theme-row="entry.id"
  >
    <div
      class="flex h-12 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg ps-2.5 pe-9 text-toned hover:bg-white/4"
      :title="`Apply ${entry.name}`"
      data-theme-apply
      @click="emit('apply')"
    >
      <span
        class="flex shrink-0 overflow-hidden rounded-md ring ring-white/10"
        data-theme-swatches
      >
        <span
          v-for="swatch in summary.swatches"
          :key="swatch.name"
          class="block h-6 w-3"
          :style="{ background: swatch.color }"
          :title="swatch.name"
        />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-1">
          <span
            class="truncate text-[12px] font-medium text-highlighted"
            data-theme-name
          >{{ entry.name }}</span>
          <UIcon
            v-if="current"
            name="i-lucide-check"
            class="size-3.5 shrink-0 text-(--editor-selection)"
            aria-label="Matches the project theme"
            data-theme-current
          />
        </span>
        <span class="block truncate text-[11px] text-dimmed">{{ summary.font }}</span>
      </span>
    </div>
    <EditorMenu :items="menu">
      <EditorButton
        icon="i-lucide-ellipsis"
        variant="ghost"
        size="xs"
        aria-label="Theme actions"
        class="absolute end-3.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
      />
    </EditorMenu>
  </div>
</template>
