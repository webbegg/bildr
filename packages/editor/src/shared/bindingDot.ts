import { baseOfBreakpoint, cascadeTo, parseStyleKey, styleKey, styleTokenProblem } from '@bildr/codegen/design'
import type { BreakpointBase } from '@bildr/codegen/design'
import type { Model, ModelNode, PropertyDef, Value } from '@bildr/codegen/model'

/**
 * The binding dot's style-row logic (the hosted `shared/editor/bindingDot.ts`, over the
 * model's properties): which existing properties (or layout variables) a style key can
 * join without the module refusing the binding, and the binding a row shows with the
 * menu actions it offers (`styleBindingDot`).
 */

type PropertyBinding = NonNullable<PropertyDef['bindings']>[number]

/** Whether a binding drives a style key rather than a prop. */
export const isStyleBinding = (binding: { target?: 'style' }): boolean => binding.target === 'style'

const bindingsOf = (property: Pick<PropertyDef, 'bindings'>): PropertyBinding[] => property.bindings ?? []

const instancesOf = (root: ModelNode, componentId: string): ModelNode[] => [
  ...(root.type === 'Instance' && root.props?.component === componentId ? [root] : []),
  ...(root.children ?? []).flatMap(child => instancesOf(child, componentId))
]

/**
 * Every value `property` takes now: its default, and each instance's value (a component
 * property) or each page's (a layout variable). Binding a style key checks all of them
 * against the key.
 */
export function propertyValues(model: Pick<Model, 'modules' | 'layouts'>, owner: { componentId: string } | { layoutId: string }, property: PropertyDef): Value[] {
  const values: Value[] = property.default === undefined ? [] : [property.default]
  const pages = Object.values(model.modules).flatMap(entry => entry.pages)
  if ('componentId' in owner) {
    const roots = [
      ...pages.map(page => page.root),
      ...Object.values(model.modules).flatMap(entry => entry.components).filter(component => component.id !== owner.componentId).map(component => component.root),
      ...model.layouts.map(layout => layout.root)
    ]
    for (const root of roots) {
      for (const node of instancesOf(root, owner.componentId)) {
        const given = node.props?.values
        const value = typeof given === 'object' && given !== null && !Array.isArray(given) ? (given as Record<string, Value>)[property.id] : undefined
        if (value !== undefined) values.push(value)
      }
    }
  } else {
    for (const page of pages) {
      const value = page.layout === owner.layoutId ? page.layoutValues?.[property.id] : undefined
      if (value !== undefined) values.push(value)
    }
  }
  return values
}

/**
 * The properties "Bind to property" offers for style key `key`: text and select ones whose
 * every value (`valuesOf`) is a string valid for the key (`colors`: the theme's own colour
 * names, for colour keys; `base`: the project's breakpoint base).
 */
export function styleBindCandidates(properties: readonly PropertyDef[], key: string, valuesOf: (property: PropertyDef) => Value[], colors: readonly string[] = [], base: BreakpointBase = 'mobile'): PropertyDef[] {
  return properties.filter(property => (property.kind === 'text' || property.kind === 'select')
    && valuesOf(property).every(value => typeof value === 'string' && !styleTokenProblem(key, value, colors, base)))
}

/**
 * An action of the binding dot's menu and the style key it writes. `unbind` removes the
 * binding on `key`: `scope: 'key'` is the row's own binding, `'cascade'` an inherited one,
 * which also unbinds every breakpoint that inherits it (labelled so, `unbindLabel`). `bind`
 * and `create` bind `key`, the edited key.
 */
export type BindingDotAction
  = | { kind: 'unbind', key: string, property: PropertyDef, scope: 'key' | 'cascade' }
    | { kind: 'bind', key: string }
    | { kind: 'create', key: string }

export interface StyleBindingDot {
  /** `own`: bound at the edited key; `inherited`: at a smaller breakpoint's key that reaches it; else `none`. */
  state: 'own' | 'inherited' | 'none'
  property?: PropertyDef
  /** The style key the shown binding is on. */
  boundKey?: string
  actions: BindingDotAction[]
}

/**
 * What the dot of node `nodeId`'s style `key` (e.g. `md:p`) shows. Following the renderer's
 * cascade (`cascadeTo` the key's breakpoint), the edited key, then each earlier level's key
 * and the base key: the first that is bound decides, unless a key before it holds a value of
 * the node's own `style`, which overrides the binding there. An inherited row still offers
 * Bind and Create for the edited key, and no plain Unbind.
 */
export function styleBindingDot(properties: readonly PropertyDef[], nodeId: string, style: Readonly<Record<string, string>>, key: string): StyleBindingDot {
  const bindHere: BindingDotAction[] = [{ kind: 'bind', key }, { kind: 'create', key }]
  const parsed = parseStyleKey(key)
  const cascade = parsed ? cascadeTo(parsed.breakpoint).reverse().map(breakpoint => styleKey(parsed.token.key, breakpoint)) : [key]
  for (const step of cascade) {
    const property = properties.find(candidate => bindingsOf(candidate).some(binding => binding.nodeId === nodeId && binding.prop === step && isStyleBinding(binding)))
    if (property && step === key) return { state: 'own', property, boundKey: step, actions: [{ kind: 'unbind', key: step, property, scope: 'key' }] }
    if (property) return { state: 'inherited', property, boundKey: step, actions: [{ kind: 'unbind', key: step, property, scope: 'cascade' }, ...bindHere] }
    if (style[step] !== undefined) break
  }
  return { state: 'none', actions: bindHere }
}

/** Whether a variant's `override` of a node changes prop `key` (`mode` prop) or style key `key`: sets it or removes it. The dot then offers Reset override. */
export function variantOverridden(override: { props?: Record<string, unknown>, style?: Record<string, string>, unset?: readonly string[] } | undefined, mode: 'prop' | 'style', key: string): boolean {
  if (!override) return false
  if (mode === 'prop') return override.props?.[key] !== undefined
  return override.style?.[key] !== undefined || !!override.unset?.includes(key)
}

/** An unbind's menu label: `Unbind property`, or for an inherited binding the breakpoints it also unbinds (`from md up`, `from max-lg down`). */
export function unbindLabel(action: Extract<BindingDotAction, { kind: 'unbind' }>, noun: string): string {
  if (action.scope === 'key') return `Unbind ${noun}`
  const breakpoint = parseStyleKey(action.key)?.breakpoint
  if (!breakpoint) return `Unbind ${noun} on all breakpoints`
  return `Unbind ${noun} from ${breakpoint} ${baseOfBreakpoint(breakpoint) === 'desktop' ? 'down' : 'up'}`
}
