<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ComponentFile, ModelNode, PropertyDef, Value } from '@bildr/codegen/model'
import type { Provenance } from '@bildr/editor-core/styleFields'
import { FOCUS_RING } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { INSTANCE_TYPE } from '../../editor/drop.ts'
import { SLOT_FILL_TYPE } from '../../editor/layouts.ts'
import { bindingLabel, boundProperty, entityAddItems, entityBindingAdd, instanceVariantValue, PRIMARY_VARIANT, propBindingAdd, propertyField, STYLE_ITEM, styleAddItems, styleBindingAdd, uniqueComponentName, variantItems } from '../../shared/componentEditor.ts'
import { isExpression } from '../../shared/bindings.ts'
import { isContainerType, propDefsOf } from '../../shared/nodeProps.ts'
import { propertyLabel } from '../../shared/propertyLabels.ts'

/**
 * The panel's component sections. On an Instance: its component (with Edit
 * component), its variant (blue when not the primary; reset goes back to
 * it) and a field per property, set per instance (blue when set; reset goes
 * back to the default), plus each slot's "Own content" switch. In the
 * component view: the variants, one row style for all (Primary first, with
 * its tag; click one to show and edit it, its menu renames or deletes it
 * after a confirm, adds its hover or pressed state, "+" adds one), the active
 * variant's interactions and transition (EditorInteractionsSection), the
 * component name and properties on its root, and on any definition node the
 * properties bound to it (labelled by what they set, `propertyLabel`), with
 * "+" to turn one of its props, a style key, or a container's children (a
 * slot), into a property: the same choices as the binding dot. The gear
 * opens the properties modal.
 *
 * The module's own on top of the hosted panel (S4): an entity property of an
 * instance is a record in scope (a select, bound with `$bind`); "+" also adds
 * a Record or a List property of an entity; an Instance can be detached or
 * replaced here (the node menu has both too);
 * a variant's menu adds its hover and pressed states (the hosted board has those buttons).
 */
const { node } = defineProps<{ node: ModelNode }>()
const editor = useEditor()

const SLOT_PROP = 'children'
const SLOT_ITEM = '__slot'
const NONE = '__none'

// An Instance on the page or nested in the definition being edited.
const instanceOf = computed(() => (node.type === INSTANCE_TYPE ? editor.components.find(entry => entry.id === node.props?.component) ?? null : null))
/** What the instance sets itself: property id → value (`values`). */
const values = computed<Record<string, Value>>(() => {
  const set = node.props?.values
  return isExpression(set) ? set : {}
})
const valueFields = computed(() => {
  const component = instanceOf.value
  return (component?.properties ?? []).flatMap((property) => {
    const field = propertyField(component!, property)
    return field ? [{ property, field }] : []
  })
})
const entityProperties = computed(() => (instanceOf.value ? instanceOf.value.properties.filter(property => property.kind === 'entity') : []))
const slots = computed(() => instanceOf.value?.properties.filter(property => property.kind === 'slot') ?? [])
const filled = (slot: PropertyDef) => !!node.children?.some(child => child.type === SLOT_FILL_TYPE && child.props?.slot === slot.id)

function setValue(property: PropertyDef, value: Value | null) {
  void editor.runOnPage('instance_set_values', { nodeId: node.id, values: { [property.id]: value } })
}

/** The record an entity property is bound to: the name in scope its `$bind` reads. */
const boundName = (property: PropertyDef): string => {
  const value = values.value[property.id]
  return isExpression(value) && typeof value.$bind === 'string' ? value.$bind : ''
}
/** The records an entity property can take: the names in scope of its entity (one record, or a list for `many`). */
const recordNames = (property: PropertyDef) => editor.scopeOf(node.id).filter(entry => entry.entity === property.entity && entry.many === (property.many === true)).map(entry => entry.name)
const recordItems = (property: PropertyDef) => {
  const current = boundName(property)
  const names = recordNames(property)
  return [{ label: 'None', value: NONE }, ...(current && !names.includes(current) ? [{ label: current, value: current }] : []), ...names.map(name => ({ label: name, value: name }))]
}
const recordSet = (property: PropertyDef): Provenance => (boundName(property) ? { state: 'set', key: property.id, value: boundName(property) } : { state: 'unset' })

// Base variants only: an instance's states show by themselves, from the pointer.
const variantChoices = computed(() => {
  const states = new Set(instanceOf.value?.variants.filter(variant => variant.state).map(variant => variant.id))
  return instanceOf.value ? variantItems(instanceOf.value).filter(item => !states.has(item.value)) : []
})
const instanceVariant = computed(() => (typeof node.props?.variant === 'string' ? node.props.variant : ''))
const variantSet = computed<Provenance>(() => (instanceVariant.value ? { state: 'set', key: 'variant', value: instanceVariant.value } : { state: 'unset' }))

function setVariant(item: string) {
  void editor.runOnPage('instance_set_values', { nodeId: node.id, variant: instanceVariantValue(item) })
}

function setSlot(slot: PropertyDef, value: boolean) {
  void editor.runOnPage('instance_set_slot', { nodeId: node.id, slot: slot.id, filled: value })
}

/** Replace with: every other component, but not the one being edited (it would contain itself). */
const replacements = computed(() => editor.components.filter(entry => entry.id !== node.props?.component && entry.id !== editor.componentId).map(entry => ({ label: entry.name, value: entry.id })))
/** Bumped after a pick so the select shows its placeholder again. */
const replaceKey = ref(0)
function replace(id: string) {
  replaceKey.value++
  if (id) void editor.replaceInstance(node.id, id)
}

// The component view: the definition the selected node belongs to.
const def = computed<ComponentFile | null>(() => editor.component)
const isDefRoot = computed(() => !!def.value && def.value.root.id === node.id)
/** The properties shown for the node: all on the root, else the ones bound to it (a slot property names its node). */
const shownProperties = computed(() => (def.value ? def.value.properties.filter(property => isDefRoot.value || (property.bindings ?? []).some(binding => binding.nodeId === node.id) || property.nodeId === node.id) : []))
// A prop (or the children, for a slot); a style binding of the same name (style `text`) leaves it free.
const bound = (prop: string) => !!def.value && (prop === SLOT_PROP
  ? def.value.properties.some(property => property.kind === 'slot' && property.nodeId === node.id)
  : !!boundProperty(def.value.properties, node.id, prop, 'prop'))

const addItems = computed(() => {
  if (!def.value || node.type === INSTANCE_TYPE || node.type === SLOT_FILL_TYPE) return []
  const props = propDefsOf(node.type).map(prop => ({ id: prop.name, label: prop.label, disabled: bound(prop.name), hint: bound(prop.name) ? 'Already a property' : undefined }))
  const slot = isContainerType(node.type) ? [{ id: SLOT_ITEM, label: 'Slot (children)', disabled: bound(SLOT_PROP), hint: bound(SLOT_PROP) ? 'Already a slot' : 'Instances can fill it' }] : []
  return [...props, ...styleAddItems(def.value.properties, node), ...slot, ...entityAddItems(editor.model)]
})

function boundTo(property: PropertyDef): string {
  if (!def.value) return 'Not bound'
  if (property.kind === 'slot') return property.nodeId ? bindingLabel(def.value.root, { nodeId: property.nodeId, prop: SLOT_PROP }) : 'Not bound'
  if (property.kind === 'entity') return property.many ? 'Instances bind a list of records' : 'Instances bind a record'
  return bindingLabel(def.value.root, property.bindings?.[0])
}

/** "+", the same choices as the binding dot: a prop, a style key, or the children (a slot) become a property; or a record or list of an entity. */
function addProperty(item: string) {
  if (!def.value) return
  const taken = def.value.properties
  const add = item === SLOT_ITEM
    ? { name: uniqueComponentName('Content', taken), kind: 'slot' as const, nodeId: node.id }
    : item.startsWith(STYLE_ITEM)
      ? styleBindingAdd(taken, node.id, item.slice(STYLE_ITEM.length))
      : entityBindingAdd(editor.model, taken, item) ?? propBindingAdd(taken, node, item)
  if (add) void editor.run('component_property_add', { component: def.value.id, ...add })
}

function renameProperty(property: PropertyDef, name: string) {
  const next = name.trim()
  if (def.value && next && next !== property.name) void editor.run('component_property_update', { component: def.value.id, property: property.id, name: next })
}

function removeProperty(property: PropertyDef) {
  if (def.value) void editor.run('component_property_remove', { component: def.value.id, property: property.id })
}

function addVariant() {
  void editor.addVariant()
}

type Variant = ComponentFile['variants'][number]

function renameVariant(variant: Variant, name: string) {
  void editor.renameVariant(variant.id, name)
}

async function deleteVariant(variant: Variant) {
  if (!def.value) return
  const ok = await editor.confirm({ title: `Delete "${variant.name}"?`, description: 'Instances using it fall back to Primary. Undo brings it back.', confirmLabel: 'Delete variant', danger: true })
  if (ok && def.value) void editor.run('component_variant_delete', { component: def.value.id, variant: variant.id })
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

/** Add hover state / Add pressed state of base variant `base` (`''`: the primary), disabled once it has one. */
function stateItems(base: string): DropdownMenuItem[] {
  return (['hover', 'pressed'] as const).map((kind) => {
    const exists = !!def.value?.variants.some(variant => variant.state?.of === base && variant.state.kind === kind)
    return { label: `Add ${kind} state`, icon: kind === 'hover' ? 'i-lucide-mouse-pointer-2' : 'i-lucide-pointer', disabled: exists, description: exists ? `Already has a ${kind} state` : 'Shown while the pointer is over it or pressing it', onSelect: () => void editor.addState(base || null, kind) }
  })
}

const primaryMenu = computed<DropdownMenuItem[][]>(() => [
  [
    { label: 'Rename', icon: 'i-lucide-pencil', disabled: true, description: PRIMARY_HINT },
    { label: 'Delete', icon: 'i-lucide-trash-2', disabled: true, description: PRIMARY_HINT }
  ],
  stateItems('')
])

function variantMenu(variant: Variant): DropdownMenuItem[][] {
  return [
    [
      { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => (renamingVariant.value = variant.id) },
      { label: 'Delete…', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => deleteVariant(variant) }
    ],
    // A state is shown by the pointer; it has no states of its own.
    ...(variant.state ? [] : [stateItems(variant.id)])
  ]
}

const variantRows = computed(() => (def.value ? [{ id: null as string | null, name: 'Primary', variant: null as Variant | null }, ...def.value.variants.map(variant => ({ id: variant.id as string | null, name: variant.name, variant }))] : []))

function renameComponent(name: string) {
  const next = name.trim()
  if (def.value && next && next !== def.value.name) void editor.run('component_rename', { component: def.value.id, name: next })
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
      v-if="variantChoices.length > 1"
      label="Variant"
      :provenance="variantSet"
      data-instance-variant
      @reset="setVariant(PRIMARY_VARIANT)"
    >
      <EditorSelect
        :model-value="instanceVariant || PRIMARY_VARIANT"
        :items="variantChoices"
        aria-label="Variant"
        @update:model-value="setVariant"
      />
    </EditorRow>
    <EditorPropField
      v-for="{ property, field } in valueFields"
      :key="property.id"
      :def="field"
      :value="values[property.id] ?? field.default"
      :changed="property.id in values"
      @update="setValue(property, $event)"
      @reset="setValue(property, null)"
    />
    <EditorRow
      v-for="property in entityProperties"
      :key="property.id"
      :label="property.label ?? property.name"
      :title="property.description ?? `${property.label ?? property.name}: ${property.many ? 'a list' : 'a record'} in scope`"
      :provenance="recordSet(property)"
      :data-instance-entity="property.id"
      @reset="setValue(property, null)"
    >
      <EditorSelect
        :model-value="boundName(property) || NONE"
        :items="recordItems(property)"
        :aria-label="property.label ?? property.name"
        @update:model-value="setValue(property, $event === NONE ? null : { $bind: $event })"
      />
    </EditorRow>
    <EditorRow
      v-for="slot in slots"
      :key="slot.id"
      :label="slot.label ?? slot.name"
      :title="`${slot.label ?? slot.name}: on, this instance has its own content; off, it shows the component's`"
    >
      <div class="flex h-[30px] items-center gap-2">
        <EditorSwitch
          :model-value="filled(slot)"
          :aria-label="`${slot.label ?? slot.name}: own content`"
          :data-instance-slot="slot.id"
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
    <EditorRow label="Instance">
      <div class="flex min-w-0 items-center gap-1.5">
        <EditorButton
          label="Detach"
          icon="i-lucide-unlink"
          size="xs"
          variant="soft"
          title="Replace the instance with the plain nodes it renders"
          data-instance-detach
          @click="editor.detachInstance(node.id)"
        />
        <EditorSelect
          :key="replaceKey"
          class="min-w-0 flex-1"
          :model-value="undefined"
          :items="replacements"
          placeholder="Replace with…"
          aria-label="Replace with"
          data-instance-replace
          @update:model-value="replace"
        />
      </div>
    </EditorRow>
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
      v-for="row in variantRows"
      :key="row.id ?? 'primary'"
      class="group/variant relative flex h-[30px] items-center"
      :data-variant-row="row.id ?? 'primary'"
      :data-variant-state="row.variant?.state?.kind"
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

  <EditorInteractionsSection v-if="def" />

  <EditorStyleSection
    v-if="def"
    :label="isDefRoot ? 'Component properties' : 'Properties'"
    add-label="Add property"
    edit-label="Edit properties…"
    :menu="addItems"
    data-component-properties
    @add="addProperty"
    @edit="editor.openProperties(shownProperties[0]?.id ?? null)"
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
