<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import type { Command, CommandContext } from '#shared/editor/commands'
import { editorCommands, GROUP_LABELS, pushRecent, searchCommands } from '#shared/editor/commands'

/**
 * The `⌘K` quick actions, Framer's Quick Insert: type a component's name and
 * press Enter to insert it at the selection, or run an edit action, go to a
 * page, view, Styles or collection, or open the shortcuts sheet. Our ranking
 * (`searchCommands`) orders the results, not the palette's Fuse, so a label
 * prefix always beats a looser match. Disabled commands stay listed, greyed.
 * Running one closes the palette and remembers it for the empty-query list.
 */
const editor = useEditor()
const query = ref('')
const shortcutsOpen = ref(false)

const RECENT_KEY = 'bildr:recent-commands'
const recent = ref<string[]>(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'))

const ctx: CommandContext = {
  editor,
  openShortcuts: () => {
    shortcutsOpen.value = true
  }
}

const commands = computed(() => editorCommands(ctx))

const groups = computed<CommandPaletteGroup[]>(() => searchCommands(commands.value, query.value, recent.value).map(section => ({
  id: section.group,
  label: GROUP_LABELS[section.group],
  ignoreFilter: true,
  items: section.commands.map((command): CommandPaletteItem => ({
    label: command.label,
    suffix: command.hint,
    icon: command.icon,
    kbds: command.shortcut,
    disabled: !command.enabled(ctx),
    onSelect: () => run(command)
  }))
})))

function run(command: Command<CommandContext>) {
  if (!command.enabled(ctx)) return
  editor.quickOpen = false
  recent.value = pushRecent(recent.value, command.id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
  command.run(ctx)
}

// Each opening starts from the recent commands.
watch(() => editor.quickOpen, (open) => {
  if (open) query.value = ''
})
</script>

<template>
  <UModal
    v-model:open="editor.quickOpen"
    title="Quick actions"
    description="Insert a component or run an editor action"
    :ui="{ content: 'max-w-[560px]' }"
  >
    <template #content>
      <UCommandPalette
        v-model:search-term="query"
        :groups="groups"
        :fuse="{ resultLimit: 100 }"
        preserve-group-order
        placeholder="Insert a component or run an action…"
        class="h-[min(28rem,70vh)]"
        data-quick-actions
      />
    </template>
  </UModal>
  <EditorShortcutsSheet v-model:open="shortcutsOpen" />
</template>
