<script setup lang="ts">
import type { PropValue } from '#shared/document/components'
import { getComponent, INSTANCE_TYPE, isContainerType, SLOT_FILL_TYPE } from '#shared/document/components'
import type { DocNode, PropertyDef, Variant } from '#shared/document/schema'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Provenance } from '#shared/editor/styleFields'
import { propertyLabel } from '#shared/editor/propertyLabels'
import { bindingLabel, boundProperty, propBindingAdd, propertyField, uniqueComponentName } from '~/composables/componentEditor'
import { instanceVariantValue, newVariantName, PRIMARY_VARIANT, variantItems } from '~/composables/componentVariants'

/**
 * The panel's component sections. On an Instance: its component (with Edit
 * component), its variant (blue when not the primary; reset goes back to
 * it) and a field per property, set per instance (blue when set; reset goes
 * back to the default), plus each slot's "Own content" switch. In the
 * component view: the variants, one row style for all (Primary first, with
 * its tag; click one to show and edit it, its menu renames or deletes it
 * after a confirm, "+" adds one), the component name and properties on its
 * root, and on any definition node the properties bound to it (labelled
 * by what they set, `propertyLabel`), with "+" to turn one of its props, or
 * a container's children (a slot), into a property.
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
// A prop (or the children, for a slot); a style binding of the same name (style `text`) leaves it free.
const bound = (prop: string) => !!def.value && !!boundProperty(def.value.properties, node.id, prop, 'prop')

const addItems = computed(() => {
  if (!def.value || node.type === INSTANCE_TYPE || node.type === SLOT_FILL_TYPE) return []
  const props = (getComponent(node.type)?.props ?? []).map(p => ({ id: p.name, label: p.label, disabled: bound(p.name), hint: bound(p.name) ? 'Already a property' : undefined }))
  const slot = isContainerType(node.type) ? [{ id: SLOT_ITEM, label: 'Slot (children)', disabled: bound(SLOT_PROP), hint: bound(SLOT_PROP) ? 'Already a slot' : 'Instances can fill it' }] : []
  return [...props, ...slot]
})

function boundTo(property: PropertyDef): string {
  return def.value ? bindingLabel(def.value.root, property.bindings[0]) : 'Not bound'
}

function addProperty(item: string) {
  if (!def.value) return
  const taken = def.value.properties
  if (item === SLOT_ITEM) {
    editor.run('component_property_add', { componentId: def.value.id, name: uniqueComponentName('Content', taken), kind: 'slot', bindings: [{ nodeId: node.id, prop: SLOT_PROP }] })
    return
  }
  const add = propBindingAdd(taken, node, item)
  if (add) editor.run('component_property_add', { componentId: def.value.id, ...add })
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

async function deleteVariant(variant: Variant) {
  if (!def.value) return
  const ok = await editor.confirm({ title: `Delete "${variant.name}"?`, description: 'Instances using it fall back to Primary. Undo brings it back.', confirmLabel: 'Delete variant', danger: true })
  if (ok && def.value) editor.run('component_variant_delete', { componentId: def.value.id, variantId: variant.id })
}

/** The variant whose row shows its name field (the menu's Rename, or a double-click). */
const renamingVariant = ref<string | null>(null)

function commitVariantName(variant: Variant, name: string) {
  renamingVariant.value = null
  renameVariant(variant, name)
}

// Rename mounts the field focused; the closing menu must not take the focus back (its blur would commit).
function keepRenameFocus(event: Event) {
  if (renamingVariant.value) event.preventDefault()
}

const PRIMARY_HINT = 'The primary is the component itself'
const primaryMenu: DropdownMenuItem[] = [
  { label: 'Rename', icon: 'i-lucide-pencil', disabled: true, description: PRIMARY_HINT },
  { label: 'Delete', icon: 'i-lucide-trash-2', disabled: true, description: PRIMARY_HINT }
]

function variantMenu(variant: Variant): DropdownMenuItem[] {
  return [
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => (renamingVariant.value = variant.id) },
    { label: 'Delete…', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => deleteVariant(variant) }
  ]
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
        <UIcon
          name="i-lucide-component"
          class="size-4 shrink-0 text-(--editor-component)"
        />
        <span class="min-w-0 flex-1 truncate text-[12px] text-highlighted">{{ instanceOf?.name ?? 'Missing component' }}</span>
        <EditorButton
          v-if="instanceOf"
          label="Edit"
          icon="i-lucide-pencil-ruler"
          size="xs"
          variant="soft"
          @click="editor.editComponent(instanceOf.id, null, { nested: true })"
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
      <EditorSelect
        :model-value="String(node.props.variant || PRIMARY_VARIANT)"
        :items="variantChoices"
        aria-label="Variant"
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
        <EditorSwitch
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
    add-label="Add variant"
    :menu="[{ id: 'add', label: 'New variant', hint: 'Starts like the primary' }]"
    data-component-variants
    @add="addVariant"
  >
    <div
      v-for="row in [{ id: null, name: 'Primary', variant: null }, ...def.variants.map(v => ({ id: v.id, name: v.name, variant: v }))]"
      :key="row.id ?? 'primary'"
      class="group/variant relative flex h-[30px] items-center"
      :data-variant-row="row.id ?? 'primary'"
    >
      <EditorInput
        v-if="row.variant && renamingVariant === row.id"
        :model-value="row.name"
        commit="change"
        autofocus
        :aria-label="`${row.name} variant name`"
        @commit="commitVariantName(row.variant, $event)"
        @blur="renamingVariant = null"
        @keydown.esc="renamingVariant = null"
      />
      <template v-else>
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg ps-2 pe-8 text-start text-[12px]"
          :class="[FOCUS_RING, (editor.variant?.id ?? null) === row.id ? 'bg-white/8 font-[550] text-highlighted' : 'text-toned hover:bg-white/4']"
          :aria-label="`Show and edit ${row.name}`"
          :aria-pressed="(editor.variant?.id ?? null) === row.id"
          @click="editor.selectVariant(row.id)"
          @dblclick="row.variant && (renamingVariant = row.id)"
        >
          <UIcon
            :name="(editor.variant?.id ?? null) === row.id ? 'i-lucide-eye' : 'i-lucide-circle'"
            class="size-3.5 shrink-0"
            :class="(editor.variant?.id ?? null) === row.id ? 'text-(--editor-context)' : 'text-dimmed'"
          />
          <span class="truncate">{{ row.variant ? row.name : def.name }}</span>
          <span
            v-if="!row.variant"
            class="shrink-0 rounded-sm bg-(--editor-component)/15 px-1 text-[10px] leading-4 font-[550] text-(--editor-component)"
            data-variant-primary-tag
          >Primary</span>
        </button>
        <EditorMenu
          :items="row.variant ? variantMenu(row.variant) : primaryMenu"
          :content="{ align: 'end' }"
          :on-close-auto-focus="keepRenameFocus"
        >
          <EditorButton
            icon="i-lucide-ellipsis"
            size="xs"
            variant="ghost"
            :aria-label="`${row.variant ? row.name : 'Primary'} variant actions`"
            class="absolute end-1 opacity-0 group-hover/variant:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          />
        </EditorMenu>
      </template>
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
    add-label="Add property"
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
      :label="propertyLabel(property)"
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
