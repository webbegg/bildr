<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LayoutFile, PageFile } from '@bildr/codegen/model'
import ComponentPanel from './ComponentPanel.vue'
import LayoutPanel from './LayoutPanel.vue'
import PagePanel from './PagePanel.vue'
import PropsPanel from './PropsPanel.vue'
import StylePanel from './StylePanel.vue'
import { nodeIcon } from './icons.ts'
import { useDesign, WRAP_TYPES } from './store.ts'

/** The inspector: the selected node's header and actions, its props and its style at the device being edited. */

const design = useDesign()
const node = computed(() => design.selected.value)
const many = computed(() => design.selectedIds.value.length > 1)
const isRoot = computed(() => !!node.value && design.file.value?.root.id === node.value.id)
const tab = ref<'node' | 'file'>('node')
const FILE_LABELS = { page: 'Page', component: 'Component', layout: 'Layout' } as const
const fileLabel = computed(() => design.fileKind.value ? FILE_LABELS[design.fileKind.value] : '')
const wrap = (event: Event) => {
  const select = event.target as HTMLSelectElement
  const type = select.value as typeof WRAP_TYPES[number]
  select.value = ''
  if (type) void design.wrap(type)
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div
      v-if="design.fileKind.value"
      class="flex gap-1 border-b border-default p-1"
    >
      <UButton
        data-testid="inspector-tab-node"
        label="Node"
        size="xs"
        color="neutral"
        :variant="tab === 'node' ? 'soft' : 'ghost'"
        @click="tab = 'node'"
      />
      <UButton
        data-testid="inspector-tab-file"
        :label="fileLabel"
        size="xs"
        color="neutral"
        :variant="tab === 'file' ? 'soft' : 'ghost'"
        @click="tab = 'file'"
      />
    </div>
    <ComponentPanel
      v-if="tab === 'file' && design.component.value"
      :component="design.component.value"
    />
    <LayoutPanel
      v-else-if="tab === 'file' && design.fileKind.value === 'layout'"
      :layout="design.file.value as LayoutFile"
    />
    <PagePanel
      v-else-if="tab === 'file' && design.fileKind.value === 'page'"
      :page="design.file.value as PageFile"
    />
    <div
      v-else-if="node"
      class="flex min-h-0 flex-col"
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
            {{ design.nameOf(node) ?? node.type }}
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
        :node="design.inspected.value ?? node"
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
  </div>
</template>
