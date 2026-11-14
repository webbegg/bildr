<script setup lang="ts">
import { computed } from 'vue'
import PropsPanel from './PropsPanel.vue'
import StylePanel from './StylePanel.vue'
import { nodeIcon } from './icons.ts'
import { useDesign, WRAP_TYPES } from './store.ts'

/** The inspector: the selected node's header and actions, its props and its style at the device being edited. */

const design = useDesign()
const node = computed(() => design.selected.value)
const many = computed(() => design.selectedIds.value.length > 1)
const isRoot = computed(() => !!node.value && design.file.value?.root.id === node.value.id)
const wrap = (event: Event) => {
  const select = event.target as HTMLSelectElement
  const type = select.value as typeof WRAP_TYPES[number]
  select.value = ''
  if (type) void design.wrap(type)
}
</script>

<template>
  <div
    v-if="node"
    class="flex min-h-0 flex-col overflow-y-auto"
  >
    <div
      class="flex items-center gap-2 border-b border-default px-3 py-2"
      data-testid="inspector-node"
    >
      <UIcon
        :name="nodeIcon(node.type)"
        class="size-4 text-muted"
      />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium">
          {{ node.name ?? node.type }}
        </div>
        <div class="truncate text-xs text-muted">
          {{ many ? `${design.selectedIds.value.length} selected` : `${node.type} · ${node.id}` }}
        </div>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-1 border-b border-default px-3 py-2">
      <UButton
        data-testid="node-duplicate"
        icon="i-lucide-copy"
        aria-label="Duplicate"
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="isRoot"
        @click="design.duplicate()"
      />
      <UButton
        data-testid="node-delete"
        icon="i-lucide-trash-2"
        aria-label="Delete"
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="isRoot"
        @click="design.remove()"
      />
      <UButton
        data-testid="node-wrap"
        icon="i-lucide-package"
        aria-label="Wrap in a container"
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="isRoot"
        @click="design.wrap()"
      />
      <select
        data-testid="node-wrap-type"
        class="rounded-md border border-default bg-default px-1 py-0.5 text-xs"
        :disabled="isRoot"
        aria-label="Wrap in"
        @change="wrap"
      >
        <option value="">
          Wrap in…
        </option>
        <option
          v-for="type in WRAP_TYPES"
          :key="type"
          :value="type"
        >
          {{ type }}
        </option>
      </select>
      <UButton
        data-testid="node-component"
        icon="i-lucide-component"
        label="Make component"
        size="xs"
        color="neutral"
        variant="ghost"
        :disabled="isRoot || node.type === 'SlotFill'"
        @click="design.makeComponent()"
      />
    </div>
    <PropsPanel
      :key="node.id"
      :node="node"
    />
    <StylePanel />
  </div>
  <p
    v-else
    class="p-4 text-sm text-muted"
    data-testid="inspector-empty"
  >
    Select a layer, or click an element on the canvas.
  </p>
</template>
