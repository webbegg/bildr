<script setup lang="ts">
import { getComponent } from '#shared/document/components'
import type { DocNode } from '#shared/document/schema'
import { nodeLabel } from '#shared/runtime/render'

const props = defineProps<{ node: DocNode, depth: number }>()
const editor = useEditor()

const icon = computed(() => getComponent(props.node.type)?.icon ?? 'i-lucide-file')
const label = computed(() => (props.depth === 0 ? editor.page?.name ?? 'Page' : nodeLabel(props.node)))
</script>

<template>
  <div>
    <button
      type="button"
      :data-layer-id="node.id"
      class="flex w-full items-center gap-1.5 truncate py-1 pr-2 text-left text-sm"
      :class="editor.selectedId === node.id ? 'bg-primary/10 text-primary' : editor.hoveredId === node.id ? 'bg-elevated' : 'text-toned'"
      :style="{ paddingLeft: `${12 + depth * 14}px` }"
      @click="editor.selectedId = node.id"
      @mouseenter="editor.hoveredId = node.id"
    >
      <UIcon
        :name="icon"
        class="size-3.5 shrink-0"
      />
      <span class="truncate">{{ label }}</span>
    </button>
    <EditorLayerItem
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :depth="depth + 1"
    />
  </div>
</template>
