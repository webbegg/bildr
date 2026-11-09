<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { findParent } from '#shared/document/tree'
import { siblingMove } from '#shared/editor/layers'
import { siblingParent } from '#shared/editor/selection'

/**
 * The node context menu (Stacki's ElementContextMenu) over its slot. A
 * right-click on a layers row opens it for that row's node; the canvas
 * forwards its right-clicks as `contextmenu` events carrying `bildrNodeId`.
 * The node gets selected (a node of a multi-selection keeps the selection,
 * and Duplicate, Wrap and Delete then act on all of it), and items that
 * don't apply (the root) are disabled.
 */
defineOptions({ inheritAttrs: false })

type NodeMenuEvent = MouseEvent & { bildrNodeId?: string }

const editor = useEditor()
const toast = useToast()
const nodeId = ref<string | null>(null)

function onContextMenu(event: NodeMenuEvent) {
  const id = event.bildrNodeId ?? (event.target as Element | null)?.closest?.('[data-layer-id]')?.getAttribute('data-layer-id') ?? null
  nodeId.value = id
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
  return [
    [
      { label: 'Duplicate', icon: 'i-lucide-copy', kbds: ['meta', 'd'], disabled: isRoot, onSelect: () => editor.duplicate(many ? undefined : id) },
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
      { label: 'Select parent', icon: 'i-lucide-arrow-up-left', disabled: !parent, onSelect: () => (editor.selectedId = parent?.id ?? id) },
      { label: 'Move up', icon: 'i-lucide-arrow-up', disabled: !siblingMove(root, id, -1), onSelect: () => editor.moveBy(id, -1) },
      { label: 'Move down', icon: 'i-lucide-arrow-down', disabled: !siblingMove(root, id, 1), onSelect: () => editor.moveBy(id, 1) }
    ],
    [
      { label: 'Copy id', icon: 'i-lucide-hash', onSelect: () => copyId(id) }
    ],
    [
      { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', kbds: ['delete'], disabled: isRoot, onSelect: () => editor.remove(many ? undefined : id) }
    ]
  ]
})
</script>

<template>
  <UContextMenu
    :items="items"
    size="sm"
    :ui="{ content: 'min-w-48' }"
  >
    <div
      v-bind="$attrs"
      @contextmenu="onContextMenu"
    >
      <slot />
    </div>
  </UContextMenu>
</template>
