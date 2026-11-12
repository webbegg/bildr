<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import type { Command, CommandContext } from '#shared/editor/commands'
import { editorCommands, GROUP_LABELS, pushRecent, searchCommands } from '#shared/editor/commands'
import { siblingParent } from '#shared/editor/selection'
import { detailCommands } from '#shared/editor/detailPages'
import { componentCommands } from '~/composables/componentEditor'
import { layoutCommands } from '~/composables/layoutEditor'

/**
 * The `⌘K` quick actions, Framer's Quick Insert: type a component's name and
 * press Enter to insert it at the selection, or run an edit action, go to a
 * page, view, Styles or collection, or open the shortcuts sheet. Our ranking
 * (`searchCommands`) orders the results, not the palette's Fuse, so a label
 * prefix always beats a looser match. Disabled commands stay listed, greyed.
 * Running one closes the palette and remembers it for the empty-query list.
 * An empty query caps Insert at the common or recently inserted components,
 * so the Actions stay in view; "More components…" lists the rest. The
 * project's own components join Insert and Go to (`componentCommands`), and
 * its layouts Actions and Go to (`layoutCommands`), and its collections
 * "Create detail page for <collection>" and "Set page collection ›"
 * (`detailCommands`).
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

const ctx: CommandContext = {
  editor,
  openShortcuts: () => {
    shortcutsOpen.value = true
  }
}

// Create component takes siblings on a page, as component_create does.
const canCreate = computed(() => {
  const root = editor.page?.root
  const ids = editor.selectedIds.filter(id => id !== root?.id)
  return !editor.componentId && !editor.layoutId && !!root && ids.length > 0 && !!siblingParent(root, ids)
})

const commands = computed(() => [
  ...editorCommands(ctx),
  ...(editor.project
    ? componentCommands(editor.project, { editingId: editor.componentId, canCreate: canCreate.value }, {
        insert: id => editor.insertInstance(id),
        edit: id => editor.editComponent(id),
        create: () => editor.createComponent(),
        previewInteractions: id => editor.previewInteractions(id)
      })
    : []),
  ...(editor.project
    ? layoutCommands(editor.project, { editingId: editor.layoutId, pageLayoutId: editor.currentPage?.layoutId, fromSelection: 'nodeIds' in editor.layoutFromSelection }, {
        create: () => editor.createLayout(),
        createFromSelection: () => editor.createLayoutFromSelection(),
        edit: id => editor.editLayout(id),
        setPageLayout: id => editor.setPageLayout(id)
      })
    : []),
  ...(editor.project
    ? detailCommands<CommandContext>(editor.project.collections, { pageCollection: editor.currentPage?.collection?.slug, onPage: editor.mode === 'build' && !!editor.page && !editor.componentId && !editor.layoutId }, {
        create: slug => editor.createDetailPage(slug),
        setCollection: slug => editor.setPageCollection(slug)
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
      disabled: !command.enabled(ctx),
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
  if (!command.enabled(ctx)) return
  editor.quickOpen = false
  recent.value = pushRecent(recent.value, command.id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
  command.run(ctx)
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
