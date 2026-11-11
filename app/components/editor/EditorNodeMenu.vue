<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { INSTANCE_TYPE } from '#shared/document/components'
import { findNode, findParent } from '#shared/document/tree'
import { filterMenuItems } from '#shared/editor/commands'
import { naturalDisplay, siblingMove, visibilityAt, visibilityToggle } from '#shared/editor/layers'
import { sameComponentNodes, sameTypeNodes, selectAllSiblings, siblingParent } from '#shared/editor/selection'

/**
 * The node context menu (Stacki's ElementContextMenu, completed after
 * Framer's) over its slot. A right-click on a layers row opens it for that
 * row's node; the canvas forwards its right-clicks as `contextmenu` events
 * carrying `bildrNodeId`. The node gets selected (a node of a
 * multi-selection keeps the selection, and Duplicate, Wrap, Lock and Delete
 * then act on all of it). A search field on top filters the actions (a
 * submenu's items as "Parent › Item"); Arrow Down moves into the list and
 * Enter runs the first match. Items that don't apply (the root, an empty
 * clipboard, a non-instance) show dimmed rather than hidden.
 */
defineOptions({ inheritAttrs: false })

type NodeMenuEvent = MouseEvent & { bildrNodeId?: string }

const editor = useEditor()
const toast = useToast()
const nodeId = ref<string | null>(null)
const query = ref('')
const ui = mergeUi(MENU_UI, { content: 'min-w-56' })
let search: HTMLInputElement | null = null
const searchRef = (el: unknown) => {
  search = el as HTMLInputElement | null
}
const content = {
  // The search takes the focus; on close it stays in a layers row being renamed.
  onOpenAutoFocus: (event: Event) => {
    event.preventDefault()
    search?.focus()
  },
  onCloseAutoFocus: (event: Event) => {
    if (editor.renamingId) event.preventDefault()
  }
}

function onContextMenu(event: NodeMenuEvent) {
  const id = event.bildrNodeId ?? (event.target as Element | null)?.closest?.('[data-layer-id]')?.getAttribute('data-layer-id') ?? null
  nodeId.value = id
  query.value = ''
  // Nothing to act on: no menu (the trigger skips prevented events).
  if (!id) return event.preventDefault()
  if (!editor.selectedIds.includes(id)) editor.selectedId = id
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    toast.add({ title: 'Copied node id', description: id, icon: 'i-lucide-check' })
  } catch {
    toast.add({ title: 'Could not copy the id', description: id, color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function select(ids: string[]) {
  if (ids.length) editor.selectedIds = ids
}

const items = computed<ContextMenuItem[][]>(() => {
  const id = nodeId.value
  const root = editor.page?.root
  if (!id || !root) return []
  const isRoot = id === root.id
  const parent = findParent(root, id)?.parent
  const many = editor.selectedIds.length > 1 && editor.selectedIds.includes(id)
  // Siblings wrap together in document order; a multi-selection of several parents cannot.
  const wrapIds = many ? [...editor.selectedIds].sort((a, b) => (findParent(root, a)?.index ?? 0) - (findParent(root, b)?.index ?? 0)) : [id]
  const cannotWrap = isRoot || (many && !siblingParent(root, wrapIds))
  const node = findNode(root, id)
  const hidden = node ? visibilityAt(node.style, editor.deviceId).hidden : false
  const lockIds = many ? editor.selectedIds.filter(other => other !== root.id) : [id]
  const unlock = lockIds.length > 0 && lockIds.every(other => findNode(root, other)?.locked === true)
  const isInstance = node?.type === INSTANCE_TYPE
  const onPage = !editor.componentId && !editor.layoutId
  const sameType = sameTypeNodes(root, id)
  const sameComponent = sameComponentNodes(root, id)
  const hasClip = !!editor.clipboard
  return [
    [
      { label: 'Add to agent', icon: 'i-lucide-sparkles', disabled: !onPage, onSelect: () => editor.addToAgent() }
    ],
    [
      // Components are made from page content; in the component view, nest one with Insert instead.
      { label: 'Create component…', icon: 'i-lucide-component', kbds: ['meta', 'alt', 'k'], disabled: cannotWrap || !onPage, onSelect: () => editor.createComponent() },
      { label: 'Edit component', icon: 'i-lucide-pencil-ruler', disabled: !isInstance, onSelect: () => node && editor.editComponent(String(node.props.component), null, { nested: true }) }
    ],
    [
      {
        label: 'Select',
        icon: 'i-lucide-mouse-pointer-2',
        children: [
          { label: 'Same type', description: node ? `Every ${node.type} (${sameType.length})` : undefined, disabled: sameType.length < 2, onSelect: () => select(sameType) },
          { label: 'Same component', description: isInstance ? `Every instance (${sameComponent.length})` : 'For component instances', disabled: sameComponent.length < 2, onSelect: () => select(sameComponent) },
          { label: 'Siblings', kbds: ['meta', 'a'], disabled: isRoot, onSelect: () => select(selectAllSiblings(root, [id])) }
        ]
      },
      { label: many ? 'Group in Container' : 'Wrap in Container', icon: 'i-lucide-square-dashed', kbds: ['meta', 'g'], disabled: cannotWrap, onSelect: () => editor.wrap(wrapIds, 'Container') },
      {
        label: 'Wrap in',
        icon: 'i-lucide-box',
        disabled: cannotWrap,
        children: (['Row', 'Column', 'Card', 'Grid'] as const).map(type => ({ label: type, onSelect: () => editor.wrap(wrapIds, type) }))
      },
      { label: 'Add auto layout', icon: 'i-lucide-layout-panel-left', kbds: ['shift', 'a'], disabled: cannotWrap, onSelect: () => editor.autoLayout() }
    ],
    [
      {
        label: 'Copy',
        icon: 'i-lucide-clipboard-copy',
        children: [
          { label: 'Copy', kbds: ['meta', 'c'], disabled: isRoot, onSelect: () => editor.copy(many ? undefined : id) },
          { label: 'Copy id', icon: 'i-lucide-hash', onSelect: () => copyId(id) }
        ]
      },
      {
        label: 'Paste',
        icon: 'i-lucide-clipboard-paste',
        disabled: !hasClip,
        children: [
          { label: 'Paste', kbds: ['meta', 'v'], disabled: !hasClip, onSelect: () => editor.paste() },
          { label: 'Paste style', kbds: ['meta', 'alt', 'v'], disabled: !hasClip, onSelect: () => editor.pasteStyle(many ? undefined : id) }
        ]
      },
      { label: 'Duplicate', icon: 'i-lucide-copy', kbds: ['meta', 'd'], disabled: isRoot, onSelect: () => editor.duplicate(many ? undefined : id) }
    ],
    [
      { label: 'Rename', icon: 'i-lucide-text-cursor-input', kbds: ['meta', 'r'], disabled: isRoot, onSelect: () => editor.startRename(id) },
      { label: unlock ? 'Unlock' : 'Lock', icon: unlock ? 'i-lucide-lock-open' : 'i-lucide-lock', kbds: ['meta', 'l'], disabled: isRoot, onSelect: () => editor.setLocked(lockIds, !unlock) },
      {
        label: hidden ? 'Show here' : 'Hide here',
        icon: hidden ? 'i-lucide-eye' : 'i-lucide-eye-off',
        disabled: isRoot || !node,
        onSelect: () => node && editor.updateStyle(id, visibilityToggle(node.style, editor.deviceId, naturalDisplay(node), editor.frames))
      }
    ],
    [
      { label: 'Select parent', icon: 'i-lucide-arrow-up-left', kbds: ['escape'], disabled: !parent, onSelect: () => (editor.selectedId = parent?.id ?? id) },
      { label: 'Move up', icon: 'i-lucide-arrow-up', disabled: !siblingMove(root, id, -1), onSelect: () => editor.moveBy(id, -1) },
      { label: 'Move down', icon: 'i-lucide-arrow-down', disabled: !siblingMove(root, id, 1), onSelect: () => editor.moveBy(id, 1) }
    ],
    [
      { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', kbds: ['delete'], disabled: isRoot, onSelect: () => editor.remove(many ? undefined : id) }
    ]
  ]
})

const NO_MATCH: ContextMenuItem[][] = [[{ label: 'No matching actions', disabled: true }]]
const shown = computed(() => {
  const groups = filterMenuItems(items.value, query.value)
  return groups.length ? groups : NO_MATCH
})

/** Arrow Down moves into the list; Enter runs the first available match and closes. Other keys stay in the field (no typeahead). */
function onSearchKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') return
  event.stopPropagation()
  const menu = (event.target as HTMLElement).closest('[role="menu"]')
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    menu?.querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])')?.focus()
  } else if (event.key === 'Enter' && query.value.trim()) {
    event.preventDefault()
    const first = shown.value.flat().find(item => !item.disabled && item.onSelect)
    if (!first) return
    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    first.onSelect!(new Event('select'))
  }
}
</script>

<template>
  <UContextMenu
    :items="shown"
    :ui="ui"
    :content="content"
  >
    <div
      v-bind="$attrs"
      @contextmenu="onContextMenu"
    >
      <slot />
    </div>
    <template #content-top="{ sub }">
      <div
        v-if="!sub"
        class="mb-1 flex h-8 items-center gap-2 border-b border-white/8 px-2.5"
      >
        <UIcon
          name="i-lucide-search"
          class="size-3.5 shrink-0 text-dimmed"
        />
        <input
          :ref="searchRef"
          v-model="query"
          type="text"
          placeholder="Type to search…"
          aria-label="Search actions"
          class="min-w-0 flex-1 bg-transparent text-[12px] text-highlighted outline-none placeholder:text-dimmed"
          data-node-menu-search
          @keydown="onSearchKeyDown"
        >
      </div>
    </template>
  </UContextMenu>
</template>
