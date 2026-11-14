<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ComponentFile } from '@bildr/codegen/model'
import { STATE_KINDS } from './kinds.ts'
import CommitInput from './CommitInput.vue'
import { useDesign } from './store.ts'
import { findNode } from './tree.ts'

/**
 * A component's variants (add, rename, delete), their hover and pressed
 * states, and the variant being edited: the canvas shows it, and every style
 * or prop edit while it is active is recorded as its override (see
 * `design/store.ts`). The active variant's overrides list below, each one
 * resettable.
 */

const props = defineProps<{ component: ComponentFile }>()
const design = useDesign()

const name = ref('')
const bases = computed(() => [{ id: '', name: 'default' }, ...props.component.variants.filter(variant => !variant.state)])
const hasState = (base: string, kind: string) => props.component.variants.some(variant => variant.state?.of === base && variant.state.kind === kind)
const baseName = (id: string) => id === '' ? 'default' : props.component.variants.find(variant => variant.id === id)?.name ?? id

const edit = (action: string, input: Record<string, unknown>) => design.edit(action, { component: props.component.id, ...input })
const add = async () => {
  if (!name.value.trim()) return
  const out = await edit('component_variant_add', { name: name.value.trim() })
  if (out) {
    name.value = ''
    if (typeof out.variantId === 'string') design.selectVariant(out.variantId)
  }
}

interface OverrideRow { nodeId: string, node: string, key: string, kind: 'style' | 'prop' | 'unset', value: string }
const overrides = computed<OverrideRow[]>(() => {
  const active = design.variant.value
  if (!active) return []
  return Object.entries(active.overrides).flatMap(([nodeId, override]) => {
    const found = findNode(props.component.root, nodeId)
    const node = found?.name ?? found?.type ?? nodeId
    return [
      ...Object.entries(override.style ?? {}).map(([key, value]): OverrideRow => ({ nodeId, node, key, kind: 'style', value })),
      ...Object.entries(override.props ?? {}).map(([key, value]): OverrideRow => ({ nodeId, node, key, kind: 'prop', value: JSON.stringify(value) })),
      ...(override.unset ?? []).map((key): OverrideRow => ({ nodeId, node, key, kind: 'unset', value: 'removed' }))
    ]
  })
})
const reset = (row: OverrideRow) => {
  if (row.kind === 'style') return design.override(row.nodeId, { style: { [row.key]: null } })
  if (row.kind === 'prop') return design.override(row.nodeId, { props: { [row.key]: null } })
  // A removed token comes back by giving the primary's value: the override then matches and drops.
  const primary = findNode(props.component.root, row.nodeId)?.style?.[row.key]
  return primary === undefined ? undefined : design.override(row.nodeId, { style: { [row.key]: primary } })
}
</script>

<template>
  <div
    class="flex flex-col gap-2"
    data-testid="variants"
  >
    <ul class="flex flex-col gap-1">
      <li class="flex items-center gap-1 text-xs">
        <button
          type="button"
          data-testid="variant-activate-"
          class="flex-1 rounded-md px-2 py-1 text-left"
          :class="design.variantId.value === null ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-elevated'"
          @click="design.selectVariant(null)"
        >
          Primary
        </button>
      </li>
      <li
        v-for="variant in component.variants"
        :key="variant.id"
        class="flex items-center gap-1 text-xs"
        :class="variant.state ? 'ml-4' : ''"
      >
        <button
          type="button"
          :data-testid="`variant-activate-${variant.id}`"
          class="shrink-0 rounded-md px-1.5 py-1"
          :class="design.variantId.value === variant.id ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated'"
          :aria-label="`Edit ${variant.name}`"
          :aria-pressed="design.variantId.value === variant.id"
          @click="design.selectVariant(variant.id)"
        >
          <UIcon
            :name="variant.state ? 'i-lucide-mouse-pointer-click' : 'i-lucide-layers'"
            class="size-3.5"
          />
        </button>
        <CommitInput
          :data-testid="`variant-rename-${variant.id}`"
          :model-value="variant.name"
          @commit="edit('component_variant_rename', { variant: variant.id, name: $event })"
        />
        <span
          v-if="variant.state"
          class="shrink-0 text-muted"
        >{{ variant.state.kind }} of {{ baseName(variant.state.of) }}</span>
        <UButton
          :data-testid="`variant-delete-${variant.id}`"
          icon="i-lucide-trash-2"
          aria-label="Delete variant"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="edit('component_variant_delete', { variant: variant.id })"
        />
      </li>
    </ul>

    <div class="flex items-center gap-1">
      <CommitInput
        data-testid="variant-add-name"
        :model-value="name"
        placeholder="New variant"
        @commit="name = $event"
      />
      <UButton
        data-testid="variant-add"
        icon="i-lucide-plus"
        aria-label="Add a variant"
        size="xs"
        color="neutral"
        variant="soft"
        @click="add()"
      />
    </div>

    <div
      class="flex flex-wrap gap-1"
      data-testid="states"
    >
      <template
        v-for="base in bases"
        :key="base.id"
      >
        <template
          v-for="kind in STATE_KINDS"
          :key="kind"
        >
          <UButton
            v-if="!hasState(base.id, kind)"
            :data-testid="`state-add-${base.id}-${kind}`"
            :label="`${base.name} ${kind}`"
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="outline"
            @click="edit('component_state_add', { baseVariant: base.id, kind })"
          />
        </template>
      </template>
    </div>

    <div
      v-if="overrides.length"
      class="flex flex-col gap-0.5"
    >
      <h4 class="text-xs font-medium text-muted">
        Overrides in {{ design.variant.value?.name }}
      </h4>
      <div
        v-for="row in overrides"
        :key="`${row.nodeId}-${row.kind}-${row.key}`"
        class="flex items-center gap-1 text-xs"
        data-testid="override"
      >
        <code class="min-w-0 flex-1 truncate">{{ row.node }} · {{ row.key }}: {{ row.value }}</code>
        <button
          type="button"
          :data-testid="`override-reset-${row.nodeId}-${row.key}`"
          aria-label="Reset override"
          @click="reset(row)"
        >
          <UIcon
            name="i-lucide-x"
            class="size-3"
          />
        </button>
      </div>
    </div>
  </div>
</template>
