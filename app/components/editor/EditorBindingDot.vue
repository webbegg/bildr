<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { STYLE_HEX } from '#shared/design/tokens'
import type { PropDef, PropValue } from '#shared/document/components'
import type { PropertyBinding } from '#shared/document/schema'
import { customColorNames } from '#shared/design/theme'
import type { BindingDotAction } from '#shared/editor/bindingDot'
import { propertyValues, styleBindCandidates, unbindLabel, variantOverridden } from '#shared/editor/bindingDot'
import { cssColorToHex } from '#shared/editor/color'
import { colorSwatch, colorSwatchRows, customColorSwatches, styleProvenance } from '#shared/editor/styleFields'
import { envRef } from '#shared/env/insert'
import { propBindingAdd, styleBindingAdd } from '~/composables/componentEditor'
import { useBinding } from '~/composables/useBinding'

/**
 * Framer's binding dot: a small dot in the gutter before a bindable row's
 * label (shown on row hover, always when bound) whose menu binds the row.
 * A style row (`mode="style"`, `name` its base token key) offers Pick token
 * and Detach to raw value (a colour token becomes its hex), and in the
 * component or layout view Bind to property/variable and Create
 * property/variable: a style binding of the key at the edited breakpoint.
 * A prop row (`mode="prop"`, `prop` its definition) offers Create
 * property/variable and Bind to an existing one in those views, and Insert
 * env variable on text props (emitted as `update`, which the row commits).
 * Bound, the dot fills in the accent and the property's name follows the
 * label; the menu then offers Unbind. A style key bound at a smaller
 * breakpoint's key (e.g. the base) shows that binding as inherited, unless
 * the node sets its own value on the way (`styleBindingDot`); its menu still
 * binds the edited key, and its unbind is labelled as reaching every
 * breakpoint that inherits it. Bind to property lists only the properties
 * whose values (default and instance or page values) all fit the style key,
 * as the server checks (`styleBindCandidates`). Create opens the properties
 * modal on the new property, its name field focused. On a value a variant
 * overrides (or removes), the menu offers Reset override. Each pick is one
 * action, one undo step. The bound row itself shows the property's chip
 * (EditorBindingValue, which shares this state through `useBinding`).
 */
const props = defineProps<{
  mode: 'style' | 'prop'
  /** The base token key (style) or the prop name. */
  name: string
  prop?: PropDef
  value?: PropValue
}>()
const emit = defineEmits<{ update: [value: PropValue] }>()
const editor = useEditor()

const { nodes, single, token, key, owner, bindable, dot, bound, inherited, setBindings, unbind } = useBinding(() => props.mode, () => props.name)
const actionOf = <K extends BindingDotAction['kind']>(kind: K) => dot.value?.actions.find((a): a is Extract<BindingDotAction, { kind: K }> => a.kind === kind)

/** The style value every selected node shows at the device; undefined when unset or mixed. */
const shared = computed(() => {
  const values = new Set(nodes.value.map((n) => {
    const p = styleProvenance(n.style, props.name, editor.deviceId, editor.breakpointBase)
    return p.state === 'unset' ? undefined : p.value
  }))
  return values.size === 1 ? [...values][0] : undefined
})

function pick(value: string) {
  editor.updateStyle(editor.selectedIds, { [key.value]: value })
}

const isColor = computed(() => token.value?.kind === 'color')
/** The hex a colour token or theme colour paints, for Detach. */
const rawHex = computed(() => {
  const value = shared.value
  if (!isColor.value || !value || !editor.theme || STYLE_HEX.test(value)) return undefined
  const swatch = colorSwatch(token.value!, editor.theme, value)
  return swatch ? cssColorToHex(swatch.color) : undefined
})

async function create(at: string) {
  const o = owner.value
  const node = single.value
  if (!o || !node) return
  const add = props.mode === 'style' ? styleBindingAdd(o.list, node.id, at) : propBindingAdd(o.list, node, props.name)
  if (!add) return
  const created = o.kind === 'component'
    ? (await editor.run<{ propertyId: string }>('component_property_add', { componentId: editor.component!.id, ...add }))?.propertyId
    : (await editor.run<{ variableId: string }>('layout_variable_add', { layoutId: editor.layout!.id, ...add }))?.variableId
  if (created) editor.openProperties(created, { focusName: true })
}

/** In the variant view, whether the active variant overrides (or removes) this row's value on the selected node. */
const overridden = computed(() => {
  const node = single.value
  const variant = editor.variant
  return !!node && !!variant && variantOverridden(variant.overrides[node.id], props.mode, key.value)
})

function resetOverride() {
  const node = single.value
  if (!node) return
  editor.setOverride(node.id, props.mode === 'prop' ? { props: { [key.value]: null } } : { style: { [key.value]: null } })
}

const bindingOf = (at: string): PropertyBinding => ({ nodeId: single.value!.id, prop: at, ...(props.mode === 'style' ? { target: 'style' as const } : {}) })
/** Existing properties this row can join: for a style key, text or select ones whose values all fit it; the prop's kind for a prop. */
const candidates = computed(() => {
  const o = owner.value
  const project = editor.project
  if (!o || !project) return []
  if (props.mode === 'prop') return o.list.filter(p => p.kind !== 'slot' && p.kind === props.prop?.kind)
  const ownerRef = o.kind === 'component' ? { componentId: editor.component!.id } : { layoutId: editor.layout!.id }
  return styleBindCandidates(o.list, key.value, p => propertyValues(project, ownerRef, p), customColorNames(project.theme), project.breakpointBase)
})

const TEXT_KINDS = new Set(['text', 'textarea', 'image'])

const swatchItems = computed(() => {
  if (!token.value || !editor.theme) return []
  if (!isColor.value) return token.value.values.map(value => ({ label: value, onSelect: () => pick(value) }))
  const swatches = [...colorSwatchRows(token.value, editor.theme).flatMap(r => r.swatches), ...customColorSwatches(editor.theme)]
  return swatches.map(s => ({ label: s.label, slot: 'swatch' as const, swatch: s.color, onSelect: () => pick(s.value) }))
})

const items = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = []
  const o = owner.value
  const unbinding = actionOf('unbind')
  if (unbinding && o) {
    groups.push([
      { type: 'label', label: label.value },
      { label: `Edit ${o.noun}…`, icon: 'i-lucide-settings-2', onSelect: () => editor.openProperties(unbinding.property.id) },
      { label: unbindLabel(unbinding, o.noun), icon: 'i-lucide-unlink-2', onSelect: () => unbind(unbinding.property, unbinding.key) }
    ])
  }
  if (overridden.value && editor.variant) {
    groups.push([{ label: 'Reset override', icon: 'i-lucide-rotate-ccw', description: `Back to the primary in ${editor.variant.name}`, onSelect: resetOverride }])
  }
  if (props.mode === 'style' && token.value) {
    groups.push([
      { label: 'Pick token', icon: 'i-lucide-swatch-book', children: swatchItems.value, content: { class: 'max-h-80 overflow-y-auto' } },
      {
        label: 'Detach to raw value',
        icon: 'i-lucide-unlink',
        disabled: !rawHex.value,
        description: rawHex.value ?? (isColor.value ? 'Pick a colour token first' : 'This token has no raw value'),
        onSelect: () => rawHex.value && pick(rawHex.value)
      }
    ])
  }
  const bind = actionOf('bind')
  const add = actionOf('create')
  if (o && bindable.value && bind && add) {
    groups.push([
      { label: `Bind to ${o.noun}`, icon: 'i-lucide-link', disabled: !candidates.value.length, children: candidates.value.map(p => ({ label: p.name, onSelect: () => setBindings(p, [...p.bindings, bindingOf(bind.key)]) })) },
      { label: `Create ${o.noun}`, icon: 'i-lucide-plus', description: o.kind === 'component' ? 'Instances can set it' : 'Each page can set it', onSelect: () => create(add.key) }
    ])
  }
  if (props.mode === 'prop' && props.prop && TEXT_KINDS.has(props.prop.kind)) {
    const env = editor.env.map(v => ({ label: v.name, icon: v.secret ? 'i-lucide-lock' : 'i-lucide-braces', disabled: v.secret, onSelect: () => emit('update', `${String(props.value ?? '')}${envRef(v.name)}`) }))
    groups.push([{ label: 'Insert env variable', icon: 'i-lucide-braces', disabled: !env.length, children: env }])
  }
  return groups
})

/** The colour of a Pick token item (the menu's slot types its items loosely). */
const swatchOf = (item: unknown) => (item as { swatch?: string }).swatch

const shown = computed(() => items.value.length > 0)
const label = computed(() => {
  const property = bound.value
  if (!property) return `Bind ${props.prop?.label ?? token.value?.label ?? props.name}`
  return inherited.value ? `Bound to ${property.name} (inherited)` : `Bound to ${property.name}`
})
</script>

<template>
  <EditorMenu
    v-if="shown"
    :items="items"
    :content="{ side: 'left', align: 'start' }"
  >
    <button
      type="button"
      class="absolute -start-3 top-1/2 grid size-3 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:opacity-100 aria-expanded:opacity-100"
      :class="bound ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'"
      :aria-label="label"
      :title="label"
      :data-binding-dot="name"
      :data-bound="bound ? bound.name : undefined"
      :data-bound-inherited="inherited || undefined"
      @pointerdown.stop
    >
      <span
        class="block size-1.5 rounded-full"
        :class="bound ? 'bg-(color:--editor-selection)' : 'bg-(color:--ui-text-dimmed)'"
      />
    </button>
    <template #swatch-leading="{ item }">
      <span
        class="block size-3 shrink-0 rounded-sm ring-1 ring-white/10 ring-inset"
        :style="{ background: swatchOf(item) }"
      />
    </template>
  </EditorMenu>
  <span
    v-if="bound && inherited"
    class="order-1 min-w-0 flex-1 basis-0 truncate text-[10px] text-(color:--editor-selection)"
    :title="label"
    data-bound-name
  >{{ bound.name }}</span>
</template>
