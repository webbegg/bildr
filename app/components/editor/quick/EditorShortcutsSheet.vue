<script setup lang="ts">
import { shortcutsFor } from '#shared/editor/commands'

/**
 * The keyboard shortcuts sheet (quick actions › Keyboard shortcuts), listing
 * `shortcutsFor` the visible frames, so the ⌥ + digit rows match the frames.
 */
const open = defineModel<boolean>('open', { default: false })
const editor = useEditor()
const shortcuts = computed(() => shortcutsFor(editor.frames, editor.breakpointBase))
</script>

<template>
  <EditorModal
    v-model:open="open"
    title="Keyboard shortcuts"
    :ui="{ content: 'sm:max-w-[560px]' }"
  >
    <ul
      class="divide-y divide-white/8 text-[12px]"
      data-shortcuts-sheet
    >
      <li
        v-for="shortcut in shortcuts"
        :key="shortcut.id"
        class="flex items-center justify-between gap-4 py-1.5"
      >
        <span class="text-toned">{{ shortcut.label }}</span>
        <span class="flex shrink-0 items-center gap-1.5 text-xs text-dimmed">
          <template
            v-for="(keys, i) in shortcut.keys"
            :key="i"
          >
            <span v-if="i">or</span>
            <span class="flex gap-0.5">
              <UKbd
                v-for="key in keys"
                :key="key"
                :value="key"
              />
            </span>
          </template>
        </span>
      </li>
    </ul>
  </EditorModal>
</template>
