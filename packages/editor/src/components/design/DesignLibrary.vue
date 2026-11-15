<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { DEFAULT_THEME } from '@bildr/codegen/design'
import { callAction, errorMessage } from '../../api.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { matchesPreset } from '../../shared/library.ts'
import type { ThemePreset } from '../../shared/library.ts'

/**
 * The Design view's left sidebar: the theme library. The module has no
 * per-user library (the hosted one saved, updated, duplicated and deleted a
 * user's own themes, outside the project): its themes are the bundled
 * presets (`theme_presets_list`), each applied to the project (`theme_apply`,
 * one undo step; the project's custom colours stay). Nothing is stored
 * outside `.bildr/`.
 */
const editor = useEditor()
const toast = useToast()

const themes = ref<ThemePreset[]>([])
const loaded = ref(false)

const projectTheme = computed(() => editor.model?.theme ?? DEFAULT_THEME)
const isCurrent = (entry: ThemePreset) => matchesPreset(projectTheme.value, entry)

function fail(error: unknown) {
  toast.add({ title: 'Theme library', description: errorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
}

onMounted(async () => {
  try {
    themes.value = (await callAction<{ presets: ThemePreset[] }>('theme_presets_list')).presets
  } catch (error) {
    fail(error)
  } finally {
    loaded.value = true
  }
})

async function apply(entry: ThemePreset) {
  if (await editor.run('theme_apply', { preset: entry.id })) {
    toast.add({ title: `Applied ${entry.name}`, description: 'Undo restores the previous theme.', color: 'success', icon: 'i-lucide-paintbrush' })
  }
}
</script>

<template>
  <div
    class="flex flex-col"
    data-theme-library
  >
    <div class="flex h-11 shrink-0 items-center justify-between ps-4 pe-2.5">
      <p class="text-[12px] font-[550] text-highlighted">
        Themes
      </p>
      <span class="text-[11px] text-dimmed tabular-nums">{{ themes.length || '' }}</span>
    </div>
    <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-3">
      <p
        v-if="loaded && !themes.length"
        class="px-4 py-2 text-[12px] text-dimmed"
      >
        No themes to apply.
      </p>
      <DesignThemeRow
        v-for="entry in themes"
        :key="entry.id"
        :entry="entry"
        :current="isCurrent(entry)"
        @apply="apply(entry)"
      />
    </div>
  </div>
</template>
