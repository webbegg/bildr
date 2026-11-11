<script setup lang="ts">
import { INSTANCE_TYPE, isContainerType, SLOT_FILL_TYPE } from '#shared/document/components'
import type { DocNode, LayoutSlot, PropertyDef } from '#shared/document/schema'
import { CHILDREN_SLOT } from '#shared/document/schema'
import { findNode } from '#shared/document/tree'
import { bindingLabel, propBindingAdd, uniqueComponentName } from '~/composables/componentEditor'
import { slotOf, variableAddItems } from '~/composables/layoutEditor'

/**
 * The panel's layout sections in the layout view. On the layout root: its
 * name, every slot and every variable. On another node: the slot bound to
 * it, if any, with "+" to make a container a named slot (pages can then
 * give it their own content), and the variables bound to its props, with
 * "+" to turn one of its props into a variable that each page sets. The
 * children slot, where the page content goes, cannot be removed.
 */
const { node } = defineProps<{ node: DocNode }>()
const editor = useEditor()

const SLOT_ITEM = '__slot'

const layout = computed(() => editor.layout)
const isRoot = computed(() => !!layout.value && layout.value.root.id === node.id)
const nodeSlot = computed(() => (layout.value ? slotOf(layout.value, node.id) : undefined))
const shownSlots = computed(() => (layout.value ? layout.value.slots.filter(s => isRoot.value || s.nodeId === node.id) : []))
const shownVariables = computed(() => (layout.value ? layout.value.variables.filter(v => isRoot.value || v.bindings.some(b => b.nodeId === node.id)) : []))
const canBeSlot = computed(() => !isRoot.value && isContainerType(node.type) && node.type !== INSTANCE_TYPE && node.type !== SLOT_FILL_TYPE)
const slotItems = computed(() => (canBeSlot.value ? [{ id: SLOT_ITEM, label: 'Make slot', disabled: !!nodeSlot.value, hint: nodeSlot.value ? 'Already a slot' : 'Pages can give it their own content' }] : []))
const variableItems = computed(() => (layout.value ? variableAddItems(layout.value, node) : []))

function nodeLabel(nodeId: string): string {
  const target = layout.value ? findNode(layout.value.root, nodeId) : undefined
  return target?.type ?? 'Missing node'
}

function boundTo(variable: PropertyDef): string {
  const binding = variable.bindings[0]
  return binding && layout.value ? bindingLabel(layout.value.root, binding) : 'Not bound; use {{ layout.NAME }} in texts'
}

function addSlot() {
  if (layout.value) editor.run('layout_slot_add', { layoutId: layout.value.id, name: uniqueComponentName('Slot', layout.value.slots), nodeId: node.id })
}

function renameSlot(slot: LayoutSlot, name: string) {
  const next = name.trim()
  if (layout.value && next && next !== slot.name) editor.run('layout_slot_update', { layoutId: layout.value.id, slotId: slot.id, name: next })
}

function removeSlot(slot: LayoutSlot) {
  if (layout.value) editor.run('layout_slot_remove', { layoutId: layout.value.id, slotId: slot.id })
}

function addVariable(item: string) {
  const add = layout.value ? propBindingAdd(layout.value.variables, node, item) : undefined
  if (add) editor.run('layout_variable_add', { layoutId: layout.value!.id, ...add })
}

function renameVariable(variable: PropertyDef, name: string) {
  const next = name.trim()
  if (layout.value && next && next !== variable.name) editor.run('layout_variable_update', { layoutId: layout.value.id, variableId: variable.id, name: next })
}

function removeVariable(variable: PropertyDef) {
  if (layout.value) editor.run('layout_variable_remove', { layoutId: layout.value.id, variableId: variable.id })
}

function renameLayout(name: string) {
  const next = name.trim()
  if (layout.value && next && next !== layout.value.name) editor.run('layout_rename', { layoutId: layout.value.id, name: next })
}
</script>

<template>
  <template v-if="layout">
    <EditorStyleSection
      v-if="isRoot"
      label="Layout"
      data-layout-settings
    >
      <EditorRow label="Name">
        <EditorCommitInput
          size="xs"
          variant="soft"
          aria-label="Layout name"
          :model-value="layout.name"
          @commit="renameLayout"
        />
      </EditorRow>
    </EditorStyleSection>

    <EditorStyleSection
      v-if="isRoot || canBeSlot || shownSlots.length"
      label="Slots"
      add-label="Add slot"
      :menu="slotItems"
      data-layout-slots
      @add="addSlot"
    >
      <EditorRow
        v-for="slot in shownSlots"
        :key="slot.id"
        :label="slot.id === CHILDREN_SLOT ? 'page content' : 'slot'"
        :title="`Bound to ${nodeLabel(slot.nodeId)}`"
        :removable="slot.id !== CHILDREN_SLOT"
        @remove="removeSlot(slot)"
      >
        <EditorCommitInput
          size="xs"
          variant="soft"
          :aria-label="`${slot.name} slot name`"
          :model-value="slot.name"
          @commit="renameSlot(slot, $event)"
        />
      </EditorRow>
      <p
        v-if="!shownSlots.length"
        class="text-[11px] text-dimmed"
      >
        Use + to let pages give this container their own content.
      </p>
    </EditorStyleSection>

    <EditorStyleSection
      label="Variables"
      add-label="Add variable"
      :menu="variableItems"
      data-layout-variables
      @add="addVariable"
    >
      <EditorRow
        v-for="variable in shownVariables"
        :key="variable.id"
        :label="variable.kind"
        :title="`Bound to ${boundTo(variable)}`"
        removable
        @remove="removeVariable(variable)"
      >
        <EditorCommitInput
          size="xs"
          variant="soft"
          :aria-label="`${variable.name} variable name`"
          :model-value="variable.name"
          @commit="renameVariable(variable, $event)"
        />
      </EditorRow>
      <p
        v-if="!shownVariables.length"
        class="text-[11px] text-dimmed"
      >
        {{ variableItems.length ? 'Use + to let each page set one of these props.' : 'Select an element of the layout to add variables.' }}
      </p>
    </EditorStyleSection>
  </template>
</template>
