import type { MaybeRefOrGetter } from 'vue'
import { getStyleToken, isResponsiveToken, styleKey } from '#shared/design/tokens'
import { INSTANCE_TYPE, SLOT_FILL_TYPE } from '#shared/document/components'
import type { PropertyBinding, PropertyDef } from '#shared/document/schema'
import type { StyleBindingDot } from '#shared/editor/bindingDot'
import { styleBindingDot } from '#shared/editor/bindingDot'
import { bindsKey, boundProperty } from './componentEditor'

/**
 * A bindable row's binding, shared by the binding dot (its menu) and the row
 * (which shows the `◇ Title ×` chip in place of its value when the row's
 * own key is bound): who owns bindings here (the component's properties or
 * the layout's variables), the key edits go to (a style token at the edited
 * breakpoint, or the prop), the dot's state and actions, and unbinding.
 */
export function useBinding(mode: MaybeRefOrGetter<'style' | 'prop'>, name: MaybeRefOrGetter<string>) {
  const editor = useEditor()
  const nodes = computed(() => editor.selectedNodes)
  const single = computed(() => (nodes.value.length === 1 ? nodes.value[0]! : undefined))
  const token = computed(() => (toValue(mode) === 'style' ? getStyleToken(toValue(name)) : undefined))
  /** The key edits go to: the token at the edited breakpoint, or the prop. */
  const key = computed(() => (token.value && isResponsiveToken(token.value) ? styleKey(toValue(name), editor.device.breakpoint) : toValue(name)))
  const target = computed(() => (toValue(mode) === 'style' ? 'style' as const : 'prop' as const))

  const owner = computed(() => {
    if (editor.component) return { kind: 'component' as const, noun: 'property', list: editor.component.properties }
    if (editor.layout) return { kind: 'layout' as const, noun: 'variable', list: editor.layout.variables }
    return null
  })
  const bindable = computed(() => {
    const node = single.value
    if (!owner.value || !node || node.type === SLOT_FILL_TYPE) return false
    return toValue(mode) === 'style' || node.type !== INSTANCE_TYPE
  })
  /** The row's binding state (own, inherited or none) and its menu actions, each with the key it writes. */
  const dot = computed((): StyleBindingDot | undefined => {
    const o = owner.value
    const node = single.value
    if (!o || !node) return undefined
    if (toValue(mode) === 'style') return styleBindingDot(o.list, node.id, node.style, key.value)
    const property = boundProperty(o.list, node.id, key.value, target.value)
    return property
      ? { state: 'own', property, boundKey: key.value, actions: [{ kind: 'unbind', key: key.value, property, scope: 'key' }] }
      : { state: 'none', actions: [{ kind: 'bind', key: key.value }, { kind: 'create', key: key.value }] }
  })
  const bound = computed(() => (dot.value?.state === 'none' ? undefined : dot.value?.property))
  /** The property bound at the row's own key: the row shows its chip instead of the value. */
  const ownBound = computed(() => (dot.value?.state === 'own' ? dot.value.property : undefined))
  const inherited = computed(() => dot.value?.state === 'inherited')

  function setBindings(property: PropertyDef, bindings: PropertyBinding[]) {
    const o = owner.value
    if (!o) return
    if (o.kind === 'component') editor.run('component_property_update', { componentId: editor.component!.id, propertyId: property.id, bindings })
    else editor.run('layout_variable_update', { layoutId: editor.layout!.id, variableId: property.id, bindings })
  }

  /** Removes `property`'s binding of `at` (the row's key by default) on the selected node. */
  function unbind(property: PropertyDef, at = key.value) {
    const node = single.value
    if (node) setBindings(property, property.bindings.filter(b => !bindsKey(b, node.id, at, target.value)))
  }

  return { editor, nodes, single, token, key, target, owner, bindable, dot, bound, ownBound, inherited, setBindings, unbind }
}
