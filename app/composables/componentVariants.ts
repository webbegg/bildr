import type { PropValue } from '#shared/document/components'
import type { ComponentDefinition, DocNode, PropertyDef, Variant } from '#shared/document/schema'
import { findNode } from '#shared/document/tree'
import type { StylePatch } from '#shared/editor/preview'
import { applySetters, applyStyleSetters, propertySetters, variantStyle } from '#shared/runtime/instances'

/**
 * The variants UI's pure parts. The primary variant is the definition
 * itself; a variant stores only the props and design tokens it overrides,
 * and the tokens it removes (`unset`), per definition node, and a null value
 * removes an override or a removal (so a reset keeps the variant sparse). The component view shows the definition with
 * the active variant applied, ids unchanged, so the canvas, the layers and
 * the panel work on the same nodes in every variant.
 */

export type OverrideKind = 'props' | 'style'

export interface OverrideEntry {
  kind: OverrideKind
  key: string
  value: PropValue
  /** A token the variant removes (its value is empty). */
  removed?: true
}

/** One node's `component_variant_set_override` change: null resets a prop or token, `unset` removes primary tokens. */
export interface OverridePatch {
  props?: Record<string, PropValue | null>
  style?: StylePatch
  unset?: string[]
}

export type NodeOverridePatch = OverridePatch & { nodeId: string }

/** The `<USelect>` value of the primary variant (select items cannot be empty). */
export const PRIMARY_VARIANT = '__primary'

/**
 * The definition tree as `variant` renders it in an instance without values,
 * with the definition's ids: bound props and style keys in the runtime order
 * (variant override, else the stored default of `properties`, else the
 * node's own value). The primary (null) without stored defaults is `root`
 * itself.
 */
export function applyVariant(root: DocNode, variant: Variant | null, properties: PropertyDef[] = []): DocNode {
  const setters = propertySetters(properties, {})
  if (!variant && !setters.size) return root
  const build = (node: DocNode): DocNode => {
    const override = variant?.overrides[node.id]
    const props = { ...node.props, ...override?.props }
    applySetters(props, setters, node.id, override?.props)
    const style = variantStyle(node.style, override)
    applyStyleSetters(style, setters, node.id, override?.style, override?.unset)
    return {
      ...node,
      props,
      style,
      children: node.children.map(build)
    }
  }
  return build(root)
}

/** What `variant` overrides on one node: props, then design tokens, then removed tokens (empty values). */
export function overrideEntries(variant: Variant | null, nodeId: string): OverrideEntry[] {
  const override = variant?.overrides[nodeId]
  return [
    ...Object.entries(override?.props ?? {}).map(([key, value]): OverrideEntry => ({ kind: 'props', key, value })),
    ...Object.entries(override?.style ?? {}).map(([key, value]): OverrideEntry => ({ kind: 'style', key, value })),
    ...(override?.unset ?? []).map((key): OverrideEntry => ({ kind: 'style', key, value: '', removed: true }))
  ]
}

export function isOverridden(variant: Variant | null, nodeId: string, kind: OverrideKind, key: string): boolean {
  const override = variant?.overrides[nodeId]
  if (kind === 'style' && override?.unset?.includes(key)) return true
  return !!override?.[kind] && key in override[kind]
}

/** A node's style in the primary variant, with the property bindings' defaults applied (the base a variant's overrides and removals are against). */
export function primaryStyle(component: { root: DocNode, properties?: PropertyDef[] }, nodeId: string): Record<string, string> {
  return findNode(applyVariant(component.root, null, component.properties ?? []), nodeId)?.style ?? {}
}

/**
 * The override a variant Paste style makes so the node's effective style
 * becomes `copied` exactly: differing tokens set, tokens only the variant
 * adds reset (null), and tokens of the primary (`base`, see `primaryStyle`)
 * the copy lacks removed (`unset`). Empty when nothing changes.
 */
export function pasteStyleOverride(base: Record<string, string>, effective: Record<string, string>, copied: Record<string, string>): OverridePatch {
  const style: StylePatch = {}
  const unset: string[] = []
  for (const [key, value] of Object.entries(copied)) if (effective[key] !== value) style[key] = value
  for (const key of Object.keys(effective)) {
    if (key in copied) continue
    if (key in base) unset.push(key)
    else style[key] = null
  }
  return { ...(Object.keys(style).length ? { style } : {}), ...(unset.length ? { unset } : {}) }
}

const hasChange = ({ props, style, unset }: OverridePatch) => !!(props && Object.keys(props).length) || !!(style && Object.keys(style).length) || !!unset?.length

/**
 * The `component_variant_set_override` input for per-node patches (without
 * the component and variant): the single form for one node, a batch
 * (`overrides`, one undo step) for several; null when none changes anything.
 */
export function overrideInput(patches: NodeOverridePatch[]): NodeOverridePatch | { overrides: NodeOverridePatch[] } | null {
  const changes = patches.filter(hasChange)
  if (!changes.length) return null
  return changes.length === 1 ? changes[0]! : { overrides: changes }
}

/** The `component_variant_set_override` patch that removes `entries`. */
export function resetOverrides(entries: OverrideEntry[]): { props?: Record<string, null>, style?: Record<string, null> } {
  const patch: { props?: Record<string, null>, style?: Record<string, null> } = {}
  for (const { kind, key } of entries) patch[kind] = { ...patch[kind], [key]: null }
  return patch
}

/** The variant `variantId` of `def`; null for the primary, or for a variant that no longer exists. */
export function activeVariant(def: ComponentDefinition | null, variantId: string | null): Variant | null {
  return (variantId && def?.variants.find(v => v.id === variantId)) || null
}

/** How many props and design tokens a variant overrides, over all nodes. */
const overrideCount = (variant: Variant) => Object.keys(variant.overrides).reduce((n, nodeId) => n + overrideEntries(variant, nodeId).length, 0)

/** The variant choices of an instance: Primary, then each variant, described (two-line menu items) by what it overrides. */
export function variantItems(def: ComponentDefinition): { label: string, value: string, description: string }[] {
  const describe = (variant: Variant) => {
    const n = overrideCount(variant)
    return n ? `${n} override${n === 1 ? '' : 's'}` : 'Same as Primary'
  }
  return [
    { label: 'Primary', value: PRIMARY_VARIANT, description: 'The component as defined' },
    ...def.variants.map(v => ({ label: v.name, value: v.id, description: describe(v) }))
  ]
}

/** The `instance_set_values` variant for a chosen item: `''` for the primary. */
export function instanceVariantValue(item: string): string {
  return item === PRIMARY_VARIANT ? '' : item
}

/** `Variant N`, N one more than the variants there are, or the next free number. */
export function newVariantName(def: ComponentDefinition): string {
  const taken = new Set(def.variants.map(v => v.name))
  let n = def.variants.length + 1
  while (taken.has(`Variant ${n}`)) n++
  return `Variant ${n}`
}
