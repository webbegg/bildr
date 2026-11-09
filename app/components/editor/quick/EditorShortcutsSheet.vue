<script setup lang="ts">
import { SHORTCUTS } from '#shared/editor/commands'

/** The keyboard shortcuts sheet (quick actions › Keyboard shortcuts), listing `SHORTCUTS`. */
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal
    v-model:open="open"
    title="Keyboard shortcuts"
    :ui="{ content: 'max-w-[560px]' }"
  >
    <template #body>
      <ul
        class="divide-y divide-default text-sm"
        data-shortcuts-sheet
      >
        <li
          v-for="shortcut in SHORTCUTS"
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
    </template>
  </UModal>
</template>
