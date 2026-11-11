import { styleTokenProblem } from '../design/tokens'
import type { PropValue } from '../document/components'
import type { PropertyDef, Project } from '../document/schema'
import { isStyleBinding } from '../document/schema'
import { componentInstances } from '../document/usages'

/**
 * The binding dot's style-row logic: which existing properties (or layout
 * variables) a style key can join without the server refusing the binding,
 * and the binding a row shows, the edited breakpoint key's or else the base
 * key's (inherited, as the style values are).
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
 * (`colors`: the theme's own colour names, for colour keys).
 */
export function styleBindCandidates(properties: readonly PropertyDef[], key: string, valuesOf: (property: PropertyDef) => PropValue[], colors: readonly string[] = []): PropertyDef[] {
  return properties.filter(p => (p.kind === 'text' || p.kind === 'select')
    && valuesOf(p).every(value => typeof value === 'string' && !styleTokenProblem(key, value, colors)))
}

export interface StyleBindingAt {
  property: PropertyDef
  /** The style key the binding is on: `key`, or the base key when inherited. */
  key: string
  /** Bound on the base key, not on the edited breakpoint key. */
  inherited: boolean
}

/** The binding of node `nodeId`'s style `key` (a breakpoint key such as `md:p`), else of its `baseKey` (inherited). */
export function styleBindingAt(properties: readonly PropertyDef[], nodeId: string, key: string, baseKey: string): StyleBindingAt | undefined {
  const find = (k: string) => properties.find(p => p.bindings.some(b => b.nodeId === nodeId && b.prop === k && isStyleBinding(b)))
  const own = find(key)
  if (own) return { property: own, key, inherited: false }
  const base = key === baseKey ? undefined : find(baseKey)
  return base ? { property: base, key: baseKey, inherited: true } : undefined
}
