<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { themeSummary } from '#shared/design/library'
import type { LibraryTheme } from '#shared/design/library'

/**
 * One library theme: its primary, secondary and neutral swatches, name and
 * font, and a check when the project's theme matches it. Double-click
 * renames inline; the hover `…` menu applies, updates from the project,
 * renames, duplicates or deletes it.
 */
const { entry, current = false } = defineProps<{ entry: LibraryTheme, current?: boolean }>()
const emit = defineEmits<{ apply: [], update: [], rename: [name: string], duplicate: [], delete: [] }>()

const summary = computed(() => themeSummary(entry.theme))
const renaming = ref(false)
const renameValue = ref('')

function startRename() {
  renameValue.value = entry.name
  renaming.value = true
}

function commitRename() {
  if (!renaming.value) return
  renaming.value = false
  const name = renameValue.value.trim()
  if (name && name !== entry.name) emit('rename', name)
}

// Rename mounts the field focused; the closing menu must not take the focus back (its blur would commit).
function keepRenameFocus(event: Event) {
  if (renaming.value) event.preventDefault()
}

const menu = computed<DropdownMenuItem[][]>(() => [
  [
    { label: 'Apply', icon: 'i-lucide-paintbrush', onSelect: () => emit('apply') },
    { label: 'Update from project', icon: 'i-lucide-refresh-cw', onSelect: () => emit('update') }
  ],
  [
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: startRename },
    { label: 'Duplicate', icon: 'i-lucide-copy', onSelect: () => emit('duplicate') },
    { label: 'Delete…', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('delete') }
  ]
])
</script>

<template>
  <div
    class="group relative flex items-center px-2"
    :data-theme-row="entry.id"
  >
    <EditorInput
      v-if="renaming"
      v-model="renameValue"
      autofocus
      :maxlength="64"
      class="flex-1"
      aria-label="Rename theme"
      @keydown.enter="commitRename"
      @keydown.esc="renaming = false"
      @blur="commitRename"
    />
    <div
      v-else
      class="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-lg ps-2.5 pe-9 text-toned hover:bg-white/4"
      :title="entry.name"
      @dblclick="startRename"
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
            class="truncate text-[13px] font-medium text-highlighted"
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
    <EditorMenu
      v-if="!renaming"
      :items="menu"
      :on-close-auto-focus="keepRenameFocus"
    >
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
