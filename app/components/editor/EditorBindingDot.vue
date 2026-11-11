<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { getStyleToken, isResponsiveToken, STYLE_HEX, styleKey } from '#shared/design/tokens'
import type { PropDef, PropValue } from '#shared/document/components'
import { INSTANCE_TYPE, SLOT_FILL_TYPE } from '#shared/document/components'
import type { PropertyBinding, PropertyDef } from '#shared/document/schema'
import { cssColorToHex } from '#shared/editor/color'
import { colorSwatch, colorSwatchRows, customColorSwatches, styleProvenance } from '#shared/editor/styleFields'
import { envRef } from '#shared/env/insert'
import { bindsKey, boundProperty, propBindingAdd, styleBindingAdd } from '~/composables/componentEditor'

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
 * label; the menu then offers Unbind. Each pick is one action, one undo step.
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

const nodes = computed(() => editor.selectedNodes)
const single = computed(() => (nodes.value.length === 1 ? nodes.value[0]! : undefined))
const token = computed(() => (props.mode === 'style' ? getStyleToken(props.name) : undefined))
/** The key edits go to: the token at the edited breakpoint, or the prop. */
const key = computed(() => (token.value && isResponsiveToken(token.value) ? styleKey(props.name, editor.device.breakpoint) : props.name))
const target = computed(() => (props.mode === 'style' ? 'style' as const : 'prop' as const))

/** Who can own a binding here: the component's properties or the layout's variables. */
const owner = computed(() => {
  if (editor.component) return { kind: 'component' as const, noun: 'property', list: editor.component.properties }
  if (editor.layout) return { kind: 'layout' as const, noun: 'variable', list: editor.layout.variables }
  return null
})
const bindable = computed(() => {
  const node = single.value
  if (!owner.value || !node || node.type === SLOT_FILL_TYPE) return false
  return props.mode === 'style' || node.type !== INSTANCE_TYPE
})
const bound = computed(() => (owner.value && single.value ? boundProperty(owner.value.list, single.value.id, key.value, target.value) : undefined))

/** The style value every selected node shows at the device; undefined when unset or mixed. */
const shared = computed(() => {
  const values = new Set(nodes.value.map((n) => {
    const p = styleProvenance(n.style, props.name, editor.deviceId)
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

function setBindings(property: PropertyDef, bindings: PropertyBinding[]) {
  const o = owner.value
  if (!o) return
  if (o.kind === 'component') editor.run('component_property_update', { componentId: editor.component!.id, propertyId: property.id, bindings })
  else editor.run('layout_variable_update', { layoutId: editor.layout!.id, variableId: property.id, bindings })
}

function create() {
  const o = owner.value
  const node = single.value
  if (!o || !node) return
  const add = props.mode === 'style' ? styleBindingAdd(o.list, node.id, key.value) : propBindingAdd(o.list, node, props.name)
  if (!add) return
  if (o.kind === 'component') editor.run('component_property_add', { componentId: editor.component!.id, ...add })
  else editor.run('layout_variable_add', { layoutId: editor.layout!.id, ...add })
}

const binding = computed((): PropertyBinding | undefined => single.value && ({ nodeId: single.value.id, prop: key.value, ...(props.mode === 'style' ? { target: 'style' as const } : {}) }))
/** Existing properties this row can join: text or select ones for a style key, the prop's kind for a prop. */
const candidates = computed(() => (owner.value?.list ?? []).filter(p => p.kind !== 'slot'
  && (props.mode === 'style' ? p.kind === 'text' || p.kind === 'select' : p.kind === props.prop?.kind)))

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
  if (bound.value && o) {
    groups.push([
      { type: 'label', label: `Bound to ${bound.value.name}` },
      { label: `Unbind ${o.noun}`, icon: 'i-lucide-unlink-2', onSelect: () => setBindings(bound.value!, bound.value!.bindings.filter(b => !bindsKey(b, single.value!.id, key.value, target.value))) }
    ])
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
  if (o && bindable.value && !bound.value) {
    groups.push([
      { label: `Bind to ${o.noun}`, icon: 'i-lucide-link', disabled: !candidates.value.length, children: candidates.value.map(p => ({ label: p.name, onSelect: () => setBindings(p, [...p.bindings, binding.value!]) })) },
      { label: `Create ${o.noun}`, icon: 'i-lucide-plus', description: o.kind === 'component' ? 'Instances can set it' : 'Each page can set it', onSelect: create }
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
const label = computed(() => (bound.value ? `Bound to ${bound.value.name}` : `Bind ${props.prop?.label ?? token.value?.label ?? props.name}`))
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
    v-if="bound"
    class="order-1 min-w-0 flex-1 basis-0 truncate text-[10px] text-(color:--editor-selection)"
    :title="`Bound to ${bound.name}`"
    data-bound-name
  >{{ bound.name }}</span>
</template>
