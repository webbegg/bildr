<script setup lang="ts">
import type { PropValue } from '#shared/document/components'
import { getComponent, INSTANCE_TYPE, isContainerType, SLOT_FILL_TYPE } from '#shared/document/components'
import type { DocNode, PropertyDef, Variant } from '#shared/document/schema'
import type { Provenance } from '#shared/editor/styleFields'
import { findNode } from '#shared/document/tree'
import { propertyField, uniqueComponentName } from '~/composables/componentEditor'
import { instanceVariantValue, newVariantName, PRIMARY_VARIANT, variantItems } from '~/composables/componentVariants'

/**
 * The panel's component sections. On an Instance: its component (with Edit
 * component), its variant (blue when not the primary; reset goes back to
 * it) and a field per property, set per instance (blue when set; reset goes
 * back to the default), plus each slot's "Own content" switch. In the
 * component view: the variants (Primary first; click one to show and edit
 * it, "+" adds one), the component name and properties on its root, and on
 * any definition node the properties bound to it, with "+" to turn one of
 * its props, or a container's children (a slot), into a property.
 */
const { node } = defineProps<{ node: DocNode }>()
const editor = useEditor()

const SLOT_PROP = 'children'
const SLOT_ITEM = '__slot'

// An Instance on the page or nested in the definition being edited.
const instanceOf = computed(() => (node.type === INSTANCE_TYPE ? editor.project?.components.find(c => c.id === node.props.component) ?? null : null))
const valueFields = computed(() => (instanceOf.value ? instanceOf.value.properties.filter(p => p.kind !== 'slot').map(p => ({ property: p, field: propertyField(instanceOf.value!, p) })) : []))
const slots = computed(() => instanceOf.value?.properties.filter(p => p.kind === 'slot') ?? [])
const filled = (slot: PropertyDef) => node.children.some(c => c.type === SLOT_FILL_TYPE && c.props.slot === slot.id)

function setValue(property: PropertyDef, value: PropValue | null) {
  editor.runOnPage('instance_set_values', { nodeId: node.id, values: { [property.id]: value } })
}

const variantChoices = computed(() => (instanceOf.value ? variantItems(instanceOf.value) : []))
const variantSet = computed<Provenance>(() => (node.props.variant ? { state: 'set', key: 'variant', value: String(node.props.variant) } : { state: 'unset' }))

function setVariant(item: string) {
  editor.runOnPage('instance_set_values', { nodeId: node.id, variant: instanceVariantValue(item) })
}

function setSlot(slot: PropertyDef, value: boolean) {
  editor.runOnPage('instance_set_slot', { nodeId: node.id, slot: slot.id, filled: value })
}

// The component view: the definition the selected node belongs to.
const def = computed(() => editor.component)
const isDefRoot = computed(() => !!def.value && def.value.root.id === node.id)
const shownProperties = computed(() => (def.value ? def.value.properties.filter(p => isDefRoot.value || p.bindings.some(b => b.nodeId === node.id)) : []))
const bound = (prop: string) => !!def.value?.properties.some(p => p.bindings.some(b => b.nodeId === node.id && b.prop === prop))

const addItems = computed(() => {
  if (!def.value || node.type === INSTANCE_TYPE || node.type === SLOT_FILL_TYPE) return []
  const props = (getComponent(node.type)?.props ?? []).map(p => ({ id: p.name, label: p.label, disabled: bound(p.name), hint: bound(p.name) ? 'Already a property' : undefined }))
  const slot = isContainerType(node.type) ? [{ id: SLOT_ITEM, label: 'Slot (children)', disabled: bound(SLOT_PROP), hint: bound(SLOT_PROP) ? 'Already a slot' : 'Instances can fill it' }] : []
  return [...props, ...slot]
})

function boundTo(property: PropertyDef): string {
  const binding = property.bindings[0]
  const target = binding && def.value ? findNode(def.value.root, binding.nodeId) : undefined
  return target ? `${target.type}${binding!.prop === SLOT_PROP ? '' : ` · ${binding!.prop}`}` : 'Not bound'
}

function addProperty(item: string) {
  if (!def.value) return
  const taken = def.value.properties
  if (item === SLOT_ITEM) {
    editor.run('component_property_add', { componentId: def.value.id, name: uniqueComponentName('Content', taken), kind: 'slot', bindings: [{ nodeId: node.id, prop: SLOT_PROP }] })
    return
  }
  const propDef = getComponent(node.type)?.props.find(p => p.name === item)
  if (!propDef) return
  const value = node.props[item]
  editor.run('component_property_add', {
    componentId: def.value.id,
    name: uniqueComponentName(propDef.label, taken),
    kind: propDef.kind,
    ...(value === undefined ? {} : { default: value }),
    bindings: [{ nodeId: node.id, prop: item }]
  })
}

function renameProperty(property: PropertyDef, name: string) {
  const next = name.trim()
  if (def.value && next && next !== property.name) editor.run('component_property_update', { componentId: def.value.id, propertyId: property.id, name: next })
}

function removeProperty(property: PropertyDef) {
  if (def.value) editor.run('component_property_remove', { componentId: def.value.id, propertyId: property.id })
}

async function addVariant() {
  if (!def.value) return
  const result = await editor.run<{ variantId: string }>('component_variant_add', { componentId: def.value.id, name: newVariantName(def.value) })
  if (result) editor.selectVariant(result.variantId)
}

function renameVariant(variant: Variant, name: string) {
  const next = name.trim()
  if (def.value && next && next !== variant.name) editor.run('component_variant_rename', { componentId: def.value.id, variantId: variant.id, name: next })
}

function deleteVariant(variant: Variant) {
  if (def.value) editor.run('component_variant_delete', { componentId: def.value.id, variantId: variant.id })
}

function renameComponent(name: string) {
  const next = name.trim()
  if (def.value && next && next !== def.value.name) editor.run('component_rename', { componentId: def.value.id, name: next })
}
</script>

<template>
  <EditorStyleSection
    v-if="node.type === INSTANCE_TYPE"
    label="Component"
    data-component-instance
  >
    <EditorRow label="Component">
      <div class="flex h-[30px] min-w-0 items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-[13px] text-highlighted">{{ instanceOf?.name ?? 'Missing component' }}</span>
        <UButton
          v-if="instanceOf"
          label="Edit"
          icon="i-lucide-pencil-ruler"
          size="xs"
          color="neutral"
          variant="soft"
          @click="editor.editComponent(instanceOf.id)"
        />
      </div>
    </EditorRow>
    <EditorRow
      v-if="instanceOf?.variants.length"
      label="Variant"
      :provenance="variantSet"
      data-instance-variant
      @reset="setVariant(PRIMARY_VARIANT)"
    >
      <USelect
        :model-value="String(node.props.variant || PRIMARY_VARIANT)"
        :items="variantChoices"
        aria-label="Variant"
        size="xs"
        variant="soft"
        :ui="{ base: 'h-[30px] rounded-lg bg-elevated text-[13px]', trailingIcon: 'size-3.5 text-dimmed' }"
        class="w-full"
        @update:model-value="setVariant"
      />
    </EditorRow>
    <EditorPropField
      v-for="{ property, field } in valueFields"
      :key="property.id"
      :def="field"
      :value="node.props[property.id] ?? field.default"
      :changed="property.id in node.props"
      @update="setValue(property, $event)"
      @reset="setValue(property, null)"
    />
    <EditorRow
      v-for="slot in slots"
      :key="slot.id"
      :label="slot.name"
      :title="`${slot.name}: on, this instance has its own content; off, it shows the component's`"
    >
      <div class="flex h-[30px] items-center gap-2">
        <USwitch
          size="sm"
          :model-value="filled(slot)"
          :aria-label="`${slot.name}: own content`"
          @update:model-value="setSlot(slot, $event)"
        />
        <span class="text-[11px] text-dimmed">Own content</span>
      </div>
    </EditorRow>
    <p
      v-if="instanceOf && !instanceOf.properties.length"
      class="text-[11px] text-dimmed"
    >
      This component has no properties. Add them in the component view.
    </p>
  </EditorStyleSection>

  <EditorStyleSection
    v-if="def"
    label="Variants"
    :menu="[{ id: 'add', label: 'New variant', hint: 'Starts like the primary' }]"
    data-component-variants
    @add="addVariant"
  >
    <div
      class="flex h-[30px] items-center"
      data-variant-row="primary"
    >
      <button
        type="button"
        class="h-full min-w-0 flex-1 truncate rounded-lg px-2 text-start text-[13px]"
        :class="editor.variant ? 'text-toned hover:bg-white/4' : 'bg-white/8 font-medium text-highlighted'"
        :aria-pressed="!editor.variant"
        @click="editor.selectVariant(null)"
      >
        Primary
      </button>
    </div>
    <div
      v-for="variant in def.variants"
      :key="variant.id"
      class="flex h-[30px] items-center gap-1"
      :data-variant-row="variant.id"
    >
      <UButton
        :icon="editor.variant?.id === variant.id ? 'i-lucide-eye' : 'i-lucide-circle'"
        size="xs"
        :color="editor.variant?.id === variant.id ? 'primary' : 'neutral'"
        variant="ghost"
        :aria-label="`Show and edit ${variant.name}`"
        :aria-pressed="editor.variant?.id === variant.id"
        @click="editor.selectVariant(variant.id)"
      />
      <EditorCommitInput
        class="min-w-0 flex-1"
        size="xs"
        variant="soft"
        :aria-label="`${variant.name} variant name`"
        :model-value="variant.name"
        @commit="renameVariant(variant, $event)"
      />
      <UButton
        icon="i-lucide-trash-2"
        size="xs"
        color="neutral"
        variant="ghost"
        :aria-label="`Delete ${variant.name}`"
        @click="deleteVariant(variant)"
      />
    </div>
    <p
      v-if="editor.variant"
      class="text-[11px] text-dimmed"
    >
      Prop and style edits now override {{ editor.variant.name }} only.
    </p>
  </EditorStyleSection>

  <EditorStyleSection
    v-if="def"
    :label="isDefRoot ? 'Component properties' : 'Properties'"
    :menu="addItems"
    data-component-properties
    @add="addProperty"
  >
    <EditorRow
      v-if="isDefRoot"
      label="Name"
    >
      <EditorCommitInput
        size="xs"
        variant="soft"
        aria-label="Component name"
        :model-value="def.name"
        @commit="renameComponent"
      />
    </EditorRow>
    <EditorRow
      v-for="property in shownProperties"
      :key="property.id"
      :label="property.kind"
      :title="`Bound to ${boundTo(property)}`"
      removable
      @remove="removeProperty(property)"
    >
      <EditorCommitInput
        size="xs"
        variant="soft"
        :aria-label="`${property.name} property name`"
        :model-value="property.name"
        @commit="renameProperty(property, $event)"
      />
    </EditorRow>
    <p
      v-if="!shownProperties.length"
      class="text-[11px] text-dimmed"
    >
      {{ addItems.length ? 'Use + to let instances set one of these props.' : 'Select an element of the component to add properties.' }}
    </p>
  </EditorStyleSection>
</template>
