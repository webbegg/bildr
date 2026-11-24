<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import { nodeIcon } from '../../design/icons.ts'
import { MODAL_UI, mergeUi } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { siblingParent } from '../../editor/selection.ts'
import type { Command, CommandContext } from '../../shared/commands.ts'
import { editorCommands, GROUP_LABELS, pushRecent, searchCommands } from '../../shared/commands.ts'
import { componentCommands } from '../../shared/componentEditor.ts'
import { layoutCommands } from '../../shared/layoutEditor.ts'
import { insertId } from '../../shared/presets.ts'

/**
 * The `⌘K` quick actions, Framer's Quick Insert: type a component's name and
 * press Enter to insert it at the selection, or run an edit action, go to a
 * page, view or Styles, or open the shortcuts sheet. Our ranking
 * (`searchCommands`) orders the results, not the palette's Fuse, so a label
 * prefix always beats a looser match. Disabled commands stay listed, greyed.
 * Running one closes the palette and remembers it for the empty-query list.
 * An empty query caps Insert at the common or recently inserted components,
 * so the Actions stay in view; "More components…" lists the rest. The
 * project's own components join Insert and Go to (`componentCommands`), and
 * its layouts Actions and Go to (`layoutCommands`). The hosted "detail page"
 * commands wait for the module's detail pages (`setPageCollection`).
 */
const editor = useEditor()
const query = ref('')
const expandInsert = ref(false)
const shortcutsOpen = ref(false)

// The kit's dark dialog around a palette laid out like MENU_UI: 13 px rows, white/8 highlight, dim group labels.
const MODAL = mergeUi(MODAL_UI, { content: 'sm:max-w-[560px]' })
const PALETTE_UI = {
  root: 'divide-white/8',
  input: '[&>input]:h-11 [&>input]:text-[12px]',
  viewport: 'divide-white/8',
  group: 'p-1',
  label: 'px-2.5 pt-2 pb-1 text-[11px] font-medium text-dimmed',
  item: 'gap-2 px-2.5 py-1.5 text-[12px] before:rounded-lg data-highlighted:not-data-disabled:before:bg-white/8',
  itemLeadingIcon: 'size-4',
  itemLabelSuffix: 'text-[12px]',
  empty: 'py-6 text-[12px] text-dimmed'
}

const RECENT_KEY = 'bildr:recent-commands'
const recent = ref<string[]>(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'))

/** What the palette inserts: the store's catalog (the hosted editor read its component registry). */
const HIDDEN = ['Page', 'Instance', 'SlotFill']
const insertTypes = computed(() => (editor.catalog?.nodeTypes ?? []).filter(entry => entry.insertable !== false && !HIDDEN.includes(entry.type)).map(entry => ({ type: insertId(entry), label: entry.label, icon: nodeIcon(insertId(entry)) })))

const ctx = computed<CommandContext>(() => ({
  editor,
  insertTypes: insertTypes.value,
  openShortcuts: () => {
    shortcutsOpen.value = true
  }
}))

// Create component takes siblings on a page, as component_create does.
const canCreate = computed(() => {
  const root = editor.page?.root
  const ids = editor.selectedIds.filter(id => id !== root?.id)
  return !editor.componentId && !editor.layoutId && !!root && ids.length > 0 && !!siblingParent(root, ids)
})

const commands = computed(() => [
  ...editorCommands(ctx.value),
  ...(editor.model
    ? componentCommands(editor.model, { editingId: editor.componentId, canCreate: canCreate.value }, {
        insert: id => editor.insertInstance(id),
        edit: id => editor.editComponent(id),
        create: () => editor.createComponent(),
        previewInteractions: id => editor.previewInteractions(id)
      })
    : []),
  ...(editor.model
    ? layoutCommands(editor.model, { editingId: editor.layoutId, pageLayoutId: editor.currentPage?.layout, fromSelection: 'nodeIds' in editor.layoutFromSelection }, {
        create: () => editor.createLayout(),
        createFromSelection: () => editor.createLayoutFromSelection(),
        edit: id => editor.editLayout(id),
        setPageLayout: id => editor.setPageLayout(id)
      })
    : [])
])

const groups = computed<CommandPaletteGroup[]>(() => searchCommands(commands.value, query.value, recent.value, { expandInsert: expandInsert.value }).map(section => ({
  id: section.group,
  label: GROUP_LABELS[section.group],
  ignoreFilter: true,
  items: [
    ...section.commands.map((command): CommandPaletteItem => ({
      label: command.label,
      suffix: command.hint,
      icon: command.icon,
      kbds: command.shortcut,
      disabled: !command.enabled(ctx.value),
      onSelect: () => run(command)
    })),
    ...(section.more
      ? [{
          label: 'More components…',
          suffix: `${section.more} more`,
          icon: 'i-lucide-ellipsis',
          onSelect: (event: Event) => {
            event.preventDefault()
            expandInsert.value = true
          }
        }]
      : [])
  ]
})))

function run(command: Command<CommandContext>) {
  if (!command.enabled(ctx.value)) return
  editor.quickOpen = false
  recent.value = pushRecent(recent.value, command.id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
  command.run(ctx.value)
}

// Each opening starts from the recent commands.
watch(() => editor.quickOpen, (open) => {
  if (!open) return
  query.value = ''
  expandInsert.value = false
})
</script>

<template>
  <UModal
    v-model:open="editor.quickOpen"
    title="Quick actions"
    description="Insert a component or run an editor action"
    :ui="MODAL"
  >
    <template #content>
      <UCommandPalette
        v-model:search-term="query"
        :groups="groups"
        :fuse="{ resultLimit: 100 }"
        preserve-group-order
        size="sm"
        :ui="PALETTE_UI"
        placeholder="Insert a component or run an action…"
        class="h-[min(28rem,70vh)]"
        data-quick-actions
      />
    </template>
  </UModal>
  <EditorShortcutsSheet v-model:open="shortcutsOpen" />
</template>
