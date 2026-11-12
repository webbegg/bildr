import type { BreakpointBase } from '../design/tokens'
import { baseOfBreakpoint, cascadeTo, parseStyleKey, styleKey, styleTokenProblem } from '../design/tokens'
import type { PropValue } from '../document/components'
import type { PropertyDef, Project } from '../document/schema'
import { isStyleBinding } from '../document/schema'
import { componentInstances } from '../document/usages'

/**
 * The binding dot's style-row logic: which existing properties (or layout
 * variables) a style key can join without the server refusing the binding,
 * and the binding a row shows with the menu actions it offers
 * (`styleBindingDot`).
 */

/**
 * Every value property `property` takes now: its default, and each
 * instance's value (a component property) or each page's (a layout
 * variable). Binding a style key checks all of them against the key.
 */
export function propertyValues(project: Project, owner: { componentId: string } | { layoutId: string }, property: PropertyDef): PropValue[] {
  const values: PropValue[] = property.default === undefined ? [] : [property.default]
  if ('componentId' in owner) {
    for (const { node } of componentInstances(project, owner.componentId)) {
      const value = node.props[property.id]
      if (value !== undefined) values.push(value)
    }
  } else {
    for (const page of project.pages) {
      const value = page.layoutId === owner.layoutId ? page.layoutValues?.[property.id] : undefined
      if (value !== undefined) values.push(value)
    }
  }
  return values
}

/**
 * The properties "Bind to property" offers for style key `key`: text and
 * select ones whose every value (`valuesOf`) is a string valid for the key
 * (`colors`: the theme's own colour names, for colour keys; `base`: the
 * project's breakpoint base).
 */
export function styleBindCandidates(properties: readonly PropertyDef[], key: string, valuesOf: (property: PropertyDef) => PropValue[], colors: readonly string[] = [], base: BreakpointBase = 'mobile'): PropertyDef[] {
  return properties.filter(p => (p.kind === 'text' || p.kind === 'select')
    && valuesOf(p).every(value => typeof value === 'string' && !styleTokenProblem(key, value, colors, base)))
}

/**
 * An action of the binding dot's menu and the style key it writes. `unbind`
 * removes the binding on `key`: `scope: 'key'` is the row's own binding,
 * `'cascade'` an inherited one, which also unbinds every breakpoint that
 * inherits it (labelled so, `unbindLabel`). `bind` and `create` bind `key`,
 * the edited key.
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
 * What the dot of node `nodeId`'s style `key` (e.g. `md:p`) shows. Following
 * the renderer's cascade (`cascadeTo` the key's breakpoint), the edited key,
 * then each earlier level's key and the base key: the first
 * that is bound decides, unless a key before it holds a value of the node's
 * own `style`, which overrides the binding there. An inherited row still
 * offers Bind and Create for the edited key, and no plain Unbind.
 */
export function styleBindingDot(properties: readonly PropertyDef[], nodeId: string, style: Readonly<Record<string, string>>, key: string): StyleBindingDot {
  const bindHere: BindingDotAction[] = [{ kind: 'bind', key }, { kind: 'create', key }]
  const parsed = parseStyleKey(key)
  const cascade = parsed ? cascadeTo(parsed.breakpoint).reverse().map(b => styleKey(parsed.token.key, b)) : [key]
  for (const k of cascade) {
    const property = properties.find(p => p.bindings.some(b => b.nodeId === nodeId && b.prop === k && isStyleBinding(b)))
    if (property && k === key) return { state: 'own', property, boundKey: k, actions: [{ kind: 'unbind', key: k, property, scope: 'key' }] }
    if (property) return { state: 'inherited', property, boundKey: k, actions: [{ kind: 'unbind', key: k, property, scope: 'cascade' }, ...bindHere] }
    if (style[k] !== undefined) break
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
