<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { findParent } from '#shared/document/tree'
import { siblingMove } from '#shared/editor/layers'

/**
 * The node context menu (Stacki's ElementContextMenu) over its slot. A
 * right-click on a layers row opens it for that row's node; the canvas
 * forwards its right-clicks as `contextmenu` events carrying `bildrNodeId`.
 * The node gets selected, and items that don't apply (the root) are disabled.
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
  editor.selectedId = id
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
  return [
    [
      { label: 'Duplicate', icon: 'i-lucide-copy', kbds: ['meta', 'd'], disabled: isRoot, onSelect: () => editor.duplicate(id) },
      { label: 'Wrap in Container', icon: 'i-lucide-square-dashed', disabled: isRoot, onSelect: () => editor.wrap(id, 'Container') },
      {
        label: 'Wrap in',
        icon: 'i-lucide-box',
        disabled: isRoot,
        children: (['Row', 'Column', 'Card', 'Grid'] as const).map(type => ({ label: type, onSelect: () => editor.wrap(id, type) }))
      }
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
      { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', kbds: ['delete'], disabled: isRoot, onSelect: () => editor.remove(id) }
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
